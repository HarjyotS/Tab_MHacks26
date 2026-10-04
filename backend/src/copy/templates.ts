// SPEC §9.3 message copy. Every number and name comes in as a parameter from
// the database (P6); templates only arrange them. The voice (voice.ts) is a
// chill friend in the group chat who keeps the tab: lowercase, short, warm,
// a little dry, never a help desk. Templates are written lowercase; names
// and descriptions come in as stored, and compose() lowercases the whole
// message and drops trailing periods. One thought per line rather than
// sentences with periods. `seed` (usually the expense id) picks a variant
// deterministically so Tab doesn't sound canned but every message is
// reproducible.
import type { Problem } from "../extraction/types.js";
import { displayName, listJoin, money, type Person } from "./format.js";
import { deco } from "./style.js";

function pick(seed: string, variants: readonly string[]): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return variants[h % variants.length]!;
}

export type Share = { person: Person; amount_cents: number };

// ── Onboarding (§7.2) ────────────────────────────────────────────────────

// 👋 shows only if the group uses emoji (style.ts), so it gets its own line.
export const onboardingIntro = (seed: string) =>
  pick(seed, [
    `hey i'm tab ${deco("👋")}\ni keep track of who paid for what so nobody has to be the spreadsheet friend\njust say what you paid ("paid 40 for groceries") or drop a receipt pic. you can remove me anytime`,
    `hey i'm tab ${deco("👋")}\ni keep the group's tab so nobody has to do the math\njust talk like normal ("got groceries 40") or drop a receipt pic. you can kick me out whenever`,
  ]);

export const namePrompt = (seed: string) =>
  pick(seed, [
    "what should i call everyone? reply w your first name",
    "drop your first names so i know who's who",
    "what's everyone's name? just reply w your first name",
  ]);

// ── Proposals and reminders (§7.3, §7.5) ─────────────────────────────────

function shareLine(a: { description: string; total_cents: number; shares: Share[] }): string {
  const amounts = new Set(a.shares.map((s) => s.amount_cents));
  if (amounts.size === 1)
    return `${a.description} ${money(a.total_cents)} split ${a.shares.length} ways, so ${money(a.shares[0]!.amount_cents)} each`;
  return `${a.description} ${money(a.total_cents)}: ${a.shares.map((s) => `${displayName(s.person)} ${money(s.amount_cents)}`).join(", ")}`;
}

export function splitProposal(a: {
  seed: string;
  description: string;
  total_cents: number;
  shares: Share[];
  updated?: boolean;
}): string {
  const line = shareLine(a);
  if (a.updated)
    return `${pick(a.seed, ["ok redid it", "fixed it"])}: ${line}`;
  const ask = pick(a.seed, [
    "lmk if it wasn't even or someone skipped",
    "shout if it wasn't even or someone wasn't there",
    "not even, or someone sat it out? just say",
  ]);
  return `${line}\n${ask}`;
}

// Joe's copy (replaces SPEC 7.3's countdown): a light check-in, and about an
// hour later the settle request.
export const objectionReminder = () => "anything else?";

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
  return `${a.merchant}, ${money(a.total_cents)} total\n${itemLines(a.items)}\nreply w what you had (numbers work), or "even" for a share of whatever's left`;
}

// Claim nudges go in the group chat, by name (Joe's call; SPEC P5 and §7.5
// say DMs). The last one quotes the amount they'll be assigned.
export function claimNudge(a: { seed: string; person: Person; merchant: string; step: 1 | 2 }): string {
  const name = displayName(a.person);
  return a.step === 1
    ? pick(a.seed, [
        `${name}, what'd you get at ${a.merchant}? numbers from the list, or "even"`,
        `${name} what was yours at ${a.merchant}? numbers or "even" works`,
      ])
    : pick(a.seed, [
        `${name} still need yours for ${a.merchant} whenever, numbers or "even"`,
        `${name}, no rush, just need yours for ${a.merchant}. numbers or "even"`,
      ]);
}

export function claimLastCall(a: { person: Person; merchant: string; amount_cents: number; when: string }): string {
  return `last call ${displayName(a.person)}: ${a.when} i'll put you down for ${money(a.amount_cents)} for ${a.merchant} (an even share of what's unclaimed) unless you say what you had`;
}

// A claim Tab couldn't match to the list.
export const whichItems = (seed: string) =>
  pick(seed, ['which ones? just the numbers, or "even"', 'wait which ones? numbers from the list, or "even"']);

