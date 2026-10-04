// SPEC §7.3 text expenses and §7.5 custom splits and opt-outs.
import type {
  ExpenseExtraction,
  Extracted,
  Problem,
} from "../extraction/types.js";
import { money, type Person } from "../copy/format.js";
import * as T from "../copy/templates.js";
import type { Expense, Message, Share } from "../store/types.js";
import {
  activeMembers,
  chatKey,
  chatOf,
  outsideQuietHours,
  say,
  tapback,
  type BrainCtx,
  type Pending,
} from "./context.js";
import { extractInput } from "./inputs.js";
import { startItemizing } from "./receipt.js";

export const expenseIdFor = (source_message_id: string) =>
  `exp_${source_message_id}`;

const people = (ctx: BrainCtx, group_id: string): Person[] =>
  activeMembers(ctx, group_id).map((m) => ({ phone: m.phone, name: m.name }));

// The group an expense belongs to. In a DM, the sender's only group.
export function groupFor(ctx: BrainCtx, m: Message): string | undefined {
  if (m.group_id) return m.group_id;
  const mine = ctx.store
    .groups()
    .filter((g) =>
      activeMembers(ctx, g.group_id).some((x) => x.phone === m.sender_phone),
    );
  return mine.length === 1 ? mine[0]!.group_id : undefined;
}

// Ask the first problem as one short question (P2/P3) and remember it.
async function ask(
  ctx: BrainCtx,
  m: Message,
  problems: Problem[],
  pending: Pending,
  description?: string,
) {
  const group_id = groupFor(ctx, m);
  const q = T.clarifyingQuestion(problems[0]!, {
    description,
    people: group_id ? people(ctx, group_id) : [],
  });
  await tapback(ctx, m, "question");
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id: `clarify:${m.message_id}`, reply_to: m.message_id,
    text: q,
    expense_id: "expense_id" in pending ? pending.expense_id : undefined,
  });
  ctx.memory.pending.set(chatKey(chatOf(m)), pending);
}

// Problems Tab can't resolve by asking for a missing fact.
const CONFIRM = new Set<Problem["kind"]>(["large_amount"]);

// SPEC §7.3: extract, validate, then propose or ask.
export async function handleExpense(
  ctx: BrainCtx,
  m: Message,
  text = m.text ?? "",
  source: Message = m,
): Promise<void> {
  const group_id = groupFor(ctx, source);
  if (!group_id) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: "Post that in the group chat and I'll split it.",
    });
    return;
  }
  const extracted = await ctx.extract.expense(
    extractInput(ctx, { ...source, text }),
    "new",
  );
  if (!extracted.result.is_expense) return; // Not a purchase after all: stay silent (P1).
  const { result, problems } = extracted;
  const expense_id = expenseIdFor(source.message_id);

  // Always keep a needs_info row while Tab asks, so the ledger shows it.
  // The module accepts a $0 total for needs_info (Kian's #16).
  if (problems.length > 0) {
    await upsertNeedsInfo(ctx, { expense_id, group_id, source, result });
    if (problems.every((p) => CONFIRM.has(p.kind))) {
      await ask(
        ctx,
        m,
        problems,
        {
          kind: "confirm",
          then: "large_amount",
          source,
          extraction: extracted,
          expense_id,
          asked_at: ctx.now(),
        },
        result.description,
      );
    } else {
      await ask(
        ctx,
        m,
        problems,
        {
          kind: "expense",
          source,
          text,
          problems,
          expense_id,
          asked_at: ctx.now(),
        },
        result.description,
      );
    }
    return;
  }
  await proposeNew(ctx, { group_id, source, extracted });
}

async function upsertNeedsInfo(
  ctx: BrainCtx,
  a: {
    expense_id: string;
    group_id: string;
    source: Message;
    result: ExpenseExtraction;
  },
) {
  await ctx.db.upsert_expense({
    expense_id: a.expense_id,
    group_id: a.group_id,
    payer_phone: payerPhone(a.result, a.source),
    description: a.result.description ?? "Expense",
    source_message_id: a.source.message_id,
    split_mode: "even",
    status: "needs_info",
    tax_cents: 0,
    tip_cents: 0,
    fees_cents: 0,
    discount_cents: 0,
    total_cents: a.result.amount_cents ?? 0,
  });
}

function payerPhone(r: ExpenseExtraction, source: Message): string | undefined {
  if (r.payer.kind === "sender") return source.sender_phone;
  if (r.payer.kind === "member") return r.payer.phone;
  return undefined;
}

