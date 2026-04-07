import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { ClaudeCodeRunner } from "./claude-code.js";
import { CodexRunner } from "./codex.js";
import { ensureRebeccaCliAvailable } from "./cli-bin.js";
import type {
  AgentRunner,
  AgentContext,
  AgentMessage,
} from "./types.js";

export interface PostMessageFn {
  (
    roomId: string,
    senderId: string,
    text: string,
    mentions?: string[],
  ): Promise<void>;
}

export interface SetStatusFn {
  (participantId: string, status: string, message?: string): void;
}

export interface BroadcastFn {
  (roomId: string, event: Record<string, unknown>): void;
}

interface PendingMention {
  roomId: string;
  messageId: string;
}

interface RunningAgent {
  participantId: string;
  roomId: string;
  type: string;
  runner: AgentRunner;
  busy: boolean;
  queue: PendingMention[];
  restartAttempts: number;
  restartTimer: NodeJS.Timeout | null;
}

const RECENT_CONTEXT_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const RESTART_BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

export class AgentManager {
  private db: Db;
  private postMessage: PostMessageFn;
  private setStatus: SetStatusFn;
  private broadcast: BroadcastFn;
  private agents = new Map<string, RunningAgent>();
  private shuttingDown = false;
  private cliBinDir: string;
  private serverUrl: string;

  constructor(
    db: Db,
    postMessage: PostMessageFn,
    setStatus: SetStatusFn,
    broadcast: BroadcastFn,
    serverUrl: string,
  ) {
    this.db = db;
    this.postMessage = postMessage;
    this.setStatus = setStatus;
    this.broadcast = broadcast;
    this.serverUrl = serverUrl;
    this.cliBinDir = ensureRebeccaCliAvailable();
  }

  /** Build the env block passed to spawned agent processes */
  private buildAgentEnv(roomId: string, participantId: string): Record<string, string> {
    const path = `${this.cliBinDir}:${process.env.PATH ?? ""}`;
    return {
      REBECCA_URL: this.serverUrl,
      REBECCA_ROOM: roomId,
      REBECCA_PARTICIPANT: participantId,
      PATH: path,
    };
  }

  async startAll() {
    const configs = this.db.select().from(schema.agentConfigs).all();
    for (const config of configs) {
      if (config.autoStart) {
        await this.startAgent(config.participantId).catch((err) => {
          console.error(
            `[agent-manager] Failed to start ${config.participantId}:`,
            err,
          );
        });
      }
    }
  }