// §14: two open lists in a DM.
export const whichList = (descriptions: string[]) =>
  `which one?\n${descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`;

// ── Settling (§7.6) ──────────────────────────────────────────────────────

// One settle request (SPEC #15). Per-expense mode covers one expense; ledger
// mode covers everything outstanding, grouped by who is owed.
export type Owed = { payee: Person; shares: Share[] };

export function settleRequest(a: { seed: string; owed: Owed[]; description?: string }): string {
  const tap = pick(a.seed, [
    "tap 👍 on this to pay your part, or reply if something's off",
    "are we chill? tap 👍 to pay your part, or reply if something's off",
  ]);
  const list = (shares: Share[]) => shares.map((s) => `${displayName(s.person)} ${money(s.amount_cents)}`).join(", ");
  if (a.owed.length === 1) {
    const o = a.owed[0]!;
    return `cool, here's what's owed to ${displayName(o.payee)}${a.description ? ` for ${a.description}` : ""}:\n${list(o.shares)}\n${tap}`;
  }
  return `cool, here's what's owed:\n${a.owed.map((o) => `owed to ${displayName(o.payee)}: ${list(o.shares)}`).join("\n")}\n${tap}`;
}

// A typed "yes" never moves money (P7, SPEC #15).
export const tapToPay = () => "just tap 👍 on the settle msg to pay your part";

export const nothingToSettle = () => "nothing to settle, everyone's even";

// "let's settle up" while a receipt is still waiting on claims (Harjyot's
// playground test): a real question, so "yeah lock it in" does something.
// Two lines, one question.
export function notLockedYet(open: { description: string; total_cents: number }[]): string {
  const what = listJoin(open.map((e) => `${e.description} (${money(e.total_cents)})`));
  return `still waiting on claims for ${what}\nsplit what's unclaimed evenly and settle now?`;
}

// SPEC §12.3: the web ledger link, one per group when asked by DM.
export function ledgerLink(links: { name?: string; url: string }[]): string {
  if (links.length === 1) return `here's the ledger: ${links[0]!.url}`;
  return `here are your ledgers:\n${links.map((l) => `${l.name ?? "group"}: ${l.url}`).join("\n")}`;
}

export const noLedger = () => "the ledger site isn't set up yet";

// §7.7: a receipt's total comes from its items.
export const receiptTotalFixed = (description: string) =>
  `${description} goes by the receipt's items, so i can't just change the total\nwhich item's off?`;

// One line confirming the settle-mode answer (SPEC #15).
export const settleModeSet = (mode: "ledger" | "per_expense") =>
  mode === "ledger"
    ? 'bet, running tab it is\nsay "settle up" whenever'
    : "bet, i'll settle up after each one";

// §7.7: a locked-in expense with money already moving can't change.
export const cantChangePaid = (description: string) =>
  `${description} is already being paid, so i can't change it\njust log the difference as a new expense`;

export const settleModeQuestion = () =>
  'trip coming up? i\'ll keep a running tab and square everyone up at the end\nsay "each" if you\'d rather settle as you go';

// SPEC #15: one DM once all of a person's approved transfers are done.
// SPEC §7.6: it must say the settlement is simulated.
export function paymentConfirmation(a: { paid: { payee: Person; amount_cents: number }[]; label?: string; allSquare: boolean }): string {
  const what = listJoin(a.paid.map((p) => `${displayName(p.payee)} ${money(p.amount_cents)}`));
  return `done, you paid ${what}${a.label ? ` for ${a.label}` : ""} (simulated, no real money moved)${a.allSquare ? "\nyou're all square" : ""}`;
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
  const tap = "no rush, just tap 👍 on the settle msg when you can";
  if (a.step === 3) return `last nudge from me ${name}, promise: you owe ${owe}\n${tap}`;
  return a.step === 1
    ? pick(a.seed, [`hey ${name}, you owe ${owe}\n${tap}`, `${name} heads up, you owe ${owe}\n${tap}`])
    : `${name} just bumping this, you owe ${owe}\n${tap}`;
}

// 🎉 shows only if the group uses emoji (style.ts). Without a description
// the settle request covered several expenses.
export function allSquare(a: { seed: string; description?: string }): string {
  if (!a.description)
    return pick(a.seed, [`and that's everyone square ${deco("🎉")}`, `everyone's square, nice ${deco("🎉")}`]);
  return pick(a.seed, [
    `everyone's square on ${a.description} ${deco("🎉")}`,
    `${a.description} is all settled, everyone's square`,
    `and that's everyone square on ${a.description}`,
  ]);
}

