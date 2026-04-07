import type { Connector, Message, Participant } from "./types.js";

export interface RoomMember {
  participant: Participant;
  connector: Connector;
}

const DEFAULT_CONTEXT_SIZE = 20;

export class Room {
  readonly id: string;
  readonly name: string;
  private members = new Map<string, RoomMember>();
  private messages: Message[] = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  join(participant: Participant, connector: Connector) {
    this.members.set(participant.id, { participant, connector });
  }

  leave(participantId: string) {
    this.members.delete(participantId);
  }

  getParticipants(): Participant[] {
    return Array.from(this.members.values()).map((m) => m.participant);
  }

  getMember(participantId: string): RoomMember | undefined {
    return this.members.get(participantId);
  }

  /** Get the last N messages from history */
  getRecentMessages(n: number = DEFAULT_CONTEXT_SIZE): Message[] {
    return this.messages.slice(-n);
  }

  /** Post a message to the room. Stores in history, delivers to relevant members. */
  async post(message: Message) {
    // Store in history
    this.messages.push(message);

    const promises: Promise<void>[] = [];

    for (const [id, member] of this.members) {
      // Don't echo back to sender
      if (id === message.senderId) continue;

      if (member.participant.kind === "agent") {
        // Agents only receive messages when @mentioned
        if (!message.mentions?.includes(id)) continue;
      }

      // Humans always receive all messages

      promises.push(
        member.connector.send(message).catch((err) => {
          console.error(
            `[room] Failed to deliver to ${member.participant.name}:`,
            err,
          );
        }),
      );
    }

    await Promise.all(promises);
  }
}
