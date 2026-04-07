export interface AgentMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  mentions?: string[];
  createdAt: string;
}

export type InvocationMode = "full" | "quick";

export interface AgentContext {
  /** The agent's own participant ID */
  participantId: string;
  /** The agent's display name */
  participantName: string;
  /** Room ID and name */
  roomId: string;
  roomName: string;
  /** Other room participants */
  otherParticipants: Array<{ id: string; name: string; kind: string }>;
  /** Recent room messages (last N) */
  recentMessages: AgentMessage[];
  /** The message that triggered this invocation */
  triggerMessage: AgentMessage;
  /** Invocation mode: full = use tools, may take time; quick = answer from context only */
  mode: InvocationMode;
}

export interface AgentResponse {
  text: string;
  mentions?: string[];
}

/**
 * Represents a running agent process. Each runner manages one agent's
 * subprocess and translates between Room messages and the agent's protocol.
 */
export interface AgentRunner {
  /** Start the underlying process */
  start(): Promise<void>;

  /** Send context to the agent and wait for its response */
  invoke(context: AgentContext): Promise<AgentResponse>;

  /** Stop the underlying process */
  stop(): Promise<void>;

  /** Whether the runner is healthy and ready */
  isReady(): boolean;

  /** Subscribe to unexpected exit events */
  onExit(callback: (code: number | null) => void): void;
}

export interface AgentRunnerConfig {
  cwd?: string;
  env?: Record<string, string>;
  command: string;
  args: string[];
}
