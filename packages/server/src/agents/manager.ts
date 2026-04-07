import { eq, asc, and } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { ClaudeCodeRunner } from "./claude-code.js";
import { CodexRunner } from "./codex.js";
import { ensureRebeccaCliAvailable } from "./cli-bin.js";
import type { InvocationMode } from "./types.js";
import type {
  AgentRunner,
  AgentContext,
  AgentMessage,
} from "./types.js";

export interface PostMessageOptions {
  clearPendingMention?: { participantId: string; messageId: string };
}

export interface PostMessageFn {
  (
    roomId: string,
    senderId: string,
    text: string,
    mentions?: string[],
    options?: PostMessageOptions,
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
  mode: InvocationMode;
}

interface RunningAgent {
  participantId: string;
  roomId: string;
  type: string;
  runner: AgentRunner;
  busy: boolean;
  draining: boolean;
  queue: PendingMention[];
  restartTimer: NodeJS.Timeout | null;
}

const RECENT_CONTEXT_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const RESTART_BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

// Whitelist of host env vars to inherit. Anything not in this list is dropped
// unless the agent's own config provides it, to keep the attack surface small
// while still letting common tooling work. API keys for LLM providers and HTTP
// proxies are included because most agent runtimes rely on them.
const ENV_INHERIT_KEYS = new Set([
  // System basics
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "SSH_AUTH_SOCK",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  // Network / proxies
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Common LLM provider credentials
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "COHERE_API_KEY",
  "OPENROUTER_API_KEY",
  "HF_TOKEN",
]);

export class AgentManager {
  private db: Db;
  private postMessage: PostMessageFn;
  private setStatus: SetStatusFn;
  private broadcast: BroadcastFn;
  private agents = new Map<string, RunningAgent>();
  private restartAttempts = new Map<string, number>();
  private shuttingDown = false;
  private cliBinDir: string;
  private serverUrl: string;
  private token: string;

  constructor(
    db: Db,
    postMessage: PostMessageFn,
    setStatus: SetStatusFn,
    broadcast: BroadcastFn,
    serverUrl: string,
    token: string,
  ) {
    this.db = db;
    this.postMessage = postMessage;
    this.setStatus = setStatus;
    this.broadcast = broadcast;
    this.serverUrl = serverUrl;
    this.token = token;
    this.cliBinDir = ensureRebeccaCliAvailable();
  }

