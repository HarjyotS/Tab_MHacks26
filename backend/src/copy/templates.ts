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

// Joe's copy (replaces SPEC 7.3's countdown): a light check-in, and about an
// hour later the settle request.
export const objectionReminder = () => "Anything else?";

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





// Claim nudges go in the group chat, by name (Joe's call; SPEC P5 and §7.5
// say DMs). The last one quotes the amount they'll be assigned.
export function claimNudge(a: { seed: string; person: Person; merchant: string; step: 1 | 2 }): string {
  const name = displayName(a.person);
  return a.step === 1
    ? pick(a.seed, [`${name}, what did you have at ${a.merchant}? Numbers from the list, or "even".`, `${name}, what was yours at ${a.merchant}? Numbers, or "even".`])
    : `${name}, still need yours for ${a.merchant}. Numbers, or "even".`;
}

export function claimLastCall(a: { person: Person; merchant: string; amount_cents: number; when: string }): string {
  return `Last call, ${displayName(a.person)}: ${a.when} I'll put you down for ${money(a.amount_cents)} for ${a.merchant} (an even share of what's unclaimed) unless you say what you had.`;
}

// ── Settling (§7.6) ──────────────────────────────────────────────────────

// One settle request (SPEC #15). Per-expense mode covers one expense; ledger
// mode covers everything outstanding, grouped by who is owed.
export type Owed = { payee: Person; shares: Share[] };

export function settleRequest(a: { seed: string; owed: Owed[]; description?: string }): string {
  const tap = pick(a.seed, [
    "Tap 👍 on this message to pay your part, or reply if something's off.",
    "Are we chill? Tap 👍 to pay your part, or reply if something's off.",
  ]);
  const list = (shares: Share[]) => shares.map((s) => `${displayName(s.person)} ${money(s.amount_cents)}`).join(", ");
  if (a.owed.length === 1) {
    const o = a.owed[0]!;
    return `Cool, here's what's owed to ${displayName(o.payee)}${a.description ? ` for ${a.description}` : ""}:\n${list(o.shares)}.\n${tap}`;
  }
  return `Cool, here's what's owed:\n${a.owed.map((o) => `Owed to ${displayName(o.payee)}: ${list(o.shares)}`).join("\n")}\n${tap}`;
}

// A typed "yes" never moves money (P7, SPEC #15).
export const tapToPay = () => "Tap 👍 on the settle request to pay your part.";

export const nothingToSettle = () => "Nothing to settle. Everyone's square.";

// "let's settle up" while expenses are still open (Harjyot's playground test).
export function notLockedYet(open: { description: string; total_cents: number }[]): string {
  const what = listJoin(open.map((e) => `${e.description} (${money(e.total_cents)})`));
  return open.length === 1
    ? `${what} isn't locked in yet. I'll include it once it is.`
    : `${what} aren't locked in yet. I'll include them once they are.`;
}

// One line confirming the settle-mode answer (SPEC #15).
export const settleModeSet = (mode: "ledger" | "per_expense") =>
  mode === "ledger"
    ? 'Got it, I\'ll keep a running tab. Say "settle up" whenever.'
    : "Got it, I'll settle after each expense.";

// §7.7: a locked-in expense with money already moving can't change.
export const cantChangePaid = (description: string) =>
  `${description} is already being paid, so I can't change it. Log the difference as a new expense.`;

export const settleModeQuestion = () =>
  'Got a trip coming up? I\'ll keep a running tab and settle everyone up at the end. Reply "each" if you\'d rather settle after every expense.';

// SPEC #15: one DM once all of a person's approved transfers are done.
export function paymentConfirmation(a: { paid: { payee: Person; amount_cents: number }[]; label?: string; allSquare: boolean }): string {
  const what = listJoin(a.paid.map((p) => `${displayName(p.payee)} ${money(p.amount_cents)}`));
  return `Simulated settlement complete: you paid ${what}${a.label ? ` for ${a.label}` : ""}.${a.allSquare ? " All square." : ""}`;
}

