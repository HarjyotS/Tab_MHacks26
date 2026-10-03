// SPEC §9.3 message copy. Every number and name comes in as a parameter from
// the database (P6); templates only arrange them. Where SPEC gives example
// copy, that wording is the first variant. Other variants are Tab's voice:
// friendly, brief, plain, never guilt-tripping. `seed` (usually the
// expense id) picks a variant deterministically so Tab doesn't sound canned
// but every message is reproducible.
import type { Problem } from "../extraction/types.js";
import { displayName, listJoin, money, type Person } from "./format.js";

function pick(seed: string, variants: readonly string[]): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return variants[h % variants.length]!;
}

export type Share = { person: Person; amount_cents: number };

// ── Onboarding (§7.2) ────────────────────────────────────────────────────

export const onboardingIntro = (seed: string) =>
  pick(seed, [
    `Hi, I'm Tab. I keep track of shared costs here so nobody has to.\nJust talk normally ("paid $40 for groceries") or drop a receipt photo.\nYou can remove me anytime.`,
    `Hey, I'm Tab. I keep track of who paid for what in here, so nobody has to be the spreadsheet friend.\nJust talk normally ("paid $40 for groceries") or drop a receipt photo.\nYou can remove me anytime.`,
  ]);

export const namePrompt = (seed: string) =>
  pick(seed, [
    "Reply with your first name so I know who's who.",
    "Quick one: reply with your first name so I know who's who.",
  ]);

// ── Proposals and reminders (§7.3, §7.5) ─────────────────────────────────

function shareLine(shares: Share[]): string {
  const amounts = new Set(shares.map((s) => s.amount_cents));
  if (amounts.size === 1)
    return `Split ${shares.length} ways, that's ${money(shares[0]!.amount_cents)} each.`;
  return `${shares.map((s) => `${displayName(s.person)} ${money(s.amount_cents)}`).join(", ")}.`;
}

export function splitProposal(a: {
  seed: string;
  description: string;
  total_cents: number;
  shares: Share[];
  updated?: boolean;
}): string {
  const head = `${a.updated ? "Updated: " : ""}${a.description}, ${money(a.total_cents)}. ${shareLine(a.shares)}`;
  const ask = pick(a.seed, [
    "Anything uneven, or anyone not there?",
    "Tell me if it wasn't even or someone wasn't there.",
    "Shout if it's not even or someone skipped it.",
  ]);
  return a.updated ? head : `${head}\n${ask}`;
}

export function objectionReminder(a: {
  seed: string;
  shares: Share[];
  when: string;
}): string {
  const amounts = new Set(a.shares.map((s) => s.amount_cents));
  const what =
    amounts.size === 1
      ? `${money(a.shares[0]!.amount_cents)} each`
      : "these amounts";
  return pick(a.seed, [
    `Locking in ${what} ${a.when} unless anything's off.`,
    `Heads up, ${what} gets locked in ${a.when}.`,
  ]);
}

// ── Itemizing (§7.5) ─────────────────────────────────────────────────────

export type Item = {
  position: number;
  description: string;
  amount_cents: number;
};

const itemLines = (items: Item[]) =>
  items
    .map((i) => `${i.position}. ${i.description} ${money(i.amount_cents)}`)
    .join("\n");

export function itemList(a: {
  merchant: string;
  total_cents: number;
  items: Item[];
}): string {
  return `${a.merchant}, ${money(a.total_cents)} total\n${itemLines(a.items)}\nReply with what you had, or "even" for an even share of whatever's left.`;
}

export function claimFollowupFirst(a: {
  merchant: string;
  total_cents: number;
  items: Item[];
}): string {
  return `${a.merchant}, ${money(a.total_cents)} total\n${itemLines(a.items)}\nReply with numbers, or "even".`;
}

export function claimFollowupSecond(a: {
  seed: string;
  merchant: string;
}): string {
  return pick(a.seed, [
    `Still need what you had at ${a.merchant}. Numbers, or "even".`,
    `What did you get at ${a.merchant}? Numbers work, or "even".`,
  ]);
}

export function claimLastCall(a: {
  merchant: string;
  amount_cents: number;
  when: string;
}): string {
  return `Last call on ${a.merchant}. ${a.when} I'll put you down for ${money(a.amount_cents)}\n(an even share of what's unclaimed) unless you reply with what you had.`;
}

// SPEC §7.5: several pending expenses go in one DM.
export function claimFollowupBatch(merchants: string[]): string {
  const list = merchants.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return `You have ${merchants.length} receipts waiting:\n${list}\nReply with what you had on each, or "even".`;
}

export function groupMention(a: { seed: string; person: Person }): string {
  const name = displayName(a.person);
  return pick(a.seed, [
    `${name}, check your DMs from me.`,
    `${name}, I sent you a DM.`,
  ]);
}

// ── Settling (§7.6) ──────────────────────────────────────────────────────

