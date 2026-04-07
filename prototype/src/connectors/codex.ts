import { spawn } from "node:child_process";
import type { Connector, Message, Participant } from "../types.js";
import { messageText, textMessage } from "../types.js";
import type { Room } from "../room.js";

export interface CodexConnectorConfig {
  /** Path to codex CLI binary (default: "codex") */
  cliBin?: string;
  /** Working directory for the Codex instance */
  cwd?: string;
  /** Model override (default: codex default) */
  model?: string;
}

export class CodexConnector implements Connector {
  private room: Room;
  private participant: Participant;
  private config: CodexConnectorConfig;
  private threadId: string | null = null;

  constructor(
    room: Room,
    participant: Participant,
    config: CodexConnectorConfig = {},
  ) {
    this.room = room;
    this.participant = participant;
    this.config = config;
  }

  async start() {
    // Codex is one-shot per message. Nothing to start.
    // Verify the binary exists.
    try {
      const bin = this.config.cliBin ?? "codex";
      const check = spawn(bin, ["--version"], { stdio: ["pipe", "pipe", "pipe"] });
      await new Promise<void>((resolve, reject) => {
        check.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`${bin} not found`)),
        );
        check.on("error", reject);
      });
    } catch (err) {
      console.error(
        `\x1b[33m[${this.participant.name}]\x1b[0m Codex CLI not available:`,
        err,
      );
    }
  }

  async send(message: Message) {
    const sender = this.room.getMember(message.senderId);
    const name = sender?.participant.name ?? message.senderId;
    const text = messageText(message);
    const formatted = `[${name}]: ${text}`;

    const response = await this.exec(formatted);
    if (response.trim()) {
      const msg = textMessage(this.participant.id, response.trim());
      await this.room.post(msg);
    }
  }

  async stop() {
    this.threadId = null;
  }

  private exec(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const bin = this.config.cliBin ?? "codex";
      const args: string[] = ["exec"];

      // Resume existing thread or start new
      if (this.threadId) {
        args.push("resume", "--json", "--full-auto", this.threadId);
      } else {
        args.push("--json", "--full-auto");
      }

      if (this.config.model) {
        args.push("-m", this.config.model);
      }

      args.push("--skip-git-repo-check");

      args.push(prompt);

      const proc = spawn(bin, args, {
        cwd: this.config.cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let buffer = "";
      const events: Record<string, unknown>[] = [];

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
        const text = chunk.toString().trim();
        if (text) {
          console.error(
            `\x1b[33m[${this.participant.name} stderr]\x1b[0m ${text}`,
          );
        }
      });

      proc.on("close", (code) => {
        if (code !== 0 && code !== null) {
          const errorEvent = events.find(
            (e) => e.type === "error" || e.type === "turn.failed",
          );
          const errorMsg =
            (errorEvent as { message?: string })?.message ??
            `codex exited with code ${code}`;
          console.error(
            `\x1b[33m[${this.participant.name}]\x1b[0m ${errorMsg}`,
          );
        }

        // Extract thread ID
        const threadEvent = events.find((e) => e.type === "thread.started");
        if (threadEvent && "thread_id" in threadEvent) {
          this.threadId = threadEvent.thread_id as string;
        }

        // Extract last agent message
        const agentMessages = events
          .filter(
            (e) =>
              e.type === "item.completed" &&
              (e.item as { type?: string })?.type === "agent_message",
          )
          .map((e) => ((e.item as { text?: string })?.text ?? ""));

        const lastMessage = agentMessages[agentMessages.length - 1] ?? "";
        resolve(lastMessage);
      });

      proc.on("error", reject);
    });
  }
}