// Create the expense, its shares, and post the proposal (§7.3 steps 3–6).
export async function proposeNew(
  ctx: BrainCtx,
  a: {
    group_id: string;
    source: Message;
    extracted: Extracted<ExpenseExtraction>;
  },
) {
  const { result } = a.extracted;
  const payer = payerPhone(result, a.source)!;
  const expense_id = expenseIdFor(a.source.message_id);
  const members = activeMembers(ctx, a.group_id);
  const included = new Set(
    result.participants.kind === "list"
      ? result.participants.phones
      : members.map((x) => x.phone),
  );
  for (const p of result.exclusions) included.delete(p);
  const fixed = new Map(result.fixed.map((f) => [f.phone, f.amount_cents]));
  const group = ctx.store.group(a.group_id);
  const deadline = outsideQuietHours(
    ctx,
    new Date(ctx.now().getTime() + ctx.timing.durations.OBJECTION_WINDOW),
    group?.timezone ?? "America/Detroit",
  );

  await ctx.db.upsert_expense({
    expense_id,
    group_id: a.group_id,
    payer_phone: payer,
    description: result.description ?? "Expense",
    source_message_id: a.source.message_id,
    split_mode: [...fixed.values()].some((v) => v !== undefined)
      ? "custom"
      : "even",
    status: "proposed",
    tax_cents: 0,
    tip_cents: 0,
    fees_cents: 0,
    discount_cents: 0,
    total_cents: result.amount_cents!,
    objection_deadline: deadline,
  });
  // The payer always has a share (what they consumed); everyone else either
  // participates or is opted out, so the ledger shows who was left out.
  for (const m of members) {
    await ctx.db.set_share({
      expense_id,
      phone: m.phone,
      role: m.phone === payer ? "payer" : "participant",
      status: included.has(m.phone) ? "proposed" : "opted_out",
      fixed_cents: fixed.get(m.phone),
      responded: m.phone === payer,
      followup_count: 0,
    });
  }
  if (group?.onboarding_status === "pending")
    await ctx.db.set_group_status({ group_id: a.group_id, status: "active" });
  await tapback(ctx, a.source, "like", expense_id);
  await postProposal(ctx, expense_id, false);
}

export function liveShares(ctx: BrainCtx, expense_id: string): Share[] {
  return ctx.store.shares(expense_id).filter((s) => s.status !== "opted_out");
}

export async function postProposal(
  ctx: BrainCtx,
  expense_id: string,
  updated: boolean,
) {
  const e = ctx.store.expense(expense_id);
  if (!e) throw new Error(`expense ${expense_id} not visible after write`);
  const members = activeMembers(ctx, e.group_id);
  const shares = liveShares(ctx, expense_id).map((s) => ({
    person: {
      phone: s.phone,
      name: members.find((m) => m.phone === s.phone)?.name,
    },
    amount_cents: s.amount_cents,
  }));
  // Updated proposals get a fresh id per version so each one is sent.
  const version = updated ? `:${ctx.now().getTime()}` : "";
  await say(ctx, {
    chat: { group_id: e.group_id },
    purpose: "split_proposal",
    id: `split_proposal:${expense_id}${version}`,
    text: T.splitProposal({
      seed: expense_id,
      description: e.description,
      total_cents: e.total_cents,
      shares,
      updated,
    }),
    expense_id,
    // The first proposal answers the expense message; updates aren't answers.
    reply_to: updated ? undefined : e.source_message_id,
  });
}

