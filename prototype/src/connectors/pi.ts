import type { Connector, Message, Participant } from "../types.js";
import { messageText, textMessage } from "../types.js";
import type { Room } from "../room.js";
import {
  bashTool,
  createAgentSession,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

export interface PiConnectorConfig {
  /** Model spec, e.g. "anthropic/claude-sonnet-4-20250514" */
  model?: string;
  /** System prompt for this agent */
  systemPrompt?: string;
  /** Working directory */
  cwd?: string;
}

export class PiConnector implements Connector {
  private room: Room;
  private participant: Participant;
  private config: PiConnectorConfig;
  private session: AgentSession | null = null;
  private busy = false;

  constructor(
    room: Room,
    participant: Participant,
    config: PiConnectorConfig = {},
  ) {
    this.room = room;
    this.participant = participant;
    this.config = config;
  }

  async start() {
    const model = this.resolveModel();

    const { session } = await createAgentSession({
      cwd: this.config.cwd ?? process.cwd(),
      model,
      tools: [bashTool],
    });

    this.session = session;

    // Build system prompt with room context and @mention instructions
    const roomMembers = this.room
      .getParticipants()
      .filter((p) => p.id !== this.participant.id)
      .map((p) => `${p.name} (${p.kind})`)
      .join(", ");

    const basePrompt =
      this.config.systemPrompt ??
      `You are ${this.participant.name}, an AI agent.`;
    session.agent.state.systemPrompt = `${basePrompt}

You are in a collaboration room "${this.room.name}" with: ${roomMembers}.

You will receive messages only when someone @mentions you.
The message will include recent room context so you can see what was discussed.

When you respond:
- Reply directly with your response. Do not prefix with your name.
- If you need another participant's help, use @name to mention them.
- If you have nothing to add, just give your answer without @mentioning anyone.
- Do NOT @mention someone just to confirm or agree. Only @mention when you need them to act.
- Be concise.`;

    // Subscribe to agent events — post response back to room
    session.subscribe((event) => {
      if (event.type === "agent_end" && event.messages.length > 0) {
        this.busy = false;

        const lastMsg = event.messages[event.messages.length - 1];
        if (lastMsg.role === "assistant") {
          const text = lastMsg.content
            .filter((c): c is { type: "text"; text: string } => "text" in c)
            .map((c) => c.text)
            .join("\n");

          if (text.trim()) {
            // Parse @mentions from agent's response
            const mentions = this.parseMentions(text.trim());
            const message = textMessage(
              this.participant.id,
              text.trim(),
              mentions,
            );
            this.room.post(message);
          }
        }
      }
    });
  }

  async send(message: Message) {
    if (!this.session) return;

    // Build context: recent room messages + triggering message
    const context = this.buildContext(message);

    if (this.busy) {
      await this.session.steer(context);
    } else {
      this.busy = true;
      await this.session.prompt(context);
    }
  }

  async stop() {
    this.session = null;
  }

  /** Build a context block with recent room history + the triggering message */
  private buildContext(triggerMessage: Message): string {
    const recentMessages = this.room.getRecentMessages(20);
    const lines: string[] = [];

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

  private resolveModel() {
    const spec = this.config.model;
    if (spec) {
      const [provider, ...rest] = spec.split("/");
      return getModel(provider, rest.join("/"));
    }
    const providers = [
      {
        key: "ANTHROPIC_API_KEY",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      },
      { key: "OPENAI_API_KEY", provider: "openai", model: "gpt-5.4" },
      { key: "GEMINI_API_KEY", provider: "google", model: "gemini-2.5-pro" },
    ] as const;
    for (const p of providers) {
      if (process.env[p.key]) {
        return getModel(p.provider, p.model);
      }
    }
    return undefined;
  }
}
