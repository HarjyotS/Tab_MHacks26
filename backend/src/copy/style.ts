// Tab adapts to how the group texts, the way Poke and Instinct mirror their
// users: lowercase if the group writes lowercase, decorative emoji only if
// the group uses emoji, and no trailing periods if the group doesn't use
// them. Built from per-message flags, so no message text is kept for it.

export type GroupStyle = {
  lowercase: boolean;
  emoji: boolean;
  periods: boolean;
};

export const DEFAULT_STYLE: GroupStyle = {
  lowercase: false,
  emoji: false,
  periods: true,
};

// What one message says about the group's style. Holds no text.
export type StyleFlags = {
  letters: boolean;
  lowercase: boolean;
  emoji: boolean;
  period: boolean;
};

const EMOJI = /\p{Extended_Pictographic}/u;
const URL_RE = /https?:\/\/\S+/g;

export function styleFlags(text: string): StyleFlags {
  const t = text.replace(URL_RE, "").trim();
  return {
    letters: /[a-z]/i.test(t),
    lowercase: !/[A-Z]/.test(t),
    emoji: EMOJI.test(t),
    period: /\.$/.test(t),
  };
}

export function styleFromFlags(flags: StyleFlags[]): GroupStyle {
  const worded = flags.filter((f) => f.letters);
  const enough = worded.length >= 3;
  return {
    lowercase:
      enough && worded.filter((f) => f.lowercase).length / worded.length >= 0.6,
    emoji: flags.some((f) => f.emoji),
    periods:
      !enough || worded.filter((f) => f.period).length / worded.length >= 0.3,
  };
}

export const detectStyle = (texts: string[]): GroupStyle =>
  styleFromFlags(texts.map(styleFlags));

// Lowercases everything except URLs (ledger secrets are case-sensitive), and
// drops periods at the end of lines when the group doesn't use them. Amounts
// like $63.75 are untouched: only a period that ends a line goes.
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
  if (!style.periods) out = out.replace(/(?<!\.)\.(?=\n|$)/g, "");
  return out;
}
