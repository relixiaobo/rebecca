/**
 * Parse @mentions from message text. Resolves names to participant IDs.
 */
export function parseMentions(
  text: string,
  participants: Array<{ id: string; name: string }>,
  selfId: string,
): string[] | undefined {
  // \B before @ excludes matches like email@addr.com.
  // Trailing pattern stops at whitespace, ?, !, ., ,, ;, :, or end.
  const pattern = /(?:^|\s|[(,;:])@(\w[\w-]*)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    for (const p of participants) {
      if (
        p.id !== selfId &&
        p.name.toLowerCase() === name &&
        !mentions.includes(p.id)
      ) {
        mentions.push(p.id);
        break;
      }
    }
  }

  return mentions.length > 0 ? mentions : undefined;
}

/**
 * Detect if a message starts with /btw and strip the prefix.
 * Returns { mode, text }.
 *
 * Quick mode is triggered by `/btw` (or `/q`) at the start of the line.
 * The whole message is treated as a quick aside — all @mentions in it
 * are dispatched in quick mode.
 */
export function parseModePrefix(text: string): {
  mode: "full" | "quick";
  text: string;
} {
  const trimmed = text.trimStart();
  if (/^\/btw(\s|$)/i.test(trimmed)) {
    return { mode: "quick", text: trimmed.replace(/^\/btw\s*/i, "") };
  }
  if (/^\/q(\s|$)/i.test(trimmed)) {
    return { mode: "quick", text: trimmed.replace(/^\/q\s*/i, "") };
  }
  return { mode: "full", text };
}
