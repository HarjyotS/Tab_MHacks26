// Tab adapts to how the group texts, the way Poke and Instinct mirror their
// users: lowercase if the group writes lowercase, decorative emoji only if
// the group uses emoji. Computed from recent human messages, so it is free
// and deterministic.

export type GroupStyle = { lowercase: boolean; emoji: boolean };

export const DEFAULT_STYLE: GroupStyle = { lowercase: false, emoji: false };

const EMOJI = /\p{Extended_Pictographic}/u;
const URL_RE = /https?:\/\/\S+/g;

export function detectStyle(recentHumanTexts: string[]): GroupStyle {
  const withLetters = recentHumanTexts.filter((t) =>
    /[a-z]/i.test(t.replace(URL_RE, "")),
  );
  const lower = withLetters.filter(
    (t) => !/[A-Z]/.test(t.replace(URL_RE, "")),
  ).length;
  return {
    lowercase: withLetters.length >= 3 && lower / withLetters.length >= 0.6,
    emoji: recentHumanTexts.some((t) => EMOJI.test(t)),
  };
}

// Lowercases everything except URLs, whose paths (ledger secrets) are case-sensitive.
export function applyStyle(text: string, style: GroupStyle): string {
  if (!style.lowercase) return text;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out += text.slice(last, m.index).toLowerCase() + m[0];
    last = m.index + m[0].length;
  }
  return out + text.slice(last).toLowerCase();
}