// A 👎 or ❓ on a proposal.
export const whatsOff = (seed: string) => pick(seed, ["what's off?", "ah what's off?"]);

export function disputeFollowup(a: {
  seed: string;
  description?: string; // absent when the request covered several expenses
  amount_cents: number;
}): string {
  if (!a.description)
    return `what's off with your ${money(a.amount_cents)}? say what you had and i'll fix it`;
  return pick(a.seed, [
    `what's off with your ${money(a.amount_cents)} for ${a.description}? say what you had and i'll fix it`,
    `ah ok, what'd you actually have at ${a.description}? i'll redo your part`,
  ]);
}

// §7.6: the disputer's new amount is in. In the group the new settle request
// says it; this line is for a DM, or when there's no request to approve.
export function disputeResolved(a: { description: string; amount_cents: number; requested: boolean }): string {
  return `fixed, you're down for ${money(a.amount_cents)} for ${a.description}${a.requested ? "\ntap 👍 on the new settle msg to pay" : ""}`;
}

// The payer's share absorbs a dispute (§7.6), so it caps the new amount.
export const disputeTooMuch = (a: { description: string; max_cents: number }) =>
  `hm your part of ${a.description} can't be more than ${money(a.max_cents)}, what'd you actually have?`;

// An amount for a dispute that covered several expenses.
export const whichDispute = (items: { description: string; amount_cents: number }[]) =>
  `which one?\n${items.map((i, n) => `${n + 1}. ${i.description} (${money(i.amount_cents)})`).join("\n")}`;

// An answer Tab couldn't use: say so once and ask the question again, on
// the same line so a list question keeps its line count.
export const answerFollowup = (question: string, onReceipt: boolean) =>
  `${onReceipt ? "hm can't find that on the receipt" : "hm didn't catch that"}, ${question}`;

// ── Questions (one per extraction Problem, P2/P3) ────────────────────────

// "both drinks" reads as "drinks" after a name ("Alex's drinks"); a count
// stays ("2 soft drinks"). Plural when the count is more than one, or the
// item reads plural.
const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, both: 2 };
function itemLabel(raw: string): { item: string; plural: boolean } {
  const item = raw.trim().replace(/^((a|an|both|all|of|the|those|these|my|our|his|her|their)\s+)+/i, "") || raw.trim();
  const first = raw.trim().toLowerCase().match(/^(\d+|a|an|one|two|three|four|five|six|both)\b/)?.[1];
  const count = first === undefined ? undefined : Number(first) || COUNT_WORDS[first];
  const plural = count !== undefined ? count > 1 : /[^s]s$/i.test(item);
  return { item, plural };
}

export function clarifyingQuestion(
  p: Problem,
  ctx: { description?: string; people: Person[] },
): string {
  // The description stays as written: "how much was the Uber?"
  const thing = ctx.description ? `the ${ctx.description}` : "it";
  switch (p.kind) {
    case "missing_amount":
    case "ungrounded_amount":
      return `how much was ${thing}?`;
    case "missing_payer":
      return `who paid for ${thing}?`;
    case "missing_item_price": {
      const person = ctx.people.find((x) => x.phone === p.phone);
      const { item, plural } = itemLabel(p.item);
      return `how much ${plural ? "were" : "was"} ${person ? `${displayName(person)}'s` : "the"} ${item}?`;
    }
    case "unknown_name":
      return `wait who's ${p.name}? don't think they're in here`;
    case "large_amount":
      return `${money(p.amount_cents)}${ctx.description ? ` for ${ctx.description}` : ""}? just making sure`;
    case "invalid_amount":
      return `how much was ${thing} actually? has to be more than ${money(0)}`;
  }
}

// The same question once more, said differently, when the first didn't land
// (Tab never asks the exact same thing twice in a row). Undefined when there
// is no better way to put it: Tab just stops asking.
export function rephraseQuestion(
  p: Problem,
  ctx: { description?: string; people: Person[]; example_cents?: number },
): string | undefined {
  const thing = ctx.description ? `the ${ctx.description}` : "it";
  switch (p.kind) {
    case "missing_item_price": {
      const person = ctx.people.find((x) => x.phone === p.phone);
      const example = ctx.example_cents ? ` like ${money(ctx.example_cents)}` : "";
      return `how much should ${person ? displayName(person) : "they"} pay?${example}`;
    }
    case "missing_amount":
    case "ungrounded_amount":
      return `what did ${thing} cost all in? just the number works`;
    case "missing_payer":
      return `who covered ${thing}? just a name works`;
    default:
      return undefined;
  }
}

