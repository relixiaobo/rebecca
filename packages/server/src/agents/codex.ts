import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentContext,
  AgentResponse,
} from "./types.js";

/**
 * Codex runner: spawns `codex exec --json` per invocation.
 * Maintains a thread_id across calls so the agent has session continuity.
 *
 * Codex is one-shot per invocation: each call starts a new process.
 * Continuity is provided via `codex exec resume <thread_id>`.
 */
export class CodexRunner implements AgentRunner {
  private config: AgentRunnerConfig;
  private threadId: string | null = null;
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private currentProcess: ChildProcess | null = null;
  private stopRequested = false;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
  }

  onExit(callback: (code: number | null) => void) {
    this.exitCallbacks.push(callback);
  }

  async start() {
    // Verify codex CLI is available. Use the same minimal env we use for
    // real invocations — do not inherit full server env for the probe.
    return new Promise<void>((resolve, reject) => {
      const check = spawn(this.config.command, ["--version"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.config.env ?? { ...process.env },
      });
      check.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${this.config.command} --version exited ${code}`));
      });
      check.on("error", (err) =>
        reject(new Error(`Failed to spawn ${this.config.command}: ${err.message}`)),
      );
    });
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    if (this.stopRequested) {
      throw new Error("Codex runner is stopped");
    }

    const prompt = buildPrompt(context);
    const result = await this.exec(prompt, context.mode);

    const mentions = parseMentions(
      result.text,
      context.otherParticipants,
      context.participantId,
    );

    return { text: result.text.trim(), mentions };
  }

  async stop() {
    this.stopRequested = true;
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  isReady(): boolean {
    return !this.stopRequested;
  }

  private exec(
    prompt: string,
    mode: "full" | "quick" = "full",
  ): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      if (mode === "quick") {
        // Quick mode: fresh ephemeral process, read-only sandbox.
        // No thread resume — quick questions don't pollute the agent's
        // long-term session.
        args.push(
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
        );
      } else {
        const baseArgs = this.config.args.length
          ? this.config.args
          : ["exec", "--json", "--full-auto", "--skip-git-repo-check"];

        if (this.threadId) {
          args.push(...injectResumeArgs(baseArgs, this.threadId));
        } else {
          args.push(...baseArgs);
        }
      }

      args.push(prompt);

      const proc = spawn(this.config.command, args, {
        cwd: this.config.cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: this.config.env ?? { ...process.env },
      });

      this.currentProcess = proc;

      let buffer = "";
      const events: Record<string, unknown>[] = [];
      const stderrChunks: string[] = [];
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      // Hard timeout for the whole exec (5 minutes)
      const timeout = setTimeout(
        () => {
          settle(() => {
            try {
              proc.kill("SIGTERM");
            } catch {}
            reject(new Error("Codex exec timed out after 300s"));
          });
        },
        5 * 60 * 1000,
      );

      proc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            events.push(JSON.parse(trimmed));
          } catch {
            // skip non-JSON
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrChunks.push(text);
        const trimmed = text.trim();
        if (trimmed) {
          console.error(`[codex stderr] ${trimmed}`);
        }

        // Fail fast on auth errors — Codex won't recover by retrying
        if (
          text.includes("401 Unauthorized") ||
          text.includes("refresh_token_reused") ||
          text.includes("Please log out and sign in again")
        ) {
          settle(() => {
            try {
              proc.kill("SIGTERM");
            } catch {}
            reject(
              new Error(
                "Codex authentication failed. Please run `codex login`.",
              ),
            );
          });
        }
      });

      proc.on("error", (err) => {
        this.currentProcess = null;
        settle(() => reject(err));
      });

      proc.on("close", (code) => {
        this.currentProcess = null;

        if (settled) return;

        if (code !== 0 && code !== null) {
          const errorEvent = events.find(
            (e) => e.type === "error" || e.type === "turn.failed",
          );
          const errMsg =
            (errorEvent as { message?: string })?.message ??
            stderrChunks.join("").slice(-500) ??
            `codex exited with code ${code}`;

          if (!this.stopRequested) {
            for (const cb of this.exitCallbacks) cb(code);
          }
          settle(() => reject(new Error(errMsg)));
          return;
        }

        // Extract thread ID — but only persist it for full-mode runs.
        // Quick mode is ephemeral by design and must not pollute the agent's
        // long-running session continuity.
        if (mode === "full") {
          const threadEvent = events.find((e) => e.type === "thread.started");
          if (threadEvent && "thread_id" in threadEvent) {
            this.threadId = threadEvent.thread_id as string;
          }
        }

        // Extract last agent message
        const agentMessages = events
          .filter(
            (e) =>
              e.type === "item.completed" &&
              (e.item as { type?: string })?.type === "agent_message",
          )
          .map((e) => (e.item as { text?: string })?.text ?? "");

        const text = agentMessages[agentMessages.length - 1] ?? "";
        settle(() => resolve({ text }));
      });
    });
  }
}

/**
 * Insert "resume <threadId>" after "exec" in the args list.
 * codex exec --json ... → codex exec resume --json ... <threadId>
 */
function injectResumeArgs(baseArgs: string[], threadId: string): string[] {
  const result: string[] = [];
  let injected = false;
  for (const arg of baseArgs) {
    result.push(arg);
    if (arg === "exec" && !injected) {
      result.push("resume");
      injected = true;
    }
  }
  if (injected) result.push(threadId);
  return result;
}

function buildPrompt(ctx: AgentContext): string {
  const lines: string[] = [];

  lines.push(`You are ${ctx.participantName} in the room "${ctx.roomName}".`);
  if (ctx.otherParticipants.length > 0) {
    const others = ctx.otherParticipants
      .map((p) => `${p.name} (${p.kind})`)
      .join(", ");
    lines.push(`Other participants: ${others}.`);
  }

  if (ctx.mode === "quick") {
    lines.push(
      "You were @mentioned with a QUICK question (the mention used the form '@name?').",
    );
    lines.push(
      "Answer briefly from the room context only. Do NOT use any tools. Do NOT read files. Do NOT run commands. Do NOT create tasks. Do NOT @mention anyone else. One short response and stop.",
    );
    lines.push(
      "If the answer is not knowable from context alone, say so in one sentence.",
    );
  } else {
    lines.push(
      "You were @mentioned. Respond directly. If you need someone else's help, use @name to mention them. If you have nothing to add, just answer without mentioning anyone. Do NOT @mention to confirm or agree — only when you need them to act.",
    );
    lines.push("");
    lines.push(
      "You have a `rebecca` CLI tool available via bash. It auto-targets your current room and identity. Use it for:",
    );
    lines.push(
      "  • `rebecca task create \"<description>\"` — create a task before starting non-trivial work. Returns the task ID.",
    );
    lines.push(
      "  • `rebecca task update <task-id> working|completed|failed` — update a task's state.",
    );
    lines.push(
      "  • `rebecca read --last <n>` — scroll back through more room history if you need more context.",
    );
    lines.push(
      "  • `rebecca task list` — see what tasks are in progress.",
    );
    lines.push(
      "Create a task whenever you start work that takes more than a quick lookup. Mark it completed when done. Skip task tracking for trivial questions.",
    );
  }
  lines.push("");

  const contextMessages = ctx.recentMessages.filter(
    (m) => m.id !== ctx.triggerMessage.id,
  );
  if (contextMessages.length > 0) {
    lines.push("<room-context>");
    for (const msg of contextMessages) {
      lines.push(`[${msg.senderName}]: ${msg.text}`);
    }
    lines.push("</room-context>");
    lines.push("");
  }

  lines.push(`[${ctx.triggerMessage.senderName}]: ${ctx.triggerMessage.text}`);
  return lines.join("\n");
}

function parseMentions(
  text: string,
  participants: Array<{ id: string; name: string }>,
  selfId: string,
): string[] | undefined {
  const pattern = /@(\w[\w-]*)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    for (const p of participants) {
      if (p.id !== selfId && p.name.toLowerCase() === name) {
        mentions.push(p.id);
        break;
      }
    }
  }

  return mentions.length > 0 ? mentions : undefined;
}
