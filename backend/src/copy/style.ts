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

// Marks an emoji in Tab's own template words as decoration: shown only once
// the group uses emoji. Emoji people typed (a "🍕 night" description) and 👍
// in "tap 👍 to pay" aren't marked, so they always stay.
export const DECO = "";
export const deco = (emoji: string) => `${DECO}${emoji}`;
const DECORATIVE = /[ \t]*\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/gu;

export function styleFlags(text: string): StyleFlags {
  return { emoji: EMOJI.test(text.replace(URL_RE, "")) };
}

export function styleFromFlags(flags: StyleFlags[]): GroupStyle {
  return { ...DEFAULT_STYLE, emoji: flags.some((f) => f.emoji) };
}

export const detectStyle = (texts: string[]): GroupStyle =>
  styleFromFlags(texts.map(styleFlags));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Lowercases a stretch of text, then puts member names back the way they
// were saved ("DJ", "McKenzie"): Tab knows people by their names.
function lower(text: string, names: string[]): string {
  const out = text.toLowerCase();
  const saved = new Map<string, string>();
  for (const n of names) if (n && !saved.has(n.toLowerCase())) saved.set(n.toLowerCase(), n);
  if (saved.size === 0) return out;
  const words = [...saved.keys()].sort((a, b) => b.length - a.length).map(escape);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${words.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return out.replace(re, (w) => saved.get(w) ?? w);
}

// Lowercases everything except URLs (ledger secrets are case-sensitive) and
// member names, drops periods at the end of lines, and drops Tab's
// decorative emoji until the group uses emoji. Amounts like $63.75 are
// untouched: only a period that ends a line goes.
export function applyStyle(text: string, style: GroupStyle, names: string[] = []): string {
  let out = text;
  if (style.lowercase) {
    let lowered = "";
    let last = 0;
    for (const m of out.matchAll(URL_RE)) {
      lowered += lower(out.slice(last, m.index), names) + m[0];
      last = m.index + m[0].length;
    }
    out = lowered + lower(out.slice(last), names);
  }
  out = style.emoji ? out.replaceAll(DECO, "") : out.replace(DECORATIVE, "").replaceAll(DECO, "");
  if (!style.periods) out = out.replace(/(?<!\.)\.(?=\n|$)/g, "");
  return out;
}
