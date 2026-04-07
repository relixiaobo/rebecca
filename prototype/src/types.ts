export type Participant = {
  id: string;
  name: string;
  kind: "human" | "agent";
};

export type Part = {
  text?: string;
  data?: unknown;
  url?: string;
  mediaType?: string;
};

export type Message = {
  id: string;
  senderId: string;
  parts: Part[];
  mentions?: string[];
  createdAt: string;
};

/** Helper to create a text-only message */
export function textMessage(
  senderId: string,
  text: string,
  mentions?: string[],
): Message {
  return {
    id: crypto.randomUUID(),
    senderId,
    parts: [{ text }],
    mentions,
    createdAt: new Date().toISOString(),
  };
}

/** Extract concatenated text from a message's parts */
export function messageText(message: Message): string {
  return message.parts
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export interface Connector {
  /** Initialize and join the room */
  start(): Promise<void>;

  /** Receive a message from the room */
  send(message: Message): Promise<void>;

  /** Stop and clean up */
  stop(): Promise<void>;
}