export const duplicateReceiptQuestion = () =>
  "wait is this the same one as earlier?";
export const foreignCurrencyQuestion = () => "how much was that in dollars?";

// §7.4: the receipt's math didn't add up, so check the total.
export const receiptTotalCheck = (total_cents: number) =>
  `total looks like ${money(total_cents)} to me, right?`;
export const whatWasTotal = () => "ok what was the total?";
export const clearerPhoto = () => "can't quite read that one, mind sending a clearer pic?";
export const whatTip = () => "what'd you tip?";

// A purchase sent by DM: splits happen in the group.
export const postInGroup = (seed: string) =>
  pick(seed, ["drop that in the group chat and i'll split it there", "send it in the group and i'll split it"]);

// The gate wasn't sure what a money message meant (§6.4): one yes/no each.
export const confirmExpense = () => "want me to split that?";
export const confirmCorrection = () => "want me to change that one?";
export const confirmDispute = () => "something off with what you owe?";
export const confirmSettleUp = () => "want me to settle everyone up now?";

// ── Adjustments and corrections (§7.5, §7.7) ─────────────────────────────

export const whatsUneven = () => "ok what was uneven?";

export const pinnedOverTotal = (a: { total_cents: number; name: string }) =>
  `that's more than the ${money(a.total_cents)} total, what'd ${a.name} actually have?`;

export const reopenToChange = (description: string) =>
  `${description} is already locked in, reopen it and change the split?`;

// An unsure adjustment, confirmed first. An opt-out names who's left
// ("just you and Priya on Pizza then?") or who's out when that's shorter.
export function confirmSplitChange(a: { description: string; only?: string[]; without?: string[] }): string {
  if (a.only?.length) return `just ${listJoin(a.only)} on ${a.description} then?`;
  if (a.without?.length) return `so ${a.description} without ${listJoin(a.without)} then?`;
  return `change the split on ${a.description}?`;
}

export const whichToCorrect = () => "which one? reply to the expense you mean";

export const correctionUnclear = (description: string) => `what should ${description} be instead?`;

export const totalUnderPinned = (pinned_cents: number) =>
  `that's less than the ${money(pinned_cents)} already set for specific people, what was the total?`;

// ── Queries (§7.8) ───────────────────────────────────────────────────────

export type Debt = { from: Person; to: Person; amount_cents: number };

export function balanceReply(a: {
  debts: Debt[];
  ledger_url?: string;
}): string {
  if (a.debts.length === 0) return "everyone's square rn";
  const lines = a.debts
    .slice(0, 6)
    .map(
      (d) =>
        `${displayName(d.from)} owes ${displayName(d.to)} ${money(d.amount_cents)}`,
    );
  if (a.debts.length <= 2) return `ok so rn: ${lines.join(", ")}`;
  const more =
    a.debts.length > 6
      ? `\nand ${a.debts.length - 6} more${a.ledger_url ? `, all here: ${a.ledger_url}` : ""}`
      : "";
  return `ok so rn:\n${lines.join("\n")}${more}`;
}


// Just the amounts. "@Tab breakdown" gets the explanation (breakdownCommandReply).
export function personalBalanceReply(a: { owes: Debt[]; owed: Debt[] }): string {
  if (a.owes.length === 0 && a.owed.length === 0) return "you're square with everyone";
  const parts: string[] = [];
  if (a.owes.length) parts.push(`you owe ${listJoin(a.owes.map((d) => `${displayName(d.to)} ${money(d.amount_cents)}`))}`);
  if (a.owed.length) parts.push(listJoin(a.owed.map((d) => `${displayName(d.from)} owes you ${money(d.amount_cents)}`)));
  return parts.join("\n");
}


// "@Tab breakdown" (§7.8): each balance traced to the expenses behind it.
// One line per event: the signed share (+ adds to what the headline debtor
// owes, − is owed back), whose share of which expense and why, who paid how
// much and when, and the message that logged it. Everything is a database row.
export type BreakdownEvent = {
  signed_cents: number;
  description: string;
  payer: string;
  debtor: string;
  total_cents: number;
  when: string;
  source?: string;
  why: string;
};
export type BreakdownPair = { debtor: string; creditor: string; net_cents: number; events: BreakdownEvent[] };

