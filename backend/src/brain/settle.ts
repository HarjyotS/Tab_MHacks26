// SPEC §7.6 finalizing and settling, and §6.2 deterministic reaction routing.
import * as T from "../copy/templates.js";
import type { Expense, Message } from "../store/types.js";
import { activeMembers, type BrainCtx, chatOf, say, styleFor, tapback } from "./context.js";
import { liveShares } from "./expense.js";

const person = (ctx: BrainCtx, group_id: string, phone: string) => ({
  phone,
  name: activeMembers(ctx, group_id).find((m) => m.phone === phone)?.name,
});

// Lock every share, then the expense, then post the settle request.
// Order matters: the module recomputes on set_share and refuses to once the
// expense is finalized.
export async function finalize(ctx: BrainCtx, expense: Expense) {
  if ((expense.status !== "proposed" && expense.status !== "itemizing") || !expense.payer_phone) return;
  await ctx.db.cancel_outbox({ expense_id: expense.expense_id });
  for (const s of liveShares(ctx, expense.expense_id)) {
    if (s.status === "locked") continue;
    await ctx.db.set_share({
      expense_id: s.expense_id,
      phone: s.phone,
      role: s.role,
      status: "locked",
      fixed_cents: s.fixed_cents,
      responded: s.responded,
      followup_count: 0,
    });
  }
  const now = ctx.now();
  await ctx.db.upsert_expense({
    ...expense,
    status: "finalized",
    finalized_at: now,
  });
  const owing = liveShares(ctx, expense.expense_id).filter(
    (s) => s.role === "participant" && s.amount_cents > 0,
  );
  if (owing.length === 0) return;
  await say(ctx, {
    chat: { group_id: expense.group_id },
    purpose: "settle_request",
    id: `settle_request:${expense.expense_id}`,
    text: T.settleRequest({
      seed: expense.expense_id,
      description: expense.description,
      payer: person(ctx, expense.group_id, expense.payer_phone),
      shares: owing.map((s) => ({
        person: person(ctx, expense.group_id, s.phone),
        amount_cents: s.amount_cents,
      })),
    }),
    expense_id: expense.expense_id,
  });
}

// Only the person whose money moves can approve, and only their own share (P7).
export async function approve(ctx: BrainCtx, m: Message, expense: Expense) {
  const share = ctx.store
    .shares(expense.expense_id)
    .find((s) => s.phone === m.sender_phone);
  if (!share || share.role !== "participant" || share.status !== "locked")
    return;
  await ctx.db.create_transfer({
    transfer_id: `tr_${m.message_id}`,
    expense_id: expense.expense_id,
    from_phone: m.sender_phone,
    approved_by_message_id: m.message_id,
  });
  if (m.kind !== "reaction") await tapback(ctx, m, "like", expense.expense_id);
}

// Disputes (§7.6): ask what's off. The module can't mark the share
// `disputed` yet: set_share recomputes, which it refuses on a finalized expense.
export async function dispute(ctx: BrainCtx, m: Message, expense: Expense) {
  const share = ctx.store
    .shares(expense.expense_id)
    .find((s) => s.phone === m.sender_phone);
  if (!share || share.role !== "participant") return;
  await say(ctx, {
    chat: chatOf(m),
    purpose: "dispute_followup",
    id: `dispute_followup:${m.message_id}`,
    text: T.disputeFollowup({
      seed: m.message_id,
      description: expense.description,
      amount_cents: share.amount_cents,
    }),
    expense_id: expense.expense_id,
  });
}

// The most recent finalized expense where the sender still owes.
export function settleTarget(ctx: BrainCtx, m: Message): Expense | undefined {
  return ctx.store
    .expenses()
    .filter(
      (e) =>
        e.status === "finalized" && (!m.group_id || e.group_id === m.group_id),
    )
    .filter((e) =>
      ctx.store
        .shares(e.expense_id)
        .some(
          (s) =>
            s.phone === m.sender_phone &&
            s.role === "participant" &&
            s.status === "locked",
        ),
    )
    .sort(
      (a, b) =>
        (b.finalized_at?.getTime() ?? 0) - (a.finalized_at?.getTime() ?? 0),
    )[0];
}

