// SPEC §7.7 corrections: "actually it was 44", or a new description, sent as
// a reply to the expense or to Tab's proposal.
import { money } from "../copy/format.js";
import * as T from "../copy/templates.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatOf, say, tapback } from "./context.js";
import { liveShares, moneyMoving, postProposal, reopen } from "./expense.js";
import { extractInput } from "./inputs.js";

// "actually the uber was $30 not $24", not sent as a reply and read as a new
// expense: the open expense it names, so it's corrected instead of logged
// twice (playground run).
const CORRECTION_CUE = /\bactually\b|\bnot \$?\d/i;
const OPEN = new Set<Expense["status"]>(["proposed", "finalized"]);

export const namesExpense = (text: string, description: string) =>
  (description.toLowerCase().match(/[a-z]{3,}/g) ?? []).some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

export function namedCorrectionTarget(ctx: BrainCtx, m: Message): Expense | undefined {
  const text = m.text ?? "";
  if (!m.group_id || m.kind !== "text" || !CORRECTION_CUE.test(text) || !/\d/.test(text)) return undefined;
  return ctx.store
    .expenses()
    .filter((e) => e.group_id === m.group_id && OPEN.has(e.status) && namesExpense(text, e.description))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
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
  const target =
    bound ??
    (result.target_expense_id
      ? ctx.store.expense(result.target_expense_id)
      : undefined);
  if (!target) {
    await tapback(ctx, m, "question");
    return ask("Which one? Reply to the expense you want to change.");
  }
  if (result.unclear) {
    await tapback(ctx, m, "question", target.expense_id);
    return ask(`What should ${target.description} be?`, target.expense_id);
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
    return ask(
      `That's less than the ${money(pinned)} already set for specific people. What was the total?`,
      target.expense_id,
    );
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