// §7.6: a friendly nudge in the group by name (P5). Money moves only on a
// 👍, so every nudge ends by pointing to it (P7).
export function approvalFollowup(a: {
  seed: string;
  person: Person;
  owed: { payee: Person; amount_cents: number }[];
  step: 1 | 2 | 3;
}): string {
  const name = displayName(a.person);
  const owe = listJoin(a.owed.map((o) => `${displayName(o.payee)} ${money(o.amount_cents)}`));
  const tap = "Tap 👍 on the settle request to pay.";
  if (a.step === 3) return `${name}, last nudge from me: you owe ${owe}. ${tap}`;
  return a.step === 1
    ? pick(a.seed, [`${name}, you owe ${owe}. ${tap}`, `${name}, you're at ${owe}. ${tap}`])
    : `${name}, still ${owe} from you. ${tap}`;
}

// SPEC §7.6 wording: the receipt must say the settlement is simulated.
export function allSquare(a: { seed: string; description: string }): string {
  return pick(a.seed, [
    `Everyone's square on ${a.description}.`,
    `${a.description} is all settled. Everyone's square.`,
  ]);
}

export function disputeFollowup(a: {
  seed: string;
  description?: string; // absent when the request covered several expenses
  amount_cents: number;
}): string {
  if (!a.description)
    return `What's off with your ${money(a.amount_cents)}? Tell me what you had and I'll fix it.`;
  return pick(a.seed, [
    `What's off with your ${money(a.amount_cents)} for ${a.description}? Tell me what you had and I'll fix it.`,
    `Got it. What did you actually have at ${a.description}? I'll redo your part.`,
  ]);
}

// §7.6: the disputer's new amount is in. In the group the new settle request
// says it; this line is for a DM, or when there's no request to approve.
export function disputeResolved(a: { description: string; amount_cents: number; requested: boolean }): string {
  return `Fixed: you're down for ${money(a.amount_cents)} for ${a.description}.${a.requested ? " Tap 👍 on the new settle request to pay." : ""}`;
}

// The payer's share absorbs a dispute (§7.6), so it caps the new amount.
export const disputeTooMuch = (a: { description: string; max_cents: number }) =>
  `Your part of ${a.description} can be at most ${money(a.max_cents)}. What did you actually have?`;

// An amount for a dispute that covered several expenses.
export const whichDispute = (items: { description: string; amount_cents: number }[]) =>
  `Which one?\n${items.map((i, n) => `${n + 1}. ${i.description} (${money(i.amount_cents)})`).join("\n")}`;

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

// One line per expense behind a debt, with why it's that amount. Every
// number and name comes from the database (P6).
export type OwedLine = { description: string; amount_cents: number; why: string };

// Just the amounts. "why" gets the explanation (breakdownReply).
export function personalBalanceReply(a: { owes: Debt[]; owed: Debt[] }): string {
  if (a.owes.length === 0 && a.owed.length === 0) return "You're square with everyone.";
  const parts: string[] = [];
  if (a.owes.length) parts.push(`You owe ${listJoin(a.owes.map((d) => `${displayName(d.to)} ${money(d.amount_cents)}`))}.`);
  if (a.owed.length) parts.push(`${listJoin(a.owed.map((d) => `${displayName(d.from)} owes you ${money(d.amount_cents)}`))}.`);
  return parts.join("\n");
}

export function breakdownReply(a: { lines: OwedLine[]; ledger_url?: string }): string {
  if (a.lines.length === 0) return "Nothing open for you right now.";
  const body = a.lines.slice(0, 5).map((l) => `${l.description} ${money(l.amount_cents)}: ${l.why}`).join("\n");
  return `${body}${a.ledger_url ? `\nEverything else: ${a.ledger_url}` : ""}`;
}

export const helpReply = (seed: string) =>
  pick(seed, [
    `I keep track of shared costs in this chat.\nTell me what you paid ("got groceries, $63") or send a receipt photo, and I'll split it.\nAsk "what do I owe" anytime, or say "settle up" to square up. To remove me, just remove me from the group.`,
    `I'm Tab. I split shared costs so nobody has to do the math.\nSay what you paid ("got groceries, $63") or send a receipt photo.\nAsk "what do I owe" to see the tab, or say "settle up" to square everyone up. To remove me, just remove me from the group.`,
  ]);