  async startRoom(roomId: string) {
    const configs = this.db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.roomId, roomId))
      .all();
    for (const config of configs) {
      if (config.autoStart) {
        await this.startAgent(config.participantId).catch((err) => {
          console.error(
            `[agent-manager] Failed to start ${config.participantId}:`,
            err,
          );
        });
      }
    }
  }

  async startAgent(participantId: string) {
    if (this.agents.has(participantId)) {
      console.log(`[agent-manager] ${participantId} already running`);
      return;
    }

    const config = this.db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.participantId, participantId))
      .get();

    if (!config) {
      throw new Error(`No config for ${participantId}`);
    }

    const userEnv = config.env ? JSON.parse(config.env) : {};
    const rebeccaEnv = this.buildAgentEnv(config.roomId, participantId);
    const env = { ...userEnv, ...rebeccaEnv };
    const [command, ...args] = parseCommand(config.runCommand);

    let runner: AgentRunner;
    switch (config.type) {
      case "claude-code":
        runner = new ClaudeCodeRunner({
          command,
          args,
          cwd: config.cwd ?? undefined,
          env,
        });
        break;
      case "codex":
        runner = new CodexRunner({
          command,
          args,
          cwd: config.cwd ?? undefined,
          env,
        });
        break;
      default:
        throw new Error(`Unknown agent type: ${config.type}`);
    }

    const agent: RunningAgent = {
      participantId,
      roomId: config.roomId,
      type: config.type,
      runner,
      busy: false,
      queue: [],
      restartAttempts: 0,
      restartTimer: null,
    };

    // Wire up exit handler for auto-restart
    runner.onExit((code) => {
      console.error(
        `[agent-manager] ${participantId} exited unexpectedly (code: ${code})`,
      );
      this.handleUnexpectedExit(agent);
    });

    try {
      await runner.start();
      this.agents.set(participantId, agent);
      this.setStatus(participantId, "online");
      console.log(`[agent-manager] Started ${participantId}`);

      // Deliver any pending mentions from before this agent was online
      this.deliverPendingMentions(agent).catch((err) => {
        console.error(
          `[agent-manager] Failed to deliver pending mentions for ${participantId}:`,
          err,
        );
      });
    } catch (err) {
      this.setStatus(participantId, "error", String(err));
      throw err;
    }
  }

  async stopAgent(participantId: string) {
    const agent = this.agents.get(participantId);
    if (!agent) return;
    if (agent.restartTimer) {
      clearTimeout(agent.restartTimer);
      agent.restartTimer = null;
    }
    await agent.runner.stop();
    this.agents.delete(participantId);
    this.setStatus(participantId, "offline");
  }

  async stopAll() {
    this.shuttingDown = true;
    for (const id of Array.from(this.agents.keys())) {
      await this.stopAgent(id);
    }
  }

  /** Handle an incoming @mention notification */
  async handleMention(
    roomId: string,
    mentionedId: string,
    messageId: string,
  ) {
    const agent = this.agents.get(mentionedId);

    if (!agent) {
      // Agent not running. Check if it's a known agent (has config)
      const config = this.db
        .select()
        .from(schema.agentConfigs)
        .where(eq(schema.agentConfigs.participantId, mentionedId))
        .get();

      if (config) {
        // Known agent but not running — post system notice
        const participant = this.db
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.id, mentionedId))
          .get();
        const name = participant?.name ?? mentionedId;
        const status = participant?.status ?? "offline";
        await this.postMessage(
          roomId,
          "system",
          `${name} is currently ${status}. Message saved — they will see it when back online.`,
        );
      }
      return;
    }

    if (agent.busy) {
      if (agent.queue.length < MAX_QUEUE_SIZE) {
        agent.queue.push({ roomId, messageId });
        console.log(
          `[agent-manager] ${mentionedId} busy, queued (depth: ${agent.queue.length})`,
        );
      } else {
        console.error(
          `[agent-manager] ${mentionedId} queue full, dropping mention`,
        );
      }
      return;
    }

    await this.invokeAgent(agent, roomId, messageId);
  }

  private async invokeAgent(
    agent: RunningAgent,
    roomId: string,
    messageId: string,
  ) {
    agent.busy = true;
    this.setStatus(agent.participantId, "working");

    try {
      const context = this.buildContext(roomId, agent.participantId, messageId);
      if (!context) {
        agent.busy = false;
        return;
      }

      const response = await agent.runner.invoke(context);
      if (response.text && response.text.trim()) {
        await this.postMessage(
          roomId,
          agent.participantId,
          response.text.trim(),
          response.mentions,
        );
      }
      agent.restartAttempts = 0;
    } catch (err) {
      console.error(
        `[agent-manager] Invoke error for ${agent.participantId}:`,
        err,
      );
      this.setStatus(agent.participantId, "error", String(err));
    } finally {
      agent.busy = false;
      const a = this.agents.get(agent.participantId);
      if (a && a.runner.isReady()) {
        this.setStatus(agent.participantId, "online");
        // Drain queue
        if (a.queue.length > 0) {
          const next = a.queue.shift()!;
          // Schedule rather than recurse
          setImmediate(() => {
            this.invokeAgent(a, next.roomId, next.messageId).catch((e) =>
              console.error("[agent-manager] Drain error:", e),
            );
          });
        }
      }
    }
  }

  private handleUnexpectedExit(agent: RunningAgent) {
    if (this.shuttingDown) return;

    this.agents.delete(agent.participantId);
    this.setStatus(
      agent.participantId,
      "error",
      `Process exited unexpectedly`,
    );

    const delay =
      RESTART_BACKOFF[
        Math.min(agent.restartAttempts, RESTART_BACKOFF.length - 1)
      ];
    agent.restartAttempts += 1;

    console.log(
      `[agent-manager] Restarting ${agent.participantId} in ${delay}ms (attempt ${agent.restartAttempts})`,
    );

    agent.restartTimer = setTimeout(() => {
      this.startAgent(agent.participantId).catch((err) => {
        console.error(
          `[agent-manager] Restart failed for ${agent.participantId}:`,
          err,
        );
        // Schedule another attempt
        this.handleUnexpectedExit(agent);
      });
    }, delay);
  }

  /** When agent comes online, find any unhandled @mentions and process them */
  private async deliverPendingMentions(agent: RunningAgent) {
    // Find messages mentioning this agent that don't have a later response from it
    const allMessages = this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, agent.roomId))
      .all();

    // Find the timestamp of this agent's most recent message
    const lastResponse = allMessages
      .filter((m) => m.senderId === agent.participantId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0];

    const cutoff = lastResponse?.createdAt ?? "";

    const pending = allMessages.filter((m) => {
      if (m.createdAt <= cutoff) return false;
      if (!m.mentions) return false;
      try {
        const mentions = JSON.parse(m.mentions);
        return Array.isArray(mentions) && mentions.includes(agent.participantId);
      } catch {
        return false;
      }
    });

    if (pending.length === 0) return;

    console.log(
      `[agent-manager] Delivering ${pending.length} pending mention(s) to ${agent.participantId}`,
    );

    for (const msg of pending) {
      // Process sequentially to respect the queue
      if (agent.busy) {
        agent.queue.push({ roomId: agent.roomId, messageId: msg.id });
      } else {
        await this.invokeAgent(agent, agent.roomId, msg.id);
      }
    }
  }

  private buildContext(
    roomId: string,
    participantId: string,
    triggerMessageId: string,
  ): AgentContext | null {
    const room = this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .get();
    if (!room) return null;

    const self = this.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, participantId))
      .get();
    if (!self) return null;

    const members = this.db
      .select()
      .from(schema.roomMembers)
      .innerJoin(
        schema.participants,
        eq(schema.roomMembers.participantId, schema.participants.id),
      )
      .where(eq(schema.roomMembers.roomId, roomId))
      .all();

    const otherParticipants = members
      .map((m) => m.participants)
      .filter((p) => p.id !== participantId)
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind }));

    const messages = this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .all()
      .slice(-RECENT_CONTEXT_SIZE);

    const senderNameCache = new Map<string, string>();
    const resolveSenderName = (senderId: string): string => {
      if (senderId === "system") return "system";
      if (senderNameCache.has(senderId)) return senderNameCache.get(senderId)!;
      const p = this.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, senderId))
        .get();
      const name = p?.name ?? senderId.split("/").pop() ?? senderId;
      senderNameCache.set(senderId, name);
      return name;
    };

    const recentMessages: AgentMessage[] = messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: resolveSenderName(m.senderId),
      text: extractText(m.content),
      mentions: m.mentions ? JSON.parse(m.mentions) : undefined,
      createdAt: m.createdAt,
    }));

    let triggerMessage = recentMessages.find((m) => m.id === triggerMessageId);
    if (!triggerMessage) {
      const trigger = this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, triggerMessageId))
        .get();
      if (!trigger) return null;
      triggerMessage = {
        id: trigger.id,
        senderId: trigger.senderId,
        senderName: resolveSenderName(trigger.senderId),
        text: extractText(trigger.content),
        mentions: trigger.mentions ? JSON.parse(trigger.mentions) : undefined,
        createdAt: trigger.createdAt,
      };
    }

    return {
      participantId,
      participantName: self.name,
      roomId,
      roomName: room.name,
      otherParticipants,
      recentMessages,
      triggerMessage,
    };
  }
}

function parseCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of cmd) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function extractText(content: string): string {
  try {
    const parts = JSON.parse(content);
    if (Array.isArray(parts)) {
      return parts
        .map((p: any) => p.text ?? "")
        .filter(Boolean)
        .join("\n");
    }
    return String(content);
  } catch {
    return content;
  }
}
