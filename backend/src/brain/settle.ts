// SPEC §7.6 finalizing and settling (with #15: tap-only approvals, ledger
// mode, one DM confirmation per person), and §6.2 reaction routing.
import * as T from "../copy/templates.js";
import type { Expense, Message, Share } from "../store/types.js";
import { MAX_DMS_PER_EXPENSE } from "../config.js";
import type { SettleMode } from "../db/types.js";
import { activeMembers, type BrainCtx, chatKey, chatOf, outsideQuietHours, type Pending, say, styleFor, tapback } from "./context.js";
import { liveShares } from "./expense.js";

export type { SettleMode };

const person = (ctx: BrainCtx, group_id: string, phone: string) => ({
  phone,
  name: activeMembers(ctx, group_id).find((m) => m.phone === phone)?.name,
});

// The group's stored mode (backend_group_settings), "ledger" until it
// answers "each". Stored in the module, so it survives a backend restart.
export function settleModeFor(ctx: BrainCtx, group_id: string): SettleMode {
  return ctx.store.settleMode(group_id);
}

const owing = (ctx: BrainCtx, e: Expense): Share[] =>
  ctx.store
    .shares(e.expense_id)
    .filter(
      (s) =>
        s.role === "participant" && s.status === "locked" && s.amount_cents > 0,
    );

// Lock every share, then the expense. Order matters: the module recomputes
// on set_share and refuses to once the expense is finalized. In per-expense
// mode the settle request goes out now; in ledger mode it waits for settle_up.
// settle_up passes request: false, since it posts one request for everything.
export async function finalize(ctx: BrainCtx, snapshot: Expense, opts: { request?: boolean } = {}) {
  // Read it again: the caller's copy may predate another finalize.
  const expense = ctx.store.expense(snapshot.expense_id);
  if (
    !expense ||
    (expense.status !== "proposed" && expense.status !== "itemizing") ||
    !expense.payer_phone
  )
    return;
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
  await ctx.db.upsert_expense({
    ...expense,
    status: "finalized",
    finalized_at: ctx.now(),
  });
  if (opts.request !== false && settleModeFor(ctx, expense.group_id) === "per_expense") {
    // A reopened expense (§7.7) gets a new request, so a new id.
    const first = `settle_request:${expense.expense_id}`;
    const id = ctx.store.outbox().some((o) => o.action_id === first) ? `${first}:${ctx.now().getTime()}` : first;
    await postSettleRequest(ctx, expense.group_id, [ctx.store.expense(expense.expense_id)!], id);
  }
}

// One message for the given expenses, grouped by who is owed. Each expense
// gets the request's id as settle_message_id, so a 👍 finds all of them.
async function postSettleRequest(
  ctx: BrainCtx,
  group_id: string,
  expenses: Expense[],
  request_id: string,
): Promise<boolean> {
  const byPayee = new Map<string, Share[]>();
  for (const e of expenses) {
    const shares = owing(ctx, e);
    if (shares.length === 0) continue;
    byPayee.set(e.payer_phone!, [
      ...(byPayee.get(e.payer_phone!) ?? []),
      ...shares,
    ]);
  }
  if (byPayee.size === 0) return false;
  const included = expenses.filter((e) => owing(ctx, e).length > 0);
  for (const e of included)
    await ctx.db.upsert_expense({ ...e, settle_message_id: request_id });
  // Several shares owed to one payee by one person add up to one line.
  const owed = [...byPayee].map(([payee, shares]) => {
    const totals = new Map<string, number>();
    for (const s of shares)
      totals.set(s.phone, (totals.get(s.phone) ?? 0) + s.amount_cents);
    return {
      payee: person(ctx, group_id, payee),
      shares: [...totals].map(([phone, amount_cents]) => ({
        person: person(ctx, group_id, phone),
        amount_cents,
      })),
    };
  });
  await say(ctx, {
    chat: { group_id },
    purpose: "settle_request",
    id: request_id,
    text: T.settleRequest({
      seed: request_id,
      owed,
      description: included.length === 1 ? included[0]!.description : undefined,
    }),
    expense_id: included.length === 1 ? included[0]!.expense_id : undefined,
  });
  return true;
}

