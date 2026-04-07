import * as readline from "node:readline";
import type { Connector, Message, Participant } from "../types.js";
import { messageText, textMessage } from "../types.js";
import type { Room } from "../room.js";

export class HumanConnector implements Connector {
  private rl: readline.Interface | null = null;
  private room: Room;
  private participant: Participant;

  constructor(room: Room, participant: Participant) {
    this.room = room;
    this.participant = participant;
  }

  async start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const { text, mentions } = this.parseMentions(trimmed);
      const message = textMessage(this.participant.id, text, mentions);
      this.room.post(message);
    });

    this.rl.on("close", () => {
      process.exit(0);
    });

    this.prompt();
  }

  async send(message: Message) {
    const sender = this.room.getMember(message.senderId);
    const name = sender?.participant.name ?? message.senderId;
    const text = messageText(message);

    // Clear current line, print message, re-prompt
    process.stdout.write(`\r\x1b[K`);
    console.log(`\x1b[36m[${name}]\x1b[0m ${text}`);
    this.prompt();
  }

  async stop() {
    this.rl?.close();
    this.rl = null;
  }

  private prompt() {
    this.rl?.setPrompt(`\x1b[32m[${this.participant.name}]\x1b[0m `);
    this.rl?.prompt();
  }

  /** Parse @mentions from input text */
  private parseMentions(text: string): {
    text: string;
    mentions: string[] | undefined;
  } {
    const mentionPattern = /@(\w[\w-]*)/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(text)) !== null) {
      const name = match[1];
      // Resolve mention name to participant id
      for (const p of this.room.getParticipants()) {
        if (
          p.id !== this.participant.id &&
          p.name.toLowerCase() === name.toLowerCase()
        ) {
          mentions.push(p.id);
          break;
        }
      }
    }

    return {
      text,
      mentions: mentions.length > 0 ? mentions : undefined,
    };
  }
}
