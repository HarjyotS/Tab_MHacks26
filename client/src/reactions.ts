import type { ClassicReaction, EmojiReaction, Reaction } from "./types.ts";

/**
 * Tab's emoji tapbacks. Messages offers each message's tapbacks as
 * accessibility actions: the six classic ones, plus the five most recent
 * emoji (ops/seed-emoji.sh puts these five first). An emoji someone else
 * reacted with in that chat takes one of the five, so each emoji has stand-ins
 * to try in order, ending with a classic tapback, which is always there.
 */
export const TAB_EMOJI: readonly EmojiReaction[] = ["👀", "💸", "🤑", "🫡", "🎉"];

const STAND_INS: Record<EmojiReaction, Reaction[]> = {
  // "Looking at it": no classic tapback says that, so none rather than a wrong one.
  "👀": [],
  "💸": ["🤑", "love"],
  "🤑": ["💸", "love"],
  "🫡": ["like"],
  "🎉": ["🤑", "love"],
};

export const isTabEmoji = (s: string): s is EmojiReaction => (TAB_EMOJI as readonly string[]).includes(s);

/** What to try for a reaction, in order: itself, then its stand-ins. */
export function attempts(reaction: Reaction): Reaction[] {
  return isTabEmoji(reaction) ? [reaction, ...STAND_INS[reaction]] : [reaction];
}

/** The classic tapback to use where emoji can't go out (the tapback picker), if any. */
export function classicFor(reaction: Reaction): ClassicReaction | undefined {
  return attempts(reaction).find((r): r is ClassicReaction => !isTabEmoji(r));
}

/** Each tapback's accessibility action on a message bubble in Messages (macOS 26). */
const ACTION: Record<ClassicReaction, string> = {
  love: "Heart",
  like: "Thumbs up",
  dislike: "Thumbs down",
  laugh: "Ha ha!",
  emphasize: "Exclamation mark",
  question: "Question mark",
};

export const actionFor = (r: Reaction): string => (isTabEmoji(r) ? r : ACTION[r]);

/** The reaction an accessibility action puts on (tab-ax prints the one it used). */
export function reactionForAction(action: string): Reaction | undefined {
  if (isTabEmoji(action)) return action;
  return (Object.keys(ACTION) as ClassicReaction[]).find((r) => ACTION[r] === action);
}