// "let's settle up" (SPEC #15): one request for everything outstanding.
export async function settleUp(ctx: BrainCtx, m: Message) {
  if (!m.group_id) return;
  // Asking to settle now ends the window for changes: lock in proposed
  // splits and include them (Harjyot's playground: "settle it now lol" got
  // "isn't locked in yet"). Safe, since only each payer's 👍 moves money.
  // Receipts still waiting on item claims stay open.
  for (const e of ctx.store.expenses())
    if (e.group_id === m.group_id && e.status === "proposed" && e.payer_phone)
      await finalize(ctx, e, { request: false });
  const outstanding = ctx.store
    .expenses()
    .filter(
      (e) =>
        e.group_id === m.group_id &&
        e.status === "finalized" &&
        e.payer_phone &&
        owing(ctx, e).length > 0,
    );
  const posted = await postSettleRequest(
    ctx,
    m.group_id,
    outstanding,
    `settle_request:${m.group_id}:${m.message_id}`,
  );
  if (posted) return;
  // Nothing locked in yet, but something may still be open: say so rather
  // than "everyone's square".
  const open = ctx.store
    .expenses()
    .filter((e) => e.group_id === m.group_id && (e.status === "proposed" || e.status === "itemizing"));
  await say(ctx, {
    chat: chatOf(m),
    purpose: "balance_reply",
    id: `settle_up:${m.message_id}`, reply_to: m.message_id,
    text: open.length > 0 ? T.notLockedYet(open) : T.nothingToSettle(),
  });
}

// Expenses a settle request covers.
function requestExpenses(ctx: BrainCtx, request_id: string): Expense[] {
  return ctx.store.expenses().filter((e) => e.settle_message_id === request_id);
}

// The only way money moves (P7): a 👍 from the person whose shares these
// are. One create_transfer per share they owe in the request, all with the
// same approval: the module dedupes on (approval, expense), so one 👍 pays
// every share and a repeat delivery of it pays nothing twice.
async function approveRequest(
  ctx: BrainCtx,
  reaction: Message,
  request_id: string,
) {
  for (const e of requestExpenses(ctx, request_id).filter(
    (x) => x.status === "finalized",
  )) {
    const share = ctx.store
      .shares(e.expense_id)
      .find((s) => s.phone === reaction.sender_phone);
    if (!share || share.role !== "participant" || share.status !== "locked")
      continue;
    await ctx.db.create_transfer({
      transfer_id: `tr_${reaction.message_id}_${e.expense_id}`,
      expense_id: e.expense_id,
      from_phone: reaction.sender_phone,
      approved_by_message_id: reaction.message_id,
    });
  }
}

// The open settle request the sender still owes on, if any.
export function openRequestFor(ctx: BrainCtx, m: Message): string | undefined {
  const e = ctx.store
    .expenses()
    .filter(
      (x) =>
        x.status === "finalized" &&
        x.settle_message_id &&
        (!m.group_id || x.group_id === m.group_id),
    )
    .filter((x) => owing(ctx, x).some((s) => s.phone === m.sender_phone))
    .sort(
      (a, b) =>
        (b.finalized_at?.getTime() ?? 0) - (a.finalized_at?.getTime() ?? 0),
    )[0];
  return e?.settle_message_id;
}

// A typed "yes" never pays (P7). Point to the 👍, once per request.
export async function textApproval(ctx: BrainCtx, m: Message) {
  const request_id = openRequestFor(ctx, m);
  if (!request_id) return;
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id: `tap_hint:${request_id}:${m.sender_phone}`,
    reply_to: m.message_id,
    text: T.tapToPay(),
  });
}