// SPEC §7.5: "not even, John only had a Diet Coke", "I wasn't there".
export async function handleAdjustment(
  ctx: BrainCtx,
  m: Message,
  text = m.text ?? "",
  target?: Expense,
  // The gate was unsure (§6.4 clarify band): explain or confirm, never apply.
  opts: { confirmOnly?: boolean } = {},
): Promise<void> {
  const group_id = groupFor(ctx, m);
  const expense =
    target ?? latestOpen(ctx, group_id, ["proposed"]) ?? latestOpen(ctx, group_id, ["finalized"]);
  if (!expense) return;
  // §7.7: a locked-in expense changes only while no money is moving.
  const locked = expense.status === "finalized";
  if (locked && moneyMoving(ctx, expense)) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: T.cantChangePaid(expense.description),
      expense_id: expense.expense_id,
    });
    return;
  }
  const { result, problems } = await ctx.extract.expense(
    extractInput(ctx, { ...m, text }),
    "adjustment",
  );
  const unknown = problems.filter(
    (p) => p.kind === "unknown_name" || p.kind === "missing_item_price",
  );
  if (unknown.length > 0) {
    await ask(
      ctx,
      m,
      unknown,
      {
        kind: "adjustment",
        source: m,
        text,
        expense_id: expense.expense_id,
        problems: unknown,
        asked_at: ctx.now(),
      },
      expense.description,
    );
    return;
  }
  if (result.exclusions.length === 0 && result.fixed.length === 0) {
    // "not even" with no specifics (§7.5): a receipt switches to itemizing;
    // a text expense asks what's uneven and stays proposed.
    if (ctx.store.lineItems(expense.expense_id).length > 0) {
      await tapback(ctx, m, "like", expense.expense_id);
      await startItemizing(ctx, expense);
      return;
    }
    await tapback(ctx, m, "question", expense.expense_id);
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: "What's uneven?",
      expense_id: expense.expense_id,
    });
    return;
  }
  // A pinned amount can't exceed what was spent (the split math would fail).
  const base = expense.subtotal_cents ?? expense.total_cents;
  const pinned = result.fixed.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0);
  if (pinned > base) {
    const who = result.fixed.find((f) => f.amount_cents !== undefined)!;
    const name = activeMembers(ctx, expense.group_id).find((x) => x.phone === who.phone)?.name ?? "they";
    await tapback(ctx, m, "question", expense.expense_id);
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: `That's more than the ${money(base)} total. What did ${name} actually have?`,
      expense_id: expense.expense_id,
    });
    return;
  }
  // Reopening a locked-in expense is always confirmed first.
  if (opts.confirmOnly || locked) {
    const question = locked
      ? `${expense.description} is already locked in. Reopen it and change the split?`
      : `Change the split on ${expense.description}?`;
    await tapback(ctx, m, "question", expense.expense_id);
    await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id: `clarify:${m.message_id}`, reply_to: m.message_id, text: question, expense_id: expense.expense_id });
    ctx.memory.pending.set(chatKey(chatOf(m)), { kind: "confirm", then: "adjustment", source: m, extraction: { result, problems }, expense_id: expense.expense_id, asked_at: ctx.now() });
    return;
  }
  await tapback(ctx, m, "like", expense.expense_id);
  await applyAdjustment(ctx, expense, result);
}

// Approved or paid shares mean a transfer exists; those can't be undone.
export function moneyMoving(ctx: BrainCtx, e: Expense): boolean {
  return ctx.store.shares(e.expense_id).some((s) => s.status === "approved" || s.status === "paid");
}

// §7.7, finalized with nothing paid: back to proposed, so the module will
// recompute again. The old settle request stops covering it, and everyone
// gets a fresh objection window from the updated proposal.
async function reopen(ctx: BrainCtx, e: Expense): Promise<Expense> {
  await ctx.db.upsert_expense({ ...e, status: "proposed", settle_message_id: undefined, finalized_at: undefined });
  for (const s of ctx.store.shares(e.expense_id).filter((x) => x.status === "locked" || x.status === "disputed"))
    await ctx.db.set_share({ ...s, status: "proposed", responded: false, followup_count: 0 });
  return ctx.store.expense(e.expense_id)!;
}

export async function applyAdjustment(
  ctx: BrainCtx,
  snapshot: Expense,
  result: ExpenseExtraction,
) {
  const current = ctx.store.expense(snapshot.expense_id) ?? snapshot;
  if (current.status === "finalized" && moneyMoving(ctx, current)) return;
  const expense = current.status === "finalized" ? await reopen(ctx, current) : current;
  const before = new Map(
    liveShares(ctx, expense.expense_id).map((s) => [s.phone, s.amount_cents]),
  );
  const shares = ctx.store.shares(expense.expense_id);
  const fixedPhones = new Set(result.fixed.map((f) => f.phone));
  for (const s of shares) {
    const fixed = result.fixed.find((f) => f.phone === s.phone);
    const optOut = result.exclusions.includes(s.phone);
    if (!fixed && !optOut) continue;
    await ctx.db.set_share({
      expense_id: s.expense_id,
      phone: s.phone,
      role: s.role,
      status: optOut ? "opted_out" : s.status,
      fixed_cents: fixed?.amount_cents ?? s.fixed_cents,
      responded: s.responded,
      followup_count: s.followup_count,
      last_followup_at: s.last_followup_at,
    });
  }
  const extended = new Date(
    Math.max(expense.objection_deadline?.getTime() ?? 0, ctx.now().getTime()) +
      ctx.timing.durations.OBJECTION_EXTENSION,
  );
  await ctx.db.upsert_expense({
    ...expense,
    split_mode:
      fixedPhones.size > 0 || expense.split_mode === "custom"
        ? "custom"
        : expense.split_mode,
    objection_deadline: extended,
  });
  // §7.5: post an updated proposal only if someone else's amount changed.
  const after = liveShares(ctx, expense.expense_id);
  const changed =
    after.some((s) => before.get(s.phone) !== s.amount_cents) ||
    after.length !== before.size;
  if (changed) await postProposal(ctx, expense.expense_id, true);
}

export function latestOpen(
  ctx: BrainCtx,
  group_id: string | undefined,
  statuses: Expense["status"][],
): Expense | undefined {
  return ctx.store
    .expenses()
    .filter(
      (e) =>
        (!group_id || e.group_id === group_id) && statuses.includes(e.status),
    )
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
}