export function settleRequest(a: {
  seed: string;
  description: string;
  payer: Person;
  shares: Share[];
}): string {
  const owed = a.shares
    .map((s) => `${displayName(s.person)} ${money(s.amount_cents)}`)
    .join(", ");
  const head = `${a.description} is final. Owed to ${displayName(a.payer)}:\n${owed}.`;
  return `${head}\n${pick(a.seed, [
    "Tap 👍 on this message to pay your part, or reply if something's off.",
    "Are we chill? Tap 👍 to pay your part, or reply if something's off.",
  ])}`;
}

export function approvalFollowup(a: {
  seed: string;
  description: string;
  payer: Person;
  amount_cents: number;
}): string {
  const owe = `${money(a.amount_cents)} to ${displayName(a.payer)} for ${a.description}`;
  return pick(a.seed, [
    `You owe ${owe}. Reply yes to pay, or tell me what's off.`,
    `${a.description}: you're at ${money(a.amount_cents)} to ${displayName(a.payer)}. Reply yes to pay, or tell me what's off.`,
  ]);
}

// SPEC §7.6 wording: the receipt must say the settlement is simulated.
export function paymentReceipt(a: {
  payee: Person;
  amount_cents: number;
  description: string;
}): string {
  return `Simulated settlement complete: you paid ${displayName(a.payee)} ${money(a.amount_cents)} for ${a.description}.`;
}

export function allSquare(a: { seed: string; description: string }): string {
  return pick(a.seed, [
    `Everyone's square on ${a.description}.`,
    `${a.description} is all settled. Everyone's square.`,
  ]);
}

export function disputeFollowup(a: {
  seed: string;
  description: string;
  amount_cents: number;
}): string {
  return pick(a.seed, [
    `What's off with your ${money(a.amount_cents)} for ${a.description}? Tell me what you had and I'll fix it.`,
    `Got it. What did you actually have at ${a.description}? I'll redo your part.`,
  ]);
}

// ── Questions (one per extraction Problem, P2/P3) ────────────────────────

export function clarifyingQuestion(
  p: Problem,
  ctx: { description?: string; people: Person[] },
): string {
  // SPEC copy keeps the description as written: "How much was the Uber?"
  const thing = ctx.description ? `the ${ctx.description}` : "it";
  switch (p.kind) {
    case "missing_amount":
    case "ungrounded_amount":
      return `How much was ${thing}?`;
    case "missing_payer":
      return `Who paid for ${thing}?`;
    case "missing_item_price": {
      const person = ctx.people.find((x) => x.phone === p.phone);
      return `How much was ${person ? `${displayName(person)}'s` : "the"} ${p.item}?`;
    }
    case "unknown_name":
      return `Who's ${p.name}? I only know people in this chat.`;
    case "large_amount":
      return `That's ${money(p.amount_cents)} for ${thing}. Is that right?`;
    case "invalid_amount":
      return "Amounts need to be more than $0.00.";
  }
}

export const duplicateReceiptQuestion = () =>
  "Is this the same as the earlier one?";
export const foreignCurrencyQuestion = () => "What was that in dollars?";

// ── Queries (§7.8) ───────────────────────────────────────────────────────

export type Debt = { from: Person; to: Person; amount_cents: number };

export function balanceReply(a: {
  debts: Debt[];
  ledger_url?: string;
}): string {
  if (a.debts.length === 0) return "Everyone's square.";
  const lines = a.debts
    .slice(0, 6)
    .map(
      (d) =>
        `${displayName(d.from)} owes ${displayName(d.to)} ${money(d.amount_cents)}`,
    );
  const more =
    a.debts.length > 6
      ? `\n${a.debts.length - 6} more${a.ledger_url ? ` on the ledger: ${a.ledger_url}` : "."}`
      : "";
  return `Here's where things stand:\n${lines.join("\n")}${more}`;
}

export function personalBalanceReply(a: {
  owes: Debt[];
  owed: Debt[];
}): string {
  if (a.owes.length === 0 && a.owed.length === 0)
    return "You're square with everyone.";
  const parts: string[] = [];
  if (a.owes.length)
    parts.push(
      `You owe ${listJoin(a.owes.map((d) => `${displayName(d.to)} ${money(d.amount_cents)}`))}.`,
    );
  if (a.owed.length)
    parts.push(
      `${listJoin(a.owed.map((d) => `${displayName(d.from)} owes you ${money(d.amount_cents)}`))}.`,
    );
  return parts.join("\n");
}

export function breakdownReply(a: {
  lines: { description: string; amount_cents: number }[];
  ledger_url?: string;
}): string {
  if (a.lines.length === 0) return "Nothing open for you right now.";
  const body = a.lines
    .slice(0, 5)
    .map((l) => `${l.description}: ${money(l.amount_cents)}`)
    .join("\n");
  return `${body}${a.ledger_url ? `\nEverything else: ${a.ledger_url}` : ""}`;
}

export const helpReply = (seed: string) =>
  pick(seed, [
    `I keep track of shared costs in this chat.\nTell me what you paid ("got groceries, $63") or send a receipt photo, and I'll split it.\nTo remove me, just remove me from the group.`,
    `I'm Tab. I split shared costs so nobody has to do the math.\nSay what you paid ("got groceries, $63") or send a receipt photo.\nTo remove me, just remove me from the group.`,
  ]);
