// SPEC §7.4 receipts and §7.5 itemizing, claims, and claim follow-ups.
import { clearlyNotReceipt } from "@tab/gate";
import type { ClaimResolution } from "../extraction/types.js";
import { LOPSIDED_FACTOR, MAX_DMS_PER_EXPENSE } from "../config.js";
import { extrasOf, type ReceiptRead } from "../extraction/receipt.js";
import * as T from "../copy/templates.js";
import type { Expense, Message } from "../store/types.js";
import {
  activeMembers,
  chatOf,
  inWords,
  outsideQuietHours,
  perExpense,
  say,
  tapback,
  type BrainCtx,
} from "./context.js";
import {
  expenseIdFor,
  groupFor,
  handleExpense,
  postProposal,
} from "./expense.js";
import { extractInput } from "./inputs.js";
import { finalize } from "./settle.js";
import { addInvite, addThread } from "./threads.js";


// Entry point for a photo (§7.4 steps 2–7).
export async function handleReceipt(ctx: BrainCtx, m: Message): Promise<void> {
  const group_id = groupFor(ctx, m);
  if (!group_id) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: T.postInGroup(m.message_id),
    });
    return;
  }
  if (!m.image_url) return;
  // Grok vision already looked at it before the gate (§7.4): a meme or a
  // selfie with no amounts in it skips the receipt read. Anything that might
  // be a receipt is still read, so a misdescribed one isn't dropped (Joe's
  // review on #41).
  if (clearlyNotReceipt(ctx.memory.photos.get(m.message_id))) {
    if (m.text && /\d/.test(m.text)) await handleExpense(ctx, m);
    return;
  }
  const read = await ctx.extract.receipt(m.image_url, m.text);
  const { receipt } = read;

  if (!receipt.is_receipt) {
    // §14: ignore a non-receipt photo unless the caption mentions money.
    if (m.text && /\d/.test(m.text)) await handleExpense(ctx, m);
    return;
  }
  if (receipt.total_cents === undefined || receipt.items.length === 0) {
    await askAbout(ctx, m, T.clearerPhoto());
    return;
  }
  if (read.currency !== "USD") {
    await askAbout(ctx, m, T.foreignCurrencyQuestion(), read, "total");
    return;
  }
  if (read.math_problem) {
    ctx.log("receipt_math_failed", {
      message_id: m.message_id,
      problem: read.math_problem,
    });
    await askAbout(ctx, m, T.receiptTotalCheck(receipt.total_cents), read, "confirm_total");
    return;
  }
  if (read.tip_line_blank) {
    // §7.4 step 5: the only routine question for receipts.
    await askAbout(ctx, m, T.whatTip(), read, "tip");
    return;
  }
  await proposeReceipt(ctx, m, read, { itemsTrusted: true });
}

// §7.4: only the payer answers questions about their receipt. Without a
// stage, nothing to answer ("send a clearer photo").
async function askAbout(
  ctx: BrainCtx,
  m: Message,
  question: string,
  read?: ReceiptRead,
  stage?: "confirm_total" | "total" | "tip",
) {
  const id = `clarify:${m.message_id}`;
  await tapback(ctx, m, "question");
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id, reply_to: m.message_id,
    text: question,
  });
  if (read && stage) askReceipt(ctx, m, { id, text: question, read, stage });
}

// The receipt's expense doesn't exist until the payer answers.
export function askReceipt(
  ctx: BrainCtx,
  m: Message,
  a: { id: string; text: string; read: ReceiptRead; stage: "confirm_total" | "total" | "tip" },
) {
  addThread(ctx, chatOf(m), {
    id: a.id,
    text: a.text,
    expense_id: expenseIdFor(m.message_id),
    who: "asker",
    asker: m.sender_phone,
    data: { kind: "receipt", stage: a.stage, source: m, read: a.read, asked_at: ctx.now() },
  });
}

