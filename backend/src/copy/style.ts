// How Tab's texts look on screen. Tab texts like a person in the group chat
// (voice.ts), so by default every message is lowercase with no trailing
// periods, however the group itself types. The one thing Tab mirrors is
// emoji: decorative emoji only once the group uses them. Built from
// per-message flags, so no message text is kept for it.

export type GroupStyle = {
  lowercase: boolean;
  emoji: boolean;
  periods: boolean;
};

export const DEFAULT_STYLE: GroupStyle = {
  lowercase: true,
  emoji: false,
  periods: false,
};

// What one message says about the group's style. Holds no text.
export type StyleFlags = {
  emoji: boolean;
};

const EMOJI = /\p{Extended_Pictographic}/u;
const URL_RE = /https?:\/\/\S+/g;
// Decorative emoji (with any modifiers or joins), and the space before them.
// 👍 is an instruction ("tap 👍 to pay"), not decoration, so it always stays.
const DECORATIVE_EMOJI =
  /[ \t]*(?!\u{1F44D})\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/gu;

export function styleFlags(text: string): StyleFlags {
  return { emoji: EMOJI.test(text.replace(URL_RE, "")) };
}

export function styleFromFlags(flags: StyleFlags[]): GroupStyle {
  return { ...DEFAULT_STYLE, emoji: flags.some((f) => f.emoji) };
}

export const detectStyle = (texts: string[]): GroupStyle =>
  styleFromFlags(texts.map(styleFlags));

// Lowercases everything except URLs (ledger secrets are case-sensitive),
// drops periods at the end of lines, and drops decorative emoji the group
// hasn't earned. Amounts like $63.75 are untouched: only a period that ends
// a line goes.
export function applyStyle(text: string, style: GroupStyle): string {
  let out = text;
  if (style.lowercase) {
    let lowered = "";
    let last = 0;
    for (const m of out.matchAll(URL_RE)) {
      lowered += out.slice(last, m.index).toLowerCase() + m[0];
      last = m.index + m[0].length;
    }
    out = lowered + out.slice(last).toLowerCase();
  }
  if (!style.emoji) out = out.replace(DECORATIVE_EMOJI, "");
  if (!style.periods) out = out.replace(/(?<!\.)\.(?=\n|$)/g, "");
  return out;
}