export function breakdownCommandReply(a: {
  subject?: string;
  pairs: BreakdownPair[];
  max_pairs: number;
  max_lines: number;
}): { text: string; truncated: boolean } {
  if (a.pairs.length === 0) return { text: a.subject ? `${a.subject}'s square with everyone` : "nothing open between them", truncated: false };
  const out: string[] = [a.subject ? `here's ${a.subject}'s breakdown:` : "here's the breakdown:"];
  let lines = 0;
  let truncated = a.pairs.length > a.max_pairs;
  for (const pair of a.pairs.slice(0, a.max_pairs)) {
    if (lines >= a.max_lines) {
      truncated = true;
      break;
    }
    out.push(pairHeadline(pair));
    for (const e of pair.events) {
      if (lines >= a.max_lines) {
        truncated = true;
        break;
      }
      const sign = e.signed_cents >= 0 ? "+" : "−";
      const source = e.source ? ` · ${e.source}` : "";
      out.push(`${sign} ${money(Math.abs(e.signed_cents))} ${e.debtor}'s share of ${e.description} (${e.why}) · ${e.payer} paid ${money(e.total_cents)}, ${e.when}${source}`);
      lines++;
    }
  }
  return { text: out.join("\n"), truncated };
}

// The short form: code's headline per balance, then Grok's checked reason.
export function breakdownSummaryReply(a: { subject?: string; pairs: BreakdownPair[]; reasons: string[]; more_url?: string }): string {
  const out = [a.subject ? `here's ${a.subject}'s breakdown:` : "here's the breakdown:"];
  a.pairs.forEach((p, i) => out.push(`${pairHeadline(p)}: ${a.reasons[i]}`));
  out.push(`every line: "@tab breakdown full"${a.more_url ? `, or it's all here: ${a.more_url}` : ""}`);
  return out.join("\n");
}

// The short "why?" (Joe's rule: explain very shortly). A balance that is one
// share the asker owes reads as before ("pizza $15.00: split 3 ways after
// Jake's $3.00"); anything netted gets its headline and the expenses behind
// it ("Alex owes Jordan $90.70: sushi $100.70, less pizza $10.00").
export function shortWhyLines(pairs: BreakdownPair[], asker: string): string[] {
  return pairs.map((p) => {
    const only = p.events.length === 1 ? p.events[0]! : undefined;
    if (only && p.debtor === asker) return `${only.description} ${money(Math.abs(only.signed_cents))}: ${only.why}`;
    const adds = p.events.filter((e) => e.signed_cents >= 0).map((e) => `${e.description} ${money(e.signed_cents)}`);
    const back = p.events.filter((e) => e.signed_cents < 0).map((e) => `${e.description} ${money(-e.signed_cents)}`);
    return `${pairHeadline(p)}: ${adds.join(", ")}${back.length ? `, less ${back.join(", ")}` : ""}`;
  });
}

export function shortWhyReply(lines: string[]): string {
  if (lines.length === 0) return "nothing open for you rn";
  const more = lines.length > 5 ? `\nmore: "@tab breakdown"` : "";
  return `${lines.slice(0, 5).join("\n")}${more}`;
}

export const pairHeadline = (p: BreakdownPair) =>
  p.net_cents === 0 ? `${p.debtor} and ${p.creditor} are even` : `${p.debtor} owes ${p.creditor} ${money(p.net_cents)}`;

export const breakdownUnknown =(words: string[]) =>
  `don't see ${listJoin(words.map((w) => w[0]!.toUpperCase() + w.slice(1)))} in this group, try "@tab breakdown" or "@tab breakdown <name>"`;

// Free-form "why?" or "what's the $X from?": point to the command.
export const breakdownHint = () => `send "@tab breakdown" and i'll show where each amount comes from`;

export const helpReply = (seed: string) =>
  pick(seed, [
    `i keep the group's tab. just say what you paid ("got groceries 63") or drop the receipt and i'll split it\nask "what do i owe" whenever, or "settle up" when you're done\nwant me gone? just remove me from the group`,
    `i'm tab, i do the splitting so nobody has to do math\nsay what you paid ("got groceries 63") or send a receipt pic. ask "what do i owe" anytime, or say "settle up" to square everyone up\nyou can remove me from the group whenever`,
  ]);