// Writes the expense and either proposes an even split or starts itemizing
// (§7.4 steps 6–7). Without trusted items (the math didn't add up), always even.
export async function proposeReceipt(
  ctx: BrainCtx,
  source: Message,
  read: ReceiptRead,
  opts: { itemsTrusted: boolean },
) {
  const group_id = groupFor(ctx, source)!;
  const { receipt } = read;
  const total = receipt.total_cents!;
  const expense_id = expenseIdFor(source.message_id);
  const members = activeMembers(ctx, group_id);
  const extras = opts.itemsTrusted
    ? extrasOf(receipt)
    : {
        subtotal_cents: total,
        tax_cents: 0,
        tip_cents: 0,
        fees_cents: 0,
        discount_cents: 0,
      };
  const evenShare = total / members.length;
  const lopsided =
    opts.itemsTrusted &&
    receipt.items.some((i) => i.amount_cents > LOPSIDED_FACTOR * evenShare);

  await ctx.db.upsert_expense({
    expense_id,
    group_id,
    payer_phone: source.sender_phone,
    description: receipt.merchant ?? "Receipt",
    source_message_id: source.message_id,
    split_mode: lopsided ? "itemized" : "even",
    status: lopsided ? "itemizing" : "proposed",
    ...extras,
    total_cents: total,
    objection_deadline: lopsided
      ? undefined
      : deadline(ctx, group_id, ctx.timing.durations.OBJECTION_WINDOW),
    claim_deadline: lopsided
      ? deadline(ctx, group_id, ctx.timing.durations.CLAIM_DEADLINE)
      : undefined,
  });
  if (opts.itemsTrusted) {
    await ctx.db.set_line_items({
      expense_id,
      items: receipt.items.map((i, k) => ({
        item_id: `${expense_id}:${k + 1}`,
        position: k + 1,
        description: i.description,
        quantity: i.quantity,
        amount_cents: i.amount_cents,
      })),
    });
  }
  for (const mem of members) {
    await ctx.db.set_share({
      expense_id,
      phone: mem.phone,
      role: mem.phone === source.sender_phone ? "payer" : "participant",
      // §7.5: the payer claims like everyone else.
      status: lopsided ? "awaiting_claim" : "proposed",
      responded: !lopsided && mem.phone === source.sender_phone,
      followup_count: 0,
    });
  }
  await tapback(ctx, source, "like", expense_id);
  if (lopsided) await postItemList(ctx, expense_id);
  else await postProposal(ctx, expense_id, false);
}

function deadline(ctx: BrainCtx, group_id: string, ms: number): Date {
  return outsideQuietHours(
    ctx,
    new Date(ctx.now().getTime() + ms),
    ctx.store.group(group_id)?.timezone ?? "America/Detroit",
  );
}

async function postItemList(ctx: BrainCtx, expense_id: string) {
  const e = ctx.store.expense(expense_id)!;
  const id = `item_list:${expense_id}`;
  const text = T.itemList({
    merchant: e.description,
    total_cents: e.total_cents,
    items: ctx.store.lineItems(expense_id),
  });
  await say(ctx, {
    chat: { group_id: e.group_id },
    purpose: "item_list",
    id,
    text,
    expense_id,
    reply_to: e.source_message_id, // answers the receipt photo
  });
  // Open to claims until it finalizes.
  addInvite(ctx, { group_id: e.group_id }, { id, text, kind: "claims_open", expense_id });
}

// §7.5 "uneven without specifics": a receipt switches to itemizing.
export async function startItemizing(ctx: BrainCtx, e: Expense) {
  await ctx.db.upsert_expense({
    ...e,
    split_mode: "itemized",
    status: "itemizing",
    objection_deadline: undefined,
    claim_deadline: deadline(
      ctx,
      e.group_id,
      ctx.timing.durations.CLAIM_DEADLINE,
    ),
  });
  for (const s of ctx.store
    .shares(e.expense_id)
    .filter((x) => x.status !== "opted_out")) {
    await ctx.db.set_share({
      ...s,
      status: "awaiting_claim",
      responded: false,
      followup_count: 0,
    });
  }
  await postItemList(ctx, e.expense_id);
}

// Itemizing expenses where this sender still has a share to claim on.
export function claimTargets(ctx: BrainCtx, m: Message): Expense[] {
  return ctx.store
    .expenses()
    .filter(
      (e) =>
        e.status === "itemizing" && (!m.group_id || e.group_id === m.group_id),
    )
    .filter((e) =>
      ctx.store
        .shares(e.expense_id)
        .some((s) => s.phone === m.sender_phone && s.status !== "opted_out"),
    )
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export async function handleClaim(
  ctx: BrainCtx,
  m: Message,
  target?: Expense,
): Promise<void> {
  const targets = target ? [target] : claimTargets(ctx, m);
  if (targets.length === 0) return;
  if (targets.length > 1 && !m.group_id) {
    // §14: two open lists in a DM: ask which one with a numbered list.
    const id = `clarify:${m.message_id}`;
    const text = T.whichList(targets.map((e) => e.description));
    await tapback(ctx, m, "question");
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id, reply_to: m.message_id,
      text,
    });
    addThread(ctx, chatOf(m), {
      id,
      text,
      who: "asker",
      asker: m.sender_phone,
      data: { kind: "which", source: m, expense_ids: targets.map((e) => e.expense_id), asked_at: ctx.now() },
    });
    return;
  }
  const e = targets[0]!;
  const items = ctx.store.lineItems(e.expense_id);
  const { result } = await ctx.extract.claim(extractInput(ctx, m), items);
  if (result.kind === "unclear") return askWhichItems(ctx, m, e);
  await applyClaim(ctx, m, e, result);
  await tapback(ctx, m, "like", e.expense_id);
  // §7.5: as soon as everyone has responded, finalize. Nobody waits.
  const live = ctx.store
    .shares(e.expense_id)
    .filter((s) => s.status !== "opted_out");
  if (live.every((s) => s.responded))
    await finalize(ctx, ctx.store.expense(e.expense_id)!);
}

