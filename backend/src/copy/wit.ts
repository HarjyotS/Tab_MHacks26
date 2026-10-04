// An optional one-line personality touch from Grok, added around a template
// (SPEC §9.3 [YOUR CALL]). Code decides when one is allowed; Grok decides
// whether anything is worth saying (usually not); code validates the line and
// drops it if it breaks any rule. A dropped line just means the plain
// template goes out, which is always fine.
import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import type { OutboxPurpose } from "../db/types.js";
import type { GroupStyle } from "./style.js";
import { bannedPhraseIn, MARKDOWN, PERSONA } from "./voice.js";

// Light moments only. Never on money asks, reminders, disputes, or questions.
export const WIT_PURPOSES = new Set<OutboxPurpose>([
  "onboarding_intro",
  "all_square",
]);

const MAX_LENGTH = 80;
const EMOJI = /\p{Extended_Pictographic}/u;
const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dollars?|bucks|cents?|grand)\b/i;

export type WitContext = {
  purpose: OutboxPurpose;
  // What just happened, in words, with no amounts.
  moment: string;
  // Names Tab may mention. Any other member name invalidates the line.
  allowed_names: string[];
  all_member_names: string[];
  style: GroupStyle;
  // Never two witty lines in a row in the same chat (Poke: no back-to-back jokes).
  previous_had_wit: boolean;
};

export function witAllowed(
  ctx: Pick<WitContext, "purpose" | "previous_had_wit">,
): boolean {
  return WIT_PURPOSES.has(ctx.purpose) && !ctx.previous_had_wit;
}

export type WitRejection =
  | "multiline"
  | "too_long"
  | "number"
  | "name"
  | "banned_phrase"
  | "emoji"
  | "question"
  | "markdown";

// Returns why a line can't be sent, or null if it's fine.
export function rejectWit(line: string, ctx: WitContext): WitRejection | null {
  if (/\n/.test(line)) return "multiline";
  if (line.length > MAX_LENGTH) return "too_long";
  if (/[\d$%]/.test(line) || NUMBER_WORDS.test(line)) return "number";
  const allowed = new Set(ctx.allowed_names.map((n) => n.toLowerCase()));
  const words = new Set(line.toLowerCase().match(/[a-z']+/g) ?? []);
  if (
    ctx.all_member_names.some(
      (n) => words.has(n.toLowerCase()) && !allowed.has(n.toLowerCase()),
    )
  )
    return "name";
  if (bannedPhraseIn(line)) return "banned_phrase";
  if (!ctx.style.emoji && EMOJI.test(line)) return "emoji";
  if (line.includes("?")) return "question";
  if (MARKDOWN.test(line)) return "markdown";
  return null;
}

const raw = z.object({ line: z.string().nullable() });
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["line"],
  properties: { line: { type: ["string", "null"] } },
};

const SYSTEM = `${PERSONA}

Tab is about to send a short message in a group chat, and you write ONE extra line for it, the way a friend would tack on a second text. This moment is a good one for a line, so write one: warm, or a little dry and funny about this exact group and moment. Return null only if every idea you have is generic.

Rules for the line:
- Under 12 words. One sentence. No question. All lowercase, no trailing period, no exclamation marks.
- Never mention any amount, number, or price. Never mention anyone by name unless they are listed as allowed.
- Original and natural, like a person texting. No stock jokes, no puns on money, no "lol" filler.
- Never sound like an assistant or customer support. Never offer help.
- Use an emoji only if the group style below says the group uses them.
`;

export async function witLine(
  client: ChatClient,
  model: string,
  ctx: WitContext,
  // Called when no line is sent, with the reason. For logging and tuning.
  onDrop?: (raw: string | null, why: WitRejection | "declined") => void,
): Promise<string | null> {
  if (!witAllowed(ctx)) return null;
  const user = [
    `Moment: ${ctx.moment}`,
    `Names you may use: ${ctx.allowed_names.join(", ") || "(none)"}`,
    `Group style: ${ctx.style.emoji ? "uses emoji (one common emoji is ok)" : "no emoji"}`,
  ].join("\n");
  const r = await structuredCall({
    client,
    model,
    system: SYSTEM,
    user,
    name: "wit_line",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });
  const line = r.line?.trim();
  if (!line) {
    onDrop?.(r.line, "declined");
    return null;
  }
  const why = rejectWit(line, ctx);
  if (why) onDrop?.(line, why);
  return why === null ? line : null;
}
