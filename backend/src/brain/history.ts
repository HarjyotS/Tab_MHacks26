// History answers (SPEC §7.8 History): what someone paid or got back, what
// it was for, and when, so a balance or "why?" with nothing open doesn't
// dead-end (Harjyot's playground: Sam paid Priya, then "what was it for"
// got "nothing open for you rn"). "it" and "that" are resolved in code from
// Tab's recent messages in the same chat: the payment DM a 👍 produced, or
// the expense a split or settle message was about. Built from the store
// only (P6): every name, amount, and day is a database row. Open-ended
// history questions go to the money brain (ask.ts), which gets the same rows
// through lookup.ts.
import * as T from "../copy/templates.js";
import { GROUP_TIMEZONE } from "../config.js";
import type { Expense, Message, Outbox, Share, Transfer } from "../store/types.js";
import { type BrainCtx, chatOf, say } from "./context.js";
import { hintBreakdown, shortWhyFor } from "./breakdown.js";
import { explainShare, groupsOf, handleBalanceQuery, myDebts } from "./talk.js";

// ── Reading the question ─────────────────────────────────────────────────

// "what was it for", "what's that from", "for what?", "what did i pay priya
// for": what a payment or expense Tab just mentioned was. Not "what's the
// $90.70 from?": an amount may be someone else's balance, so it keeps #46's
// pointer to "@tab breakdown" (a DM still answers it from history).
const WHAT_FOR = [
  /\b(?:what|wat|wut)\b[^?.!]*?\b(?:it|that|this|those|these|them)\b[^?.!]*?\b(?:for|from|about)\b/i,
  /\bwhat(?:'?s| (?:was|is)) (?:it|that|this)\b/i,
  /\b(?:for what|what for)\b/i,
  /\bwhat did i (?:pay|send)\b[^?.!]*\bfor\b/i,
];
export const asksWhatFor = (text: string | undefined): boolean => WHAT_FOR.some((re) => re.test(text ?? ""));

// Points back at something ("when was that?", "who else was in it").
export const refersBack = (text: string | undefined): boolean => /\b(it|that|this|those|these)\b/i.test(text ?? "");

const PERSONAL = /\b(i|me|my|am i)\b/i;

// ── Days ─────────────────────────────────────────────────────────────────

const dayKey = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);