// "Which ones?" about an open item list, open to the answer.
export async function askWhichItems(ctx: BrainCtx, m: Message, e: Expense) {
  const id = `clarify:${m.message_id}`;
  await tapback(ctx, m, "question", e.expense_id);
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id, reply_to: m.message_id,
    text: T.whichItems(m.message_id),
    expense_id: e.expense_id,
  });
  addInvite(ctx, chatOf(m), { id, text: `${e.description}: ${T.whichItems(m.message_id)}`, kind: "claims_open", expense_id: e.expense_id });
}

async function applyClaim(
  ctx: BrainCtx,
  m: Message,
  e: Expense,
  r: ClaimResolution,
) {
  const items = ctx.store.lineItems(e.expense_id);
  const itemAt = (pos: number) => items.find((i) => i.position === pos)!;
  const claim = (item_id: string, phone: string) =>
    ctx.db.add_claim({ item_id, phone, source_message_id: m.message_id });

  // Their latest answer is their whole claim: "actually just 3" after
  // "1 and 4" drops 1 and 4 (Harjyot's review on #14). Items everyone
  // shares are added on top, never replacing anything.
  if (r.kind !== "everyone_shares") {
    const claims = ctx.store.claims(e.expense_id);
    const people = ctx.store.shares(e.expense_id).filter((s) => s.status !== "opted_out").length;
    const shared = (item_id: string) => claims.filter((c) => c.item_id === item_id).length >= people;
    const keep = new Set(r.kind === "items" ? r.item_positions.map((p) => itemAt(p).item_id) : []);
    for (const c of claims.filter((x) => x.phone === m.sender_phone && !keep.has(x.item_id) && !shared(x.item_id)))
      await ctx.db.remove_claim({ item_id: c.item_id, phone: c.phone });
  }
  if (r.kind === "items")
    for (const p of r.item_positions)
      await claim(itemAt(p).item_id, m.sender_phone);
  if (r.kind === "everyone_shares") {
    const live = ctx.store
      .shares(e.expense_id)
      .filter((s) => s.status !== "opted_out");
    for (const p of r.item_positions)
      for (const s of live) await claim(itemAt(p).item_id, s.phone);
  }
  if (r.kind === "same_as" && r.same_as_phone) {
    // Copy their claims as they are right now (§7.5).
    for (const c of ctx.store
      .claims(e.expense_id)
      .filter((x) => x.phone === r.same_as_phone))
      await claim(c.item_id, m.sender_phone);
  }
  // "even": no claims; their share is part of the unclaimed pool.
  const share = ctx.store
    .shares(e.expense_id)
    .find((s) => s.phone === m.sender_phone)!;
  await ctx.db.set_share({ ...share, status: "locked", responded: true });
}

// §7.5 follow-ups for people who haven't claimed, generated when due. Joe's
// call: they go in the group chat by name, not by DM (changes SPEC P5).
export async function claimFollowups(ctx: BrainCtx) {
  const now = ctx.now();
  const d = ctx.timing.durations;
  await perExpense(ctx, ctx.store.expenses().filter((x) => x.status === "itemizing" && x.claim_deadline), async (e) => {
    const end = e.claim_deadline!;
    if (now >= end) {
      await finalize(ctx, e); // unclaimed items split evenly by the module
      return;
    }
    const start = end.getTime() - d.CLAIM_DEADLINE;
    const tz = ctx.store.group(e.group_id)?.timezone ?? "America/Detroit";
    const members = activeMembers(ctx, e.group_id);
    for (const s of ctx.store.shares(e.expense_id).filter((x) => x.status === "awaiting_claim" && !x.responded)) {
      const due = [start + d.FOLLOWUP_DM1_AFTER, start + d.FOLLOWUP_DM1_AFTER + d.FOLLOWUP_DM2_AFTER, start + d.FOLLOWUP_DM3_AFTER][s.followup_count];
      if (due === undefined || s.followup_count >= MAX_DMS_PER_EXPENSE || now.getTime() < due) continue;
      const person = { phone: s.phone, name: members.find((x) => x.phone === s.phone)?.name };
      const text =
        s.followup_count < 2
          ? T.claimNudge({ seed: `${e.expense_id}:${s.phone}`, person, merchant: e.description, step: (s.followup_count + 1) as 1 | 2 })
          : T.claimLastCall({ person, merchant: e.description, amount_cents: s.amount_cents, when: inWords(end.getTime() - now.getTime()) });
      const id = `claim_followup:${e.expense_id}:${s.phone}:${s.followup_count + 1}`;
      await say(ctx, {
        chat: { group_id: e.group_id },
        purpose: "claim_followup",
        id,
        text,
        expense_id: e.expense_id,
        send_after: outsideQuietHours(ctx, now, tz),
      });
      addInvite(ctx, { group_id: e.group_id }, { id, text, kind: "claims_open", expense_id: e.expense_id });
      await ctx.db.set_share({ ...s, followup_count: s.followup_count + 1, last_followup_at: now });
    }
  });
}
