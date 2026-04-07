import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentContext,
  AgentResponse,
} from "./types.js";

export class ClaudeCodeRunner implements AgentRunner {
  private config: AgentRunnerConfig;
  private process: ChildProcess | null = null;
  private buffer = "";
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private stopRequested = false;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
  }

  onExit(callback: (code: number | null) => void) {
    this.exitCallbacks.push(callback);
  }

  async start() {
    // Default args for stream-json mode
    const args = this.config.args.length
      ? this.config.args
      : [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
        ];

    this.process = spawn(this.config.command, args, {
      cwd: this.config.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[claude-code stderr] ${text}`);
      }
    });

    this.process.on("exit", (code) => {
      this.process = null;
      // Reject any pending invocation
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingReject = null;
        this.pendingResolve = null;
        reject(new Error(`Process exited with code ${code}`));
      }
      // Notify only on unexpected exit
      if (!this.stopRequested) {
        for (const cb of this.exitCallbacks) cb(code);
      }
    });
  }

  async invoke(context: AgentContext): Promise<AgentResponse> {
    if (!this.process?.stdin?.writable) {
      throw new Error("Claude Code process not available");
    }

    const prompt = buildPrompt(context);

    const input = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: prompt,
      },
      parent_tool_use_id: null,
      session_id: "",
    });

    this.process.stdin.write(input + "\n");

    const text = await this.waitForResponse();
    const mentions = parseMentions(text, context.otherParticipants, context.participantId);

    return { text: text.trim(), mentions };
  }

  async stop() {
    this.stopRequested = true;
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }

  isReady(): boolean {
    return this.process?.stdin?.writable === true;
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        this.handleEvent(event);
      } catch {
        // ignore non-JSON
      }
    }
  }

  private handleEvent(event: Record<string, unknown>) {
    if (event.type === "result" && this.pendingResolve) {
      const text = (event.result as string) ?? "";
      this.pendingResolve(text);
      this.pendingResolve = null;
    }
  }

  private waitForResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      setTimeout(() => {
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
          this.pendingReject = null;
          resolve("");
        }
      }, 300_000);
    });
  }
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
  lines.push("");

  // Recent context (excluding trigger)
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