  /** Build a minimal env for spawned agents (whitelist + REBECCA_*). */
  private buildAgentEnv(
    roomId: string,
    participantId: string,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of ENV_INHERIT_KEYS) {
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
    // Prepend cli bin to PATH
    env.PATH = `${this.cliBinDir}:${env.PATH ?? ""}`;
    env.REBECCA_URL = this.serverUrl;
    env.REBECCA_ROOM = roomId;
    env.REBECCA_PARTICIPANT = participantId;
    env.REBECCA_TOKEN = this.token;
    return env;
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
    const baseEnv = this.buildAgentEnv(config.roomId, participantId);
    // userEnv can add or override general host vars, but REBECCA_* always
    // reflects the actual room/participant/server and cannot be spoofed.
    const env: Record<string, string> = { ...baseEnv, ...userEnv };
    env.REBECCA_URL = this.serverUrl;
    env.REBECCA_ROOM = config.roomId;
    env.REBECCA_PARTICIPANT = participantId;
    env.REBECCA_TOKEN = this.token;
    // Also ensure our cli bin dir is on PATH
    env.PATH = `${this.cliBinDir}:${env.PATH ?? ""}`;
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
      draining: false,
      queue: [],
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

      // Replay any undelivered pending mentions for this agent
      this.replayPendingMentions(agent).catch((err) => {
        console.error(
          `[agent-manager] Failed to replay pending mentions for ${participantId}:`,
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
    this.restartAttempts.delete(participantId);
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
    mode: InvocationMode = "full",
  ) {
    // Record this mention as pending. We'll mark it delivered after a
    // successful invocation. Only record for known agents.
    const config = this.db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.participantId, mentionedId))
      .get();

    if (config && config.roomId === roomId) {
      // UNIQUE (participant_id, message_id) enforces idempotency
      this.db
        .insert(schema.pendingMentions)
        .values({
          participantId: mentionedId,
          roomId,
          messageId,
        })
        .onConflictDoNothing()
        .run();
    }

    const agent = this.agents.get(mentionedId);

    if (!agent) {
      // Agent not running. Check if it's a known agent (has config)
      const config = this.db
        .select()
        .from(schema.agentConfigs)
        .where(eq(schema.agentConfigs.participantId, mentionedId))
        .get();

      if (config && config.roomId === roomId) {
        // Known agent in this room but not running — post system notice
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

    // Cross-room safety: verify the agent belongs to this room
    if (agent.roomId !== roomId) {
      console.warn(
        `[agent-manager] Refusing cross-room mention: ${mentionedId} is in ${agent.roomId}, mention came from ${roomId}`,
      );
      return;
    }

    // Always enqueue. The drain loop guarantees serial processing.
    if (agent.queue.length >= MAX_QUEUE_SIZE) {
      console.error(
        `[agent-manager] ${mentionedId} queue full, dropping mention`,
      );
      return;
    }
    agent.queue.push({ roomId, messageId, mode });

    if (!agent.draining) {
      this.drainQueue(agent).catch((err) =>
        console.error(`[agent-manager] drain error for ${mentionedId}:`, err),
      );
    } else {
      console.log(
        `[agent-manager] ${mentionedId} busy, queued (depth: ${agent.queue.length})`,
      );
    }
  }

  /** Drain the agent's mention queue serially. Only one drain runs at a time. */
  private async drainQueue(agent: RunningAgent) {
    if (agent.draining) return;
    agent.draining = true;

    try {
      while (agent.queue.length > 0) {
        const next = agent.queue.shift()!;
        await this.invokeAgent(agent, next.roomId, next.messageId, next.mode);

        // If runner died during invocation, stop draining
        if (!agent.runner.isReady() || !this.agents.has(agent.participantId)) {
          break;
        }
      }
    } finally {
      agent.draining = false;
      agent.busy = false;
      if (
        this.agents.has(agent.participantId) &&
        agent.runner.isReady()
      ) {
        this.setStatus(agent.participantId, "online");
      }
    }
  }

  /** Invoke the agent for one message. Caller manages queue/drain state. */
  private async invokeAgent(
    agent: RunningAgent,
    roomId: string,
    messageId: string,
    mode: InvocationMode = "full",
  ) {
    agent.busy = true;
    this.setStatus(agent.participantId, "working");

    try {
      const context = this.buildContext(
        roomId,
        agent.participantId,
        messageId,
        mode,
      );
      if (!context) return;

      const response = await agent.runner.invoke(context);
      if (response.text && response.text.trim()) {
        // Atomically insert the response and delete the pending mention.
        await this.postMessage(
          roomId,
          agent.participantId,
          response.text.trim(),
          response.mentions,
          {
            clearPendingMention: {
              participantId: agent.participantId,
              messageId,
            },
          },
        );
      } else {
        // No response text, but still clear the pending mention so we don't
        // replay an empty invocation forever.
        this.db
          .delete(schema.pendingMentions)
          .where(
            and(
              eq(schema.pendingMentions.participantId, agent.participantId),
              eq(schema.pendingMentions.messageId, messageId),
            ),
          )
          .run();
      }
      // Reset persistent restart attempts on a successful invocation
      this.restartAttempts.delete(agent.participantId);
    } catch (err) {
      console.error(
        `[agent-manager] Invoke error for ${agent.participantId}:`,
        err,
      );
      this.setStatus(agent.participantId, "error", String(err));
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

    // Persistent attempt counter — survives across RunningAgent recreations
    const prev = this.restartAttempts.get(agent.participantId) ?? 0;
    const delay = RESTART_BACKOFF[Math.min(prev, RESTART_BACKOFF.length - 1)];
    this.restartAttempts.set(agent.participantId, prev + 1);

    console.log(
      `[agent-manager] Restarting ${agent.participantId} in ${delay}ms (attempt ${prev + 1})`,
    );

    setTimeout(() => {
      if (this.shuttingDown) return;
      this.startAgent(agent.participantId).catch((err) => {
        console.error(
          `[agent-manager] Restart failed for ${agent.participantId}:`,
          err,
        );
        // Treat the failed restart as another unexpected exit so backoff escalates
        this.handleUnexpectedExit(agent);
      });
    }, delay);
  }

  /** When agent comes online, replay any undelivered pending mentions */
  private async replayPendingMentions(agent: RunningAgent) {
    const pending = this.db
      .select()
      .from(schema.pendingMentions)
      .where(eq(schema.pendingMentions.participantId, agent.participantId))
      .orderBy(asc(schema.pendingMentions.createdAt))
      .all();

    if (pending.length === 0) return;

    console.log(
      `[agent-manager] Replaying ${pending.length} pending mention(s) for ${agent.participantId}`,
    );

    for (const row of pending) {
      // Only enqueue if it's for this agent's room
      if (row.roomId !== agent.roomId) continue;
      if (agent.queue.length >= MAX_QUEUE_SIZE) break;
      // Replays always use full mode — quick mode is for live-attention only
      agent.queue.push({
        roomId: row.roomId,
        messageId: row.messageId,
        mode: "full",
      });
    }

    if (!agent.draining && agent.queue.length > 0) {
      this.drainQueue(agent).catch((err) =>
        console.error(
          `[agent-manager] replay drain error for ${agent.participantId}:`,
          err,
        ),
      );
    }
  }

  private buildContext(
    roomId: string,
    participantId: string,
    triggerMessageId: string,
    mode: InvocationMode = "full",
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
      .orderBy(asc(schema.messages.createdAt))
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
      mode,
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
