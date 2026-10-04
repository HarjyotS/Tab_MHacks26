// A short Grok summary of a long "@Tab breakdown" (§7.8). The records come
// from SpacetimeDB and the headline ("Alex owes Jordan $90.70") is written by
// code; Grok only writes the reason after it, from those records. Code checks
// every reason: each dollar amount must be one of that pair's amounts, no
// other member may be named, one short line. Anything that fails, or a slow
// or failed call, means the full itemized list goes out instead (P6).
import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import { money } from "./format.js";
import type { BreakdownPair } from "./templates.js";
import { bannedPhraseIn, MARKDOWN, PERSONA } from "./voice.js";

export type SummaryInput = { pairs: BreakdownPair[]; member_names: string[] };

const MAX_LENGTH = 120;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})?/g;
const BARE_DECIMAL = /(?<![$\d,.])\d+\.\d{2}\b/;
const MONEY_WORDS = /\b(dollars?|bucks|cents?|grand|hundred|thousand)\b/i;

export type SummaryRejection = "multiline" | "too_long" | "amount" | "order" | "name" | "banned_phrase" | "markdown" | "question" | "empty";

// "X, less Y": what adds to the debt comes first, what's owed back after.
const LESS = /\b(less|minus|offset by|after)\b/i;
const centsIn = (text: string) =>
  [...text.matchAll(MONEY)].map((m) => Math.round(Number(m[1]!.replace(/,/g, "") + (m[2] ?? "")) * 100));

// The amounts a pair's reason may mention: each share, each expense total, the net.
const allowedCents = (p: BreakdownPair) =>
  new Set([p.net_cents, ...p.events.flatMap((e) => [Math.abs(e.signed_cents), e.total_cents])]);

export function rejectReason(reason: string, pair: BreakdownPair, member_names: string[]): SummaryRejection | null {
  const line = reason.trim();
  if (!line) return "empty";
  if (/\n/.test(line)) return "multiline";
  if (line.length > MAX_LENGTH) return "too_long";
  const allowed = allowedCents(pair);
  if (centsIn(line).some((c) => !allowed.has(c))) return "amount";
  // Shares on the wrong side read as the reverse debt ("Priya's pizza, less
  // Alex's groceries" under "Alex owes Priya"): before "less" only what adds
  // to the debt, after it only what's owed back. Totals may go anywhere.
  const totals = new Set(pair.events.map((e) => e.total_cents));
  const adds = new Set(pair.events.filter((e) => e.signed_cents > 0).map((e) => e.signed_cents));
  const back = new Set(pair.events.filter((e) => e.signed_cents < 0).map((e) => -e.signed_cents));
  const [before, ...after] = line.split(LESS);
  const side = (cents: number[], ok: Set<number>) => cents.every((c) => ok.has(c) || totals.has(c) || c === pair.net_cents);
  if (!side(centsIn(before!), adds) || !side(centsIn(after.join(" ")), back)) return "order";
  if (BARE_DECIMAL.test(line) || MONEY_WORDS.test(line)) return "amount";
  const involved = new Set([pair.debtor, pair.creditor, ...pair.events.flatMap((e) => [e.payer, e.debtor])].map((n) => n.toLowerCase()));
  // Bare words, so "Priya's" still counts as naming Priya.
  const words = new Set(line.toLowerCase().match(/[a-z]+/g) ?? []);
  if (member_names.some((n) => words.has(n.toLowerCase()) && !involved.has(n.toLowerCase()))) return "name";
  if (bannedPhraseIn(line)) return "banned_phrase";
  if (MARKDOWN.test(line)) return "markdown";
  if (line.includes("?")) return "question";
  return null;
}

const raw = z.object({ reasons: z.array(z.string()) });
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasons"],
  properties: { reasons: { type: "array", items: { type: "string" } } },
};

const SYSTEM = `${PERSONA}

Someone asked Tab where their balances come from. You get each balance between two people, already worked out, with the expense records behind it. For each balance, in the same order, write ONE short reason that says which expenses it comes from.

Rules for each reason:
- Under 15 words, one line, no question. It follows a headline like "Alex owes Jordan $90.70:", so don't repeat the headline.
- Name the expenses briefly ("sushi platter", "pizza", "uber"). Combine expenses with the same name.
- Start with the "+" records (what makes the first person owe), then write "less" and the "-" records (what is owed back). Never put a "-" record before "less".
- You may use only dollar amounts that appear in that balance's records, written exactly as given (like $100.70). Never compute a new amount, never round, never write amounts in words.
- Mention only the two people in that balance.
- Plain text, no markdown, no emoji. Friendly and clear, like a friend explaining a tab.

Example. Records: "+ $100.70 Alex's share of Sushi (omakase platter + tax), Jordan paid $114.48", "- $10.00 Jordan's share of Pizza (split 5 ways), Alex paid $50.00".
Reason: "Alex's sushi platter ($100.70), less Jordan's pizza share ($10.00)"`;

function render(input: SummaryInput): string {
  return input.pairs
    .map((p, i) =>
      [
        `${i + 1}. ${p.net_cents === 0 ? `${p.debtor} and ${p.creditor} are even` : `${p.debtor} owes ${p.creditor} ${money(p.net_cents)}`}`,
        ...p.events.map(
          (e) =>
            `   ${e.signed_cents >= 0 ? "+" : "-"} ${money(Math.abs(e.signed_cents))} ${e.debtor}'s share of ${e.description} (${e.why}), ${e.payer} paid ${money(e.total_cents)} on ${e.when}`,
        ),
      ].join("\n"),
    )
    .join("\n");
}

// One reason per pair, or null when any reason fails a check.
export async function summarizeBreakdown(
  client: ChatClient,
  model: string,
  input: SummaryInput,
  onDrop?: (why: SummaryRejection | "count", reason?: string) => void,
): Promise<string[] | null> {
  const r = await structuredCall({
    client,
    model,
    system: SYSTEM,
    user: render(input),
    name: "breakdown_summary",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });
  if (r.reasons.length !== input.pairs.length) {
    onDrop?.("count");
    return null;
  }
  const reasons = r.reasons.map((x) => x.trim().replace(/[.\s]+$/, ""));
  for (const [i, reason] of reasons.entries()) {
    const why = rejectReason(reason, input.pairs[i]!, input.member_names);
    if (why) {
      onDrop?.(why, reason);
      return null;
    }
  }
  return reasons;
}