// Disputes (§7.6): every share of theirs the request covers becomes
// `disputed` (Kian's #16 allows it on a finalized expense without touching
// the amount), then Tab asks what's off: in the group if they said it there,
// by DM if they tapped 👎.
export async function dispute(ctx: BrainCtx, m: Message, expenses: Expense[]) {
  let total = 0;
  const disputed: Expense[] = [];
  for (const e of expenses) {
    const share = ctx.store.shares(e.expense_id).find((s) => s.phone === m.sender_phone);
    if (!share || share.role !== "participant") continue;
    if (share.status === "locked") await ctx.db.set_share({ ...share, status: "disputed" });
    total += share.amount_cents;
    disputed.push(e);
  }
  if (disputed.length === 0) return;
  const one = disputed.length === 1 ? disputed[0] : undefined;
  const chat = m.kind === "reaction" ? { dm_phone: m.sender_phone } : chatOf(m);
  await say(ctx, {
    chat,
    purpose: "dispute_followup",
    id: `dispute_followup:${m.message_id}`,
    // A tapback can trigger this; only a text message can be replied to.
    reply_to: m.kind === "reaction" ? undefined : m.message_id,
    text: T.disputeFollowup({ seed: m.message_id, description: one?.description, amount_cents: total }),
    expense_id: one?.expense_id,
  });
  // Their answer ("I only had $10") goes to resolveDispute.
  ctx.memory.pending.set(chatKey(chat), {
    kind: "dispute",
    source: m,
    expense_ids: disputed.map((e) => e.expense_id),
    asked_at: ctx.now(),
  } satisfies Pending);
}

// Expenses a pending dispute still covers: finalized, with the disputer's
// share still `disputed`.
export function stillDisputed(ctx: BrainCtx, phone: string, expense_ids: string[]): Expense[] {
  return expense_ids
    .map((id) => ctx.store.expense(id))
    .filter((e): e is Expense => e?.status === "finalized")
    .filter((e) =>
      ctx.store.shares(e.expense_id).some((s) => s.phone === phone && s.role === "participant" && s.status === "disputed"),
    );
}

