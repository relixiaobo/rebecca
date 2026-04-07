/**
 * Parse @mentions and @name? quick mentions from text. Resolves names against
 * the participant list. Returns:
 *  - mentions: all participant IDs mentioned (full + quick)
 *  - quickMentions: subset that used the `?` suffix
 */
export function parseMentionsWithMode(
  text: string,
  participants: Array<{ id: string; name: string }>,
  selfId: string,
): { mentions: string[]; quickMentions: string[] } {
  // Match @name optionally followed by ? (greedy on word chars + dashes)
  const pattern = /@(\w[\w-]*)(\?)?/g;
  const mentions: string[] = [];
  const quickMentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    const isQuick = match[2] === "?";
    for (const p of participants) {
      if (p.id !== selfId && p.name.toLowerCase() === name) {
        if (!mentions.includes(p.id)) mentions.push(p.id);
        if (isQuick && !quickMentions.includes(p.id)) {
          quickMentions.push(p.id);
        }
        break;
      }
    }
  }

  return { mentions, quickMentions };
}
