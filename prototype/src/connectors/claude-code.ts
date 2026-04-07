import { spawn, type ChildProcess } from "node:child_process";
import type { Connector, Message, Participant } from "../types.js";
import { messageText, textMessage } from "../types.js";
import type { Room } from "../room.js";

export interface ClaudeCodeConnectorConfig {
  /** Path to claude CLI binary (default: "claude") */
  cliBin?: string;
  /** Working directory for the Claude Code instance */
  cwd?: string;
  /** Additional CLI flags */
  flags?: string[];
}

export class ClaudeCodeConnector implements Connector {
  private room: Room;
  private participant: Participant;
  private config: ClaudeCodeConnectorConfig;
  private process: ChildProcess | null = null;
  private buffer = "";
  private pendingResolve: ((text: string) => void) | null = null;

  constructor(
    room: Room,
    participant: Participant,
    config: ClaudeCodeConnectorConfig = {},
  ) {
    this.room = room;
    this.participant = participant;
    this.config = config;
  }

  async start() {
    const bin = this.config.cliBin ?? "claude";
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(this.config.flags ?? []),
    ];

    this.process = spawn(bin, args, {
      cwd: this.config.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(
          `\x1b[33m[${this.participant.name} stderr]\x1b[0m ${text}`,
        );
      }
    });

    this.process.on("exit", (code) => {
      console.error(
        `\x1b[33m[${this.participant.name}]\x1b[0m Process exited with code ${code}`,
      );
      this.process = null;
    });
  }

  async send(message: Message) {
    if (!this.process?.stdin?.writable) {
      console.error(`[${this.participant.name}] Process not available`);
      return;
    }

    // Build context: recent room messages + triggering message
    const context = this.buildContext(message);

    // Write NDJSON user message to stdin
    const input = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: context,
      },
      parent_tool_use_id: null,
      session_id: "",
    });

    this.process.stdin.write(input + "\n");

    // Wait for result event
    const response = await this.waitForResponse();
    if (response.trim()) {
      // Parse @mentions from agent's response
      const mentions = this.parseMentions(response.trim());
      const msg = textMessage(this.participant.id, response.trim(), mentions);
      await this.room.post(msg);
    }
  }

  async stop() {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }

  /** Build a context block with recent room history + the triggering message */
  private buildContext(triggerMessage: Message): string {
    const recentMessages = this.room.getRecentMessages(20);
    const lines: string[] = [];

    // Room context instructions
    lines.push(
      `You are ${this.participant.name} in room "${this.room.name}".`,
    );
    lines.push(
      "You are mentioned in the conversation below. Respond to what is asked of you.",
    );
    lines.push(
      "If you need another participant's help, use @name. If not, just answer without @mentioning anyone.",
    );
    lines.push(
      "Do NOT @mention someone just to confirm or agree. Only @mention when you need them to act.",
    );
    lines.push("");

    // Add recent room context (excluding the trigger itself)
    const contextMessages = recentMessages.filter(
      (m) => m.id !== triggerMessage.id,
    );
    if (contextMessages.length > 0) {
      lines.push("<room-context>");
      for (const msg of contextMessages) {
        const sender = this.room.getMember(msg.senderId);
        const name = sender?.participant.name ?? msg.senderId;
        lines.push(`[${name}]: ${messageText(msg)}`);
      }
      lines.push("</room-context>");
      lines.push("");
    }

    // Add the triggering message
    const sender = this.room.getMember(triggerMessage.senderId);
    const name = sender?.participant.name ?? triggerMessage.senderId;
    lines.push(`[${name}]: ${messageText(triggerMessage)}`);

    return lines.join("\n");
  }

  /** Parse @mentions from agent response text */
  private parseMentions(text: string): string[] | undefined {
    const mentionPattern = /@(\w[\w-]*)/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(text)) !== null) {
      const mentionName = match[1];
      for (const p of this.room.getParticipants()) {
        if (
          p.id !== this.participant.id &&
          p.name.toLowerCase() === mentionName.toLowerCase()
        ) {
          mentions.push(p.id);
          break;
        }
      }
    }

    return mentions.length > 0 ? mentions : undefined;
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
        // Ignore non-JSON lines
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
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      setTimeout(() => {
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
          resolve("");
        }
      }, 300_000);
    });
  }
}