// "today", "yesterday", "mon" within the week, else "sep 26", in the group's
// time zone.
export function relativeDay(at: Date, now: Date, timeZone = GROUP_TIMEZONE): string {
  const days = Math.round((Date.parse(dayKey(now, timeZone)) - Date.parse(dayKey(at, timeZone))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const format = days < 7 ? { weekday: "short" as const } : { month: "short" as const, day: "numeric" as const };
  return new Intl.DateTimeFormat("en-US", { ...format, timeZone }).format(at).toLowerCase();
}

const tzOf = (ctx: BrainCtx, group_id: string) => ctx.store.group(group_id)?.timezone ?? GROUP_TIMEZONE;

// Names from everyone who was ever in the group: a payment to someone who
// has since left still names them.
const person = (ctx: BrainCtx, group_id: string, phone: string) => ({
  phone,
  name: ctx.store.members(group_id).find((x) => x.phone === phone)?.name,
});

const liveShares = (ctx: BrainCtx, e: Expense) => ctx.store.shares(e.expense_id).filter((s) => s.status !== "opted_out");
const isIn = (ctx: BrainCtx, e: Expense, phone: string) => e.payer_phone === phone || liveShares(ctx, e).some((s) => s.phone === phone);

// ── Payments ─────────────────────────────────────────────────────────────

// One 👍's transfers from the viewer's side: what they paid, or what they
// got. Undefined when the viewer is in none of them.
function paymentEvent(ctx: BrainCtx, viewer: string, transfers: Transfer[]): T.PaymentEvent | undefined {
  const live = transfers.filter((t) => t.status !== "failed");
  const paid = live.filter((t) => t.from_phone === viewer);
  const mine = paid.length ? paid : live.filter((t) => t.to_phone === viewer);
  if (mine.length === 0) return undefined;
  const direction = paid.length ? "paid" : "received";
  const group_id = mine[0]!.group_id;
  const parts = new Map<string, T.PaymentPart>();
  for (const t of mine) {
    const other = direction === "paid" ? t.to_phone : t.from_phone;
    const part = parts.get(other) ?? { other: person(ctx, group_id, other), amount_cents: 0, what: [] };
    part.amount_cents += t.amount_cents;
    const description = ctx.store.expense(t.expense_id)?.description;
    if (description && !part.what.includes(description)) part.what.push(description);
    parts.set(other, part);
  }
  const at = new Date(Math.max(...mine.map((t) => (t.completed_at ?? t.created_at).getTime())));
  return { direction, parts: [...parts.values()], when: relativeDay(at, ctx.now(), tzOf(ctx, group_id)), pending: mine.some((t) => t.status !== "done") };
}

// The viewer's newest payment, made or received, in these groups.
export function lastPayment(ctx: BrainCtx, viewer: string, groups: string[]): T.PaymentEvent | undefined {
  const byApproval = new Map<string, Transfer[]>();
  for (const t of ctx.store.transfers()) {
    if (!groups.includes(t.group_id) || t.status === "failed" || (t.from_phone !== viewer && t.to_phone !== viewer)) continue;
    byApproval.set(t.approved_by_message_id, [...(byApproval.get(t.approved_by_message_id) ?? []), t]);
  }
  const at = (ts: Transfer[]) => Math.max(...ts.map((t) => (t.completed_at ?? t.created_at).getTime()));
  const newest = [...byApproval.values()].sort((a, b) => at(b) - at(a))[0];
  return newest && paymentEvent(ctx, viewer, newest);
}

// ── What "it" is ─────────────────────────────────────────────────────────

export type Referent = { kind: "payment"; transfers: Transfer[] } | { kind: "expenses"; expenses: Expense[] };

// How far back "it" can reach: Tab's last few messages in this chat, from
// the last half day.
const LOOKBACK = 4;
const WINDOW_MS = 12 * 3_600_000;

// Tab's messages in the sender's chat (outbox rows in that DM or group),
// newest first.
function tabMessages(ctx: BrainCtx, m: Message): Outbox[] {
  const chat = chatOf(m);
  return ctx.store
    .outbox()
    .map((o, i) => ({ o, i }))
    .filter(({ o }) =>
      o.kind !== "reaction" && o.status !== "cancelled" && Boolean(o.text) && o.created_at <= m.received_at &&
      (chat.group_id ? o.group_id === chat.group_id : !o.group_id && o.to_phone === chat.dm_phone),
    )
    .sort((a, b) => b.o.created_at.getTime() - a.o.created_at.getTime() || b.i - a.i)
    .map(({ o }) => o);
}

// What one of Tab's messages was about. In a DM, only the sender's own
// payments and expenses (§19).
function about(ctx: BrainCtx, m: Message, o: Outbox, groups: string[]): Referent | undefined {
  const me = m.sender_phone;
  const dm = !m.group_id;
  if (o.purpose === "payment_receipt") {
    const approval = o.action_id.replace(/^payment_receipt:/, "");
    const transfers = ctx.store
      .transfers()
      .filter((t) => t.approved_by_message_id === approval && groups.includes(t.group_id) && (!dm || t.from_phone === me || t.to_phone === me));
    return transfers.length ? { kind: "payment", transfers } : undefined;
  }
  const ids = new Set<string>(o.expense_id ? [o.expense_id] : []);
  // A settle request, or the "everyone's square" after it: its expenses.
  const request = o.purpose === "settle_request" ? o.action_id : o.purpose === "all_square" ? o.action_id.replace(/^all_square:/, "") : undefined;
  if (request) for (const e of ctx.store.expenses()) if (e.settle_message_id === request) ids.add(e.expense_id);
  const expenses = [...ids]
    .map((id) => ctx.store.expense(id))
    .filter((e): e is Expense => Boolean(e && groups.includes(e.group_id) && e.status !== "void" && (!dm || isIn(ctx, e, me))));
  return expenses.length ? { kind: "expenses", expenses } : undefined;
}

// What "it" or "that" points at: the Tab message an inline reply targets,
// else the newest of Tab's recent messages in this chat that was about a
// payment or an expense.
export function referent(ctx: BrainCtx, m: Message): Referent | undefined {
  const groups = groupsOf(ctx, m);
  const tab = tabMessages(ctx, m);
  const replied = m.reply_to_id ? tab.find((o) => o.sent_photon_id === m.reply_to_id) : undefined;
  const target = replied && about(ctx, m, replied, groups);
  if (target) return target;
  const since = m.received_at.getTime() - WINDOW_MS;
  for (const o of tab.filter((x) => x.created_at.getTime() >= since).slice(0, LOOKBACK)) {
    const r = about(ctx, m, o, groups);
    if (r) return r;
  }
  return undefined;
}

// The expense a question that points back ("when was that?") is about, for
// the money brain (ask.ts preloads it).
export function referentExpense(ctx: BrainCtx, m: Message): Expense | undefined {
  if (!refersBack(m.text)) return undefined;
  const r = referent(ctx, m);
  if (!r) return undefined;
  return r.kind === "expenses" ? r.expenses[0] : ctx.store.expense(r.transfers[0]!.expense_id);
}

// ── Answers ──────────────────────────────────────────────────────────────

// Where the viewer's share of an expense stands, in words.
const PART_NOTE: Partial<Record<Share["status"], string>> = {
  paid: "all paid",
  approved: "payment's going through",
  locked: "not settled yet",
  disputed: "you flagged it",
  proposed: "still open for changes",
  awaiting_claim: "waiting on your items",
};

function expenseLine(ctx: BrainCtx, m: Message, e: Expense) {
  return {
    description: e.description,
    total_cents: e.total_cents,
    payer: e.payer_phone ? person(ctx, e.group_id, e.payer_phone) : undefined,
    payer_is_you: e.payer_phone === m.sender_phone,
    when: relativeDay(e.created_at, ctx.now(), tzOf(ctx, e.group_id)),
  };
}

function expenseRecap(ctx: BrainCtx, m: Message, e: Expense): string {
  const me = m.sender_phone;
  const share = liveShares(ctx, e).find((s) => s.phone === me);
  const line = expenseLine(ctx, m, e);
  if (line.payer_is_you) {
    // What the others still owe the sender on it, added up in code.
    const open = liveShares(ctx, e)
      .filter((s) => s.role === "participant" && ["locked", "approved", "disputed"].includes(s.status))
      .reduce((sum, s) => sum + s.amount_cents, 0);
    const note = e.status === "settled" ? "everyone's paid you back" : open > 0 ? T.owedToYou(open) : undefined;
    return T.expenseRecap({ ...line, note });
  }
  const part = share ? { amount_cents: share.amount_cents, why: explainShare(ctx, e, me) } : undefined;
  const note = share ? PART_NOTE[share.status] : e.status === "settled" ? "all settled" : undefined;
  return T.expenseRecap({ ...line, part, note });
}

// The recap of what "it" was. `after` adds where the sender stands now to a
// payment, as the payment DM did.
function recap(ctx: BrainCtx, m: Message, r: Referent, after: boolean): string | undefined {
  if (r.kind === "payment") {
    const p = paymentEvent(ctx, m.sender_phone, r.transfers);
    return p && T.paymentRecap(p, after ? T.balanceAfter(myDebts(ctx, m)) : undefined);
  }
  if (r.expenses.length === 1) return expenseRecap(ctx, m, r.expenses[0]!);
  return T.expensesRecap(r.expenses.map((e) => expenseLine(ctx, m, e)));
}

// What "it" means in "what was it for": right after Tab's balance reply, the
// balance (its short why), else what Tab's recent message was about.
function whatItWas(ctx: BrainCtx, m: Message): string | undefined {
  const last = tabMessages(ctx, m)[0];
  if (last?.purpose === "balance_reply" && !last.expense_id) {
    const lines = shortWhyFor(ctx, m);
    if (lines.length) return T.shortWhyReply(lines);
  }
  const r = referent(ctx, m);
  return r && recap(ctx, m, r, true);
}

// Nothing open to explain: what "it" was, else the sender's last payment.
export function historyFallback(ctx: BrainCtx, m: Message): string | undefined {
  const r = referent(ctx, m);
  const text = r && recap(ctx, m, r, true);
  if (text) return text;
  const last = lastPayment(ctx, m.sender_phone, groupsOf(ctx, m));
  return last && T.nothingOpenSince(last);
}

// "what do i owe" (talk.ts) plus, for the sender's own balance: what it was
// for when they asked ("how much do i owe and what was it for"), or their
// last payment when they're square.
export async function handleBalance(ctx: BrainCtx, m: Message) {
  await handleBalanceQuery(ctx, m, ({ owes, owed }) => {
    const square = owes.length === 0 && owed.length === 0;
    if (asksWhatFor(m.text)) {
      if (!square) return shortWhyFor(ctx, m).slice(0, 5);
      const r = referent(ctx, m);
      const text = r && recap(ctx, m, r, false);
      if (text) return [text];
    }
    // Nothing more unless they asked (Joe's rule: answer only what's asked).
    return [];
  });
}

// A free-form breakdown request. "what was it for" is answered about what
// "it" is. With nothing open for the sender, their history instead of a
// pointer to a breakdown that would only say they're square. Anything else
// still gets the pointer to "@tab breakdown" (#46: "what's the $90.70
// from?" may be about someone else's balance).
export async function handleBreakdownQuestion(ctx: BrainCtx, m: Message) {
  const reply = (text: string) =>
    say(ctx, { chat: chatOf(m), purpose: "breakdown_reply", id: `breakdown_reply:${m.message_id}`, reply_to: m.message_id, text });
  if (asksWhatFor(m.text)) {
    const text = whatItWas(ctx, m);
    if (text) return reply(text);
  }
  const personal = !m.group_id || PERSONAL.test(m.text ?? "") || asksWhatFor(m.text);
  if (personal) {
    const lines = shortWhyFor(ctx, m);
    if (lines.length === 0) return reply(historyFallback(ctx, m) ?? T.shortWhyReply([]));
    if (asksWhatFor(m.text)) return reply(T.shortWhyReply(lines));
  }
  return hintBreakdown(ctx, m);
}

// "what was it for" as a money question or a last resort: answered from the
// records of what "it" was, without Grok. False when it isn't that kind of
// question or nothing resolves.
export async function answerWhatItWas(ctx: BrainCtx, m: Message): Promise<boolean> {
  if (!asksWhatFor(m.text)) return false;
  const text = whatItWas(ctx, m);
  if (!text) return false;
  await say(ctx, { chat: chatOf(m), purpose: "breakdown_reply", id: `breakdown_reply:${m.message_id}`, reply_to: m.message_id, text });
  return true;
}