// SPEC §7.6 disputes: only the disputing person's amount changes.
// resolve_dispute sets it and puts the share back to locked, and the payer's
// own share absorbs the difference, so nobody else is affected (P4). Then
// they get a new request to approve; on the running tab (no request yet)
// the share just stays outstanding. Returns false, writing nothing, when the
// payer's share can't absorb that much.
export async function resolveDispute(ctx: BrainCtx, m: Message, e: Expense, amount_cents: number): Promise<boolean> {
  const shares = ctx.store.shares(e.expense_id);
  const share = shares.find((s) => s.phone === m.sender_phone);
  const payer = shares.find((s) => s.phone === e.payer_phone);
  if (!share || !payer || payer.amount_cents - (amount_cents - share.amount_cents) < 0) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`,
      reply_to: m.message_id,
      text: T.disputeTooMuch({ description: e.description, max_cents: (share?.amount_cents ?? 0) + (payer?.amount_cents ?? 0) }),
      expense_id: e.expense_id,
    });
    return false;
  }
  await ctx.db.resolve_dispute({ expense_id: e.expense_id, phone: m.sender_phone, amount_cents });
  await tapback(ctx, m, "like", e.expense_id);
  const updated = ctx.store.expense(e.expense_id)!;
  const requested =
    Boolean(updated.settle_message_id) &&
    (await postSettleRequest(ctx, updated.group_id, [updated], `settle_request:${updated.expense_id}:${ctx.now().getTime()}`));
  // In the group the new request already shows the new amount.
  if (requested && m.group_id) return true;
  await say(ctx, {
    chat: chatOf(m),
    purpose: "dispute_followup",
    id: `dispute_resolved:${m.message_id}`,
    reply_to: m.message_id,
    text: T.disputeResolved({ description: e.description, amount_cents, requested }),
    expense_id: e.expense_id,
  });
  return true;
}

// "Which one?" when an amount answers a dispute that covered several expenses.
export const whichDisputed = (ctx: BrainCtx, phone: string, expenses: Expense[]) =>
  T.whichDispute(
    expenses.map((e) => ({
      description: e.description,
      amount_cents: ctx.store.shares(e.expense_id).find((s) => s.phone === phone)?.amount_cents ?? 0,
    })),
  );

// What a typed "no" disputes: the sender's shares in their open settle
// request, else the latest finalized expense they owe on.
export function disputeTargets(ctx: BrainCtx, m: Message): Expense[] {
  const request_id = openRequestFor(ctx, m);
  if (request_id) return requestExpenses(ctx, request_id).filter((e) => owing(ctx, e).some((s) => s.phone === m.sender_phone));
  const e = settleTarget(ctx, m);
  return e ? [e] : [];
}

// The most recent finalized expense where the sender still owes.
export function settleTarget(ctx: BrainCtx, m: Message): Expense | undefined {
  return ctx.store
    .expenses()
    .filter(
      (e) =>
        e.status === "finalized" && (!m.group_id || e.group_id === m.group_id),
    )
    .filter((e) => owing(ctx, e).some((s) => s.phone === m.sender_phone))
    .sort(
      (a, b) =>
        (b.finalized_at?.getTime() ?? 0) - (a.finalized_at?.getTime() ?? 0),
    )[0];
}

// A newer settle request takes over the expenses of an older one (each
// expense keeps one settle_message_id), so a tap on the older request goes
// to the sender's current one (Harjyot's review on #14).
function liveRequest(ctx: BrainCtx, m: Message, request_id: string): string | undefined {
  const owesHere = requestExpenses(ctx, request_id).some((e) =>
    owing(ctx, e).some((s) => s.phone === m.sender_phone),
  );
  return owesHere ? request_id : openRequestFor(ctx, m);
}

// SPEC §6.2: a reaction is routed by the Tab message it targets.
export async function routeReaction(ctx: BrainCtx, m: Message) {
  if (!m.reply_to_id || !m.reaction) return;
  const target = ctx.store
    .outbox()
    .find((o) => o.sent_photon_id === m.reply_to_id);
  if (!target) return;

  if (target.purpose === "settle_request") {
    const request_id = liveRequest(ctx, m, target.action_id);
    if (!request_id) return;
    if (m.reaction === "like") await approveRequest(ctx, m, request_id);
    else if (m.reaction === "dislike")
      await dispute(
        ctx,
        m,
        requestExpenses(ctx, request_id).filter((x) => owing(ctx, x).some((s) => s.phone === m.sender_phone)),
      );
    return;
  }
  if (target.purpose !== "split_proposal" || !target.expense_id) return;
  const expense = ctx.store.expense(target.expense_id);
  if (expense?.status !== "proposed") return;
  if (m.reaction === "like") {
    const share = ctx.store
      .shares(expense.expense_id)
      .find((s) => s.phone === m.sender_phone);
    if (share && !share.responded && share.status !== "opted_out")
      await ctx.db.set_share({ ...share, responded: true });
    // Everyone liked it: finalize now, nobody waits for the deadline (P4).
    if (liveShares(ctx, expense.expense_id).every((s) => s.responded))
      await finalize(ctx, ctx.store.expense(expense.expense_id)!);
  } else if (m.reaction === "dislike" || m.reaction === "question") {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, // answers a tapback: no thread
      text: "What's off?",
      expense_id: expense.expense_id,
    });
  }
}

// After the scheduled reducer completes transfers (Kian's M0 note):
// one DM per 👍 once all of its transfers are done (SPEC #15), then
// "everyone's square" once everything in a request is paid.
export async function announceSettlements(ctx: BrainCtx) {
  const sent = new Set(ctx.store.outbox().map((o) => o.action_id));
  const transfers = ctx.store.transfers();
  const byApproval = new Map<string, typeof transfers>();
  for (const t of transfers)
    byApproval.set(t.approved_by_message_id, [
      ...(byApproval.get(t.approved_by_message_id) ?? []),
      t,
    ]);

  // Seeded history (seed:demo) has no real 👍 behind it, and no request Tab
  // posted: announce only what happened in the chat.
  const reactions = new Set(ctx.store.messages().filter((m) => m.kind === "reaction").map((m) => m.message_id));
  for (const [approval, ts] of byApproval) {
    const id = `payment_receipt:${approval}`;
    if (!reactions.has(approval) || sent.has(id) || ts.some((t) => t.status !== "done")) continue;
    const e = ctx.store.expense(ts[0]!.expense_id);
    if (!e) continue;
    const paid = new Map<string, number>();
    for (const t of ts)
      paid.set(t.to_phone, (paid.get(t.to_phone) ?? 0) + t.amount_cents);
    const from = ts[0]!.from_phone;
    const stillOwes = ctx.store
      .expenses()
      .some(
        (x) =>
          x.group_id === e.group_id &&
          owing(ctx, x).some((s) => s.phone === from),
      );
    const label =
      ts.length === 1
        ? e.description
        : ctx.store.group(e.group_id)?.display_name;
    await say(ctx, {
      chat: { dm_phone: from },
      purpose: "payment_receipt",
      id,
      text: T.paymentConfirmation({
        paid: [...paid].map(([to, amount_cents]) => ({
          payee: person(ctx, e.group_id, to),
          amount_cents,
        })),
        label,
        allSquare: !stillOwes,
      }),
    });
  }

  const requests = new Set(
    ctx.store
      .expenses()
      .map((e) => e.settle_message_id)
      .filter((r): r is string => Boolean(r)),
  );
  for (const request_id of requests) {
    const id = `all_square:${request_id}`;
    const covered = requestExpenses(ctx, request_id);
    if (
      sent.has(id) ||
      !sent.has(request_id) ||
      covered.length === 0 ||
      covered.some((e) => e.status !== "settled")
    )
      continue;
    const e = covered[0]!;
    const chat = { group_id: e.group_id };
    const payer = person(ctx, e.group_id, e.payer_phone ?? "").name;
    const wit =
      ctx.wit && !ctx.memory.lastHadWit.get(e.group_id)
        ? await ctx
            .wit({
              purpose: "all_square",
              moment:
                covered.length === 1
                  ? `everyone finished paying ${payer ?? "the payer"} back for ${e.description}`
                  : "everyone in the group just settled up",
              allowed_names: covered.length === 1 && payer ? [payer] : [],
              all_member_names: activeMembers(ctx, e.group_id)
                .map((m) => m.name)
                .filter((n): n is string => Boolean(n)),
              style: styleFor(ctx, chat),
              previous_had_wit: false,
            })
            .catch((err: unknown) => {
              ctx.log("wit_failed", {
                group_id: e.group_id,
                error: String(err),
              });
              return null;
            })
        : null;
    const text =
      covered.length === 1
        ? T.allSquare({ seed: e.expense_id, description: e.description })
        : "Everyone's square.";
    await say(ctx, { chat, purpose: "all_square", id, text, wit });
  }
}

// §7.6: people who haven't tapped 👍 get a friendly nudge in the group by
// name, on the claim-nudge schedule, counted from when the request went out.
// After the last one the balance just stays outstanding (P7).
export async function approvalFollowups(ctx: BrainCtx) {
  const now = ctx.now();
  const d = ctx.timing.durations;
  const schedule = [d.FOLLOWUP_DM1_AFTER, d.FOLLOWUP_DM1_AFTER + d.FOLLOWUP_DM2_AFTER, d.FOLLOWUP_DM3_AFTER];
  for (const request of ctx.store.outbox().filter((o) => o.purpose === "settle_request" && o.status !== "cancelled" && o.group_id)) {
    const group_id = request.group_id!;
    const expenses = requestExpenses(ctx, request.action_id).filter((e) => e.status === "finalized");
    const byPerson = new Map<string, { e: Expense; s: Share }[]>();
    for (const e of expenses)
      for (const s of owing(ctx, e)) byPerson.set(s.phone, [...(byPerson.get(s.phone) ?? []), { e, s }]);
    for (const [phone, owed] of byPerson) {
      // Counted from the outbox: shares can't change once finalized.
      const prefix = `approval_followup:${request.action_id}:${phone}:`;
      const step = ctx.store.outbox().filter((o) => o.action_id.startsWith(prefix)).length;
      const due = schedule[step];
      if (due === undefined || step >= MAX_DMS_PER_EXPENSE || now.getTime() < request.created_at.getTime() + due) continue;
      const toPayee = new Map<string, number>();
      for (const { e, s } of owed) toPayee.set(e.payer_phone!, (toPayee.get(e.payer_phone!) ?? 0) + s.amount_cents);
      await say(ctx, {
        chat: { group_id },
        purpose: "approval_followup",
        id: `${prefix}${step + 1}`,
        text: T.approvalFollowup({
          seed: `${request.action_id}:${phone}`,
          person: person(ctx, group_id, phone),
          owed: [...toPayee].map(([payee, amount_cents]) => ({ payee: person(ctx, group_id, payee), amount_cents })),
          step: (step + 1) as 1 | 2 | 3,
        }),
        send_after: outsideQuietHours(ctx, now, ctx.store.group(group_id)?.timezone ?? "America/Detroit"),
      });
    }
  }
}