// SPEC §6.2: a reaction is routed by the Tab message it targets.
export async function routeReaction(ctx: BrainCtx, m: Message) {
  if (!m.reply_to_id || !m.reaction) return;
  const target = ctx.store
    .outbox()
    .find((o) => o.sent_photon_id === m.reply_to_id);
  if (!target?.expense_id) return;
  const expense = ctx.store.expense(target.expense_id);
  if (!expense) return;

  if (target.purpose === "split_proposal" && expense.status === "proposed") {
    if (m.reaction === "like") {
      const share = ctx.store
        .shares(expense.expense_id)
        .find((s) => s.phone === m.sender_phone);
      if (share && !share.responded && share.status !== "opted_out") {
        await ctx.db.set_share({ ...share, responded: true });
      }
      // Everyone liked it: finalize now, nobody waits for the deadline (P4).
      const fresh = ctx.store.expense(expense.expense_id)!;
      if (liveShares(ctx, expense.expense_id).every((s) => s.responded))
        await finalize(ctx, fresh);
    } else if (m.reaction === "dislike" || m.reaction === "question") {
      await say(ctx, {
        chat: chatOf(m),
        purpose: "clarifying_question",
        id: `clarify:${m.message_id}`,
        text: "What's off?",
        expense_id: expense.expense_id,
      });
    }
    return;
  }
  if (target.purpose === "settle_request" && expense.status === "finalized") {
    if (m.reaction === "like") await approve(ctx, m, expense);
    else if (m.reaction === "dislike") await dispute(ctx, m, expense);
  }
}

// After the scheduled reducer completes a transfer (Kian's M0 note): a
// truthful receipt DM, then "all square" once the expense is settled.
export async function announceSettlements(ctx: BrainCtx) {
  const sent = new Set(ctx.store.outbox().map((o) => o.action_id));
  for (const t of ctx.store.transfers().filter((x) => x.status === "done")) {
    const id = `payment_receipt:${t.transfer_id}`;
    if (sent.has(id)) continue;
    const e = ctx.store.expense(t.expense_id);
    if (!e) continue;
    await say(ctx, {
      chat: { dm_phone: t.from_phone },
      purpose: "payment_receipt",
      id,
      text: T.paymentReceipt({
        payee: person(ctx, e.group_id, t.to_phone),
        amount_cents: t.amount_cents,
        description: e.description,
      }),
      expense_id: e.expense_id,
    });
  }
  for (const e of ctx.store.expenses().filter((x) => x.status === "settled")) {
    const id = `all_square:${e.expense_id}`;
    if (sent.has(id)) continue;
    const chat = { group_id: e.group_id };
    const wit =
      ctx.wit && !ctx.memory.lastHadWit.get(e.group_id)
        ? await ctx
            .wit({
              purpose: "all_square",
              moment: `everyone finished paying ${person(ctx, e.group_id, e.payer_phone ?? "").name ?? "the payer"} back for ${e.description}`,
              allowed_names: [
                person(ctx, e.group_id, e.payer_phone ?? "").name,
              ].filter((n): n is string => Boolean(n)),
              all_member_names: activeMembers(ctx, e.group_id)
                .map((m) => m.name)
                .filter((n): n is string => Boolean(n)),
              style: styleFor(ctx, chat),
              previous_had_wit: false,
            })
            .catch((err: unknown) => {
              ctx.log("wit_failed", {
                expense_id: e.expense_id,
                error: String(err),
              });
              return null;
            })
        : null;
    await say(ctx, {
      chat,
      purpose: "all_square",
      id,
      text: T.allSquare({ seed: e.expense_id, description: e.description }),
      expense_id: e.expense_id,
      wit,
    });
  }
}
