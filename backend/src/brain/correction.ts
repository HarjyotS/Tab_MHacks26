// SPEC §7.7 corrections: "actually it was 44", or a new description, sent as
// a reply to the expense or to Tab's proposal.
import * as T from "../copy/templates.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatOf, say, tapback } from "./context.js";
import { liveShares, moneyMoving, postProposal, reopen } from "./expense.js";
import { extractInput } from "./inputs.js";

// "actually the uber was $30 not $24", not sent as a reply: a correction to
// the open expense it names, not a second Uber (playground run, #44). Joe's
// guards (review on #44): it must read as a correction ("was/is $X" or
// "not $X"), name the expense by a real word of its description, and not be
// another purchase ("another uber home", "got gas too").
const CORRECTION_SHAPE = /\b(?:was|is|were)\s+(?:actually\s+|really\s+|only\s+)?\$?\d|\bnot\s+\$?\d/i;
const ANOTHER = /\b(another|again|too|also|second|more)\b/i;
const STOPWORDS = new Set(["the", "for", "and", "with", "from", "that", "this", "some", "team", "everyone", "group", "house"]);

const descriptionWords = (description: string) =>
  (description.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && !STOPWORDS.has(w));

// Overriding the gate takes more than the shape: with no "another", a new
// purchase still reads "uber was $18, i got it" or "dinner was $80". Only a
// message that clearly fixes an amount ("not $24", "meant", "should be", or
// "actually" without buying anything) turns a confident new expense into a
// correction; anything else stays new, or is asked about when unsure
// (merge review of #50).
const FIXING = /\bnot\s+\$?\d|\b(?:meant|typo|should\s+(?:have\s+|'ve\s+)?be(?:en)?)\b/i;
const PURCHASE = /\b(?:paid|pay|got|get|bought|buy|grabbed|covered|spent|ordered|picked\s+up)\b/i;

export function clearlyCorrects(text: string): boolean {
  return FIXING.test(text) || (/\bactually\b/i.test(text) && !PURCHASE.test(text));
}

export function namesExpense(text: string, description: string): boolean {
  return descriptionWords(description).some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(text));
}

export function namedCorrectionTarget(ctx: BrainCtx, m: Message): Expense | undefined {
  const text = m.text ?? "";
  if (!m.group_id || m.kind !== "text" || !CORRECTION_SHAPE.test(text) || ANOTHER.test(text)) return undefined;
  return ctx.store
    .expenses()
    .filter((e) => e.group_id === m.group_id && (e.status === "proposed" || e.status === "finalized") && namesExpense(text, e.description))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
}

// The amount a correction says was wrong: "62 not 55", "instead of $38".
export function oldAmountCents(text: string): number | undefined {
  const m = /\b(?:not|instead of|wasn'?t)\s+\$?(\d+(?:\.\d{1,2})?)\b/i.exec(text);
  return m ? Math.round(Number(m[1]) * 100) : undefined;
}

// The one open expense in the group at the amount a correction says was
// wrong ("the tacos were 62 not 55"), preferring one it names.
function expenseAt(ctx: BrainCtx, group_id: string | undefined, cents: number, text: string): Expense | undefined {
  const at = ctx.store
    .expenses()
    .filter((e) => e.group_id === group_id && (e.status === "proposed" || e.status === "finalized") && e.total_cents === cents);
  const named = at.filter((e) => namesExpense(text, e.description));
  return named.length === 1 ? named[0] : at.length === 1 ? at[0] : undefined;
}

// "wait i thought it was 200", "that was 45 actually": an amount for "it",
// with nothing named. Right after an expense was logged, that's the one it
// means, so Tab asks "change the dj to $200?" (noise eval: the money brain
// answered "got it, dj's now $250" and changed nothing).
const IT_WAS = /^(?:(?:wait|oh|hmm+|no|nah|actually)[\s,]+)*(?:i\s+thought\s+)?(?:it|that)\s*(?:was|is|'s)\s+(?:actually\s+|really\s+|only\s+)?\$?\d/i;
const JUST_LOGGED_MS = 15 * 60_000;

export function justLoggedTarget(ctx: BrainCtx, m: Message): Expense | undefined {
  if (!m.group_id || m.kind !== "text" || !IT_WAS.test((m.text ?? "").trim())) return undefined;
  const latest = ctx.store
    .expenses()
    .filter((e) => e.group_id === m.group_id && e.status !== "void")
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  if (!latest || latest.status !== "proposed" || ctx.now().getTime() - latest.created_at.getTime() > JUST_LOGGED_MS) return undefined;
  return latest;
}

export async function handleCorrection(
  ctx: BrainCtx,
  m: Message,
  bound?: Expense,
) {
  const ask = (text: string, expense_id?: string) =>
    say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`,
      reply_to: m.message_id,
      text,
      expense_id,
    });

  const { result } = await ctx.extract.correction(extractInput(ctx, m));
  let target =
    bound ??
    (result.target_expense_id
      ? ctx.store.expense(result.target_expense_id)
      : undefined);
  // "the tacos were actually 62 not 55": the old amount says which one. The
  // $55 expense when exactly one is open; with none, ask which instead of
  // rewriting the newest (noise eval: it turned a $120 surfboard rental into
  // "tacos $120.00", and "the supplies were 76 not 87" changed a $112 order
  // that had borrowed the name). Only an inline reply to the expense
  // outranks the amount.
  const was = oldAmountCents(m.text ?? "");
  const replied = m.reply_to_id !== undefined && bound !== undefined;
  if (was !== undefined && !replied && target?.total_cents !== was)
    target = expenseAt(ctx, m.group_id, was, m.text ?? "");
  if (!target) {
    await tapback(ctx, m, "question");
    return ask(T.whichToCorrect());
  }
  if (result.unclear) {
    await tapback(ctx, m, "question", target.expense_id);
    return ask(T.correctionUnclear(target.description), target.expense_id);
  }
  // Paid, or partly paid: the money already moved (§7.7).
  if (
    target.status === "settled" ||
    (target.status === "finalized" && moneyMoving(ctx, target))
  )
    return ask(T.cantChangePaid(target.description), target.expense_id);
  // A receipt is split by its items; a new total would disagree with them.
  if (
    result.new_amount_cents !== undefined &&
    ctx.store.lineItems(target.expense_id).length > 0
  )
    return ask(T.receiptTotalFixed(target.description), target.expense_id);
  // Waiting on Tab's own question: that flow fills it in.
  if (target.status !== "proposed" && target.status !== "finalized") return;

  const total = result.new_amount_cents ?? target.total_cents;
  const pinned = liveShares(ctx, target.expense_id).reduce(
    (sum, s) => sum + (s.fixed_cents ?? 0),
    0,
  );
  if (pinned > total) {
    await tapback(ctx, m, "question", target.expense_id);
    return ask(T.totalUnderPinned(pinned), target.expense_id);
  }

  await tapback(ctx, m, "like", target.expense_id);
  const open =
    target.status === "finalized" ? await reopen(ctx, target) : target;
  // Text expenses have no separate subtotal, so the total is the base (§8.1).
  const deadline = new Date(
    Math.max(open.objection_deadline?.getTime() ?? 0, ctx.now().getTime()) +
      ctx.timing.durations.OBJECTION_EXTENSION,
  );
  await ctx.db.upsert_expense({
    ...open,
    total_cents: total,
    description: result.new_description ?? open.description,
    objection_deadline: deadline,
  });
  await postProposal(ctx, open.expense_id, true);
}
