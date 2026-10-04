// Builds the SPEC §6.3 input (shared by the gate and extraction) for a message.
// extractInput holds only what Grok may see: kept, money-related content and
// Tab's own words. gateInput adds what only the gate sees (§19): the raw
// transcript, and replied-to messages the module cleared.
import type { ChatExpense, ClassifyInput, PhotoNote, ReplyTarget } from "@tab/gate";
import { CONTEXT_MESSAGES } from "../config.js";
import type { Expense, Message } from "../store/types.js";
import {
  activeMembers,
  chatKey,
  chatOf,
  recentContext,
  recentMessageIds,
  type BrainCtx,
} from "./context.js";
import { openThreads } from "./threads.js";

const OPEN = new Set(["needs_info", "proposed", "itemizing", "finalized"]);
const DONE_SHARE = new Set(["paid", "opted_out"]);

function senderGroups(ctx: BrainCtx, m: Message): string[] {
  if (m.group_id) return [m.group_id];
  return ctx.store
    .groups()
    .map((g) => g.group_id)
    .filter((g) =>
      activeMembers(ctx, g).some((x) => x.phone === m.sender_phone),
    );
}

// What is pending for the sender right now, most recent first.
export function openItemsFor(
  ctx: BrainCtx,
  m: Message,
): ClassifyInput["open_items"] {
  const groups = new Set(senderGroups(ctx, m));
  return ctx.store
    .expenses()
    .filter((e) => groups.has(e.group_id) && OPEN.has(e.status))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .flatMap((e) => {
      const share = ctx.store
        .shares(e.expense_id)
        .find((s) => s.phone === m.sender_phone);
      if (share && DONE_SHARE.has(share.status)) return [];
      return [
        {
          expense_id: e.expense_id,
          description: e.description,
          expense_status: e.status,
          my_share_status: share?.status,
        },
      ];
    });
}

// What Tab asked in this chat and is still waiting on (threads.ts), so the
// gate can tell an answer from a new message. Only Tab's own words.
export function openQuestionsFor(
  ctx: BrainCtx,
  m: Message,
  members: { phone: string; name?: string }[],
): NonNullable<ClassifyInput["open_questions"]> {
  return openThreads(ctx, chatOf(m)).map((t) => ({
    id: t.id,
    text: t.text,
    who_may_answer:
      t.who === "anyone"
        ? "anyone"
        : (members.find((x) => x.phone === t.asker)?.name ?? `member ending ${(t.asker ?? "").slice(-4)}`),
  }));
}

// An inline reply binds a message to one expense (Harjyot's review on #14,
// like §6.2 for tapbacks): a reply to Tab's message about an expense, or to
// the message that created it. Used to pick the target, never to lower a bar.
export function repliedExpense(ctx: BrainCtx, m: Message): Expense | undefined {
  if (!m.reply_to_id) return undefined;
  const tab = ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id && o.expense_id);
  const id = tab?.expense_id ?? ctx.store.expenses().find((e) => e.source_message_id === m.reply_to_id)?.expense_id;
  return id ? ctx.store.expense(id) : undefined;
}

// A settle request is open on it: finalized, requested, and someone still owes.
function requested(ctx: BrainCtx, e: Expense): boolean {
  return (
    e.status === "finalized" &&
    Boolean(e.settle_message_id) &&
    ctx.store.shares(e.expense_id).some((s) => s.role === "participant" && (s.status === "locked" || s.status === "approved") && s.amount_cents > 0)
  );
}

// Every open expense in the sender's chat, not only theirs, newest first:
// what Jev needs to read "just me and priya" or "i got both drinks". A
// locked-in expense counts only while a settle request is open on it.
export function chatExpenses(ctx: BrainCtx, m: Message): ChatExpense[] {
  const groups = new Set(senderGroups(ctx, m));
  const now = ctx.now().getTime();
  return ctx.store
    .expenses()
    .filter((e) => groups.has(e.group_id) && (["needs_info", "proposed", "itemizing"].includes(e.status) || requested(ctx, e)))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .map((e) => {
      const shares = ctx.store.shares(e.expense_id);
      const items = ctx.store.lineItems(e.expense_id);
      const mine = shares.find((s) => s.phone === m.sender_phone && s.status !== "opted_out");
      const deadline = e.status === "proposed" ? e.objection_deadline : e.status === "itemizing" ? e.claim_deadline : undefined;
      const claimed = mine
        ? ctx.store
            .claims(e.expense_id)
            .filter((c) => c.phone === m.sender_phone)
            .map((c) => items.find((i) => i.item_id === c.item_id)?.position)
            .filter((p): p is number => p !== undefined)
            .sort((a, b) => a - b)
        : [];
      return {
        expense_id: e.expense_id,
        description: e.description,
        ...(e.payer_phone ? { payer_phone: e.payer_phone } : {}),
        total_cents: e.total_cents,
        split_mode: e.split_mode,
        people: shares.filter((s) => s.status !== "opted_out").length,
        status: e.status,
        ...(deadline ? { closes_in_ms: Math.max(0, deadline.getTime() - now) } : {}),
        ...(items.length
          ? { items: items.map((i) => ({ position: i.position, description: i.description, quantity: i.quantity, amount_cents: i.amount_cents })) }
          : {}),
        ...(mine
          ? { sender: { role: mine.role, share_status: mine.status, responded: mine.responded, ...(claimed.length ? { claimed } : {}) } }
          : {}),
        ...(requested(ctx, e) ? { settle_request_open: true } : {}),
      };
    });
}

// Whether the sender has a name, and whether Tab asked for it and is waiting.
export function senderFacts(ctx: BrainCtx, m: Message): NonNullable<ClassifyInput["sender"]> {
  const groups = senderGroups(ctx, m);
  const me = groups.flatMap((g) => activeMembers(ctx, g)).filter((x) => x.phone === m.sender_phone);
  const named = me.some((x) => x.name);
  const asked = Boolean(m.group_id) && ctx.store.outbox().some((o) => o.purpose === "name_prompt" && o.group_id === m.group_id && o.status !== "cancelled");
  return { named, name_requested: !named && asked };
}

// Tab's last message in this chat: why it was sent, about what, and when.
export function tabLast(ctx: BrainCtx, m: Message): ClassifyInput["tab_last"] {
  const chat = chatOf(m);
  const last = ctx.store
    .outbox()
    .filter(
      (o) =>
        o.kind !== "reaction" &&
        o.kind !== "contact_card" &&
        o.status !== "cancelled" &&
        o.created_at <= m.received_at &&
        (chat.group_id ? o.group_id === chat.group_id : o.to_phone === chat.dm_phone),
    )
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  if (!last) return undefined;
  const about = last.expense_id ? ctx.store.expense(last.expense_id)?.description : undefined;
  return {
    purpose: last.purpose,
    ...(about ? { about } : {}),
    seconds_ago: Math.max(0, Math.round((ctx.now().getTime() - last.created_at.getTime()) / 1000)),
  };
}

// The group's settle mode, and the settle request the sender might answer.
export function settleFacts(ctx: BrainCtx, m: Message): ClassifyInput["settle"] {
  if (!m.group_id) return undefined;
  const open = ctx.store.expenses().filter((e) => e.group_id === m.group_id && requested(ctx, e));
  const mine = open.flatMap((e) => ctx.store.shares(e.expense_id).filter((s) => s.phone === m.sender_phone && s.role === "participant"));
  return {
    mode: ctx.store.settleMode(m.group_id),
    request_open: open.length > 0,
    sender_owes: mine.some((s) => s.status === "locked" && s.amount_cents > 0),
    sender_approved: mine.some((s) => s.status === "approved"),
  };
}

// Who and what an inline reply answers. Grok-safe: Tab's own words, or a
// kept (money-related) message and its photo. `bound` is the expense.
function replyTarget(ctx: BrainCtx, m: Message): ReplyTarget | undefined {
  if (!m.reply_to_id) return undefined;
  const bound = repliedExpense(ctx, m);
  const expense = bound ? { expense: { description: bound.description, status: bound.status } } : {};
  const tab = ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id);
  if (tab) return { sender_phone: "tab", ...(tab.text ? { text: tab.text } : {}), ...expense };
  const target = ctx.store.messages().find((x) => x.message_id === m.reply_to_id);
  if (!target) return bound ? { sender_phone: bound.payer_phone ?? "", ...expense } : undefined;
  const kept = target.intent !== undefined && target.intent !== "ignore";
  const photo = kept ? ctx.memory.photos.get(target.message_id) : undefined;
  return {
    sender_phone: target.sender_phone,
    ...(kept && target.text ? { text: target.text } : {}),
    ...(photo ? { photo } : {}),
    ...expense,
  };
}

export function extractInput(ctx: BrainCtx, m: Message): ClassifyInput {
  const members = senderGroups(ctx, m).flatMap((g) =>
    activeMembers(ctx, g).map((x) => ({ phone: x.phone, name: x.name })),
  );
  const unique = [...new Map(members.map((x) => [x.phone, x])).values()];
  const open_questions = openQuestionsFor(ctx, m, unique);
  const photo = m.kind === "image" ? ctx.memory.photos.get(m.message_id) : undefined;
  const reply_target = replyTarget(ctx, m);
  const tab_last = tabLast(ctx, m);
  const settle = settleFacts(ctx, m);
  return {
    members: [{ phone: "tab", name: "Tab" }, ...unique],
    context: recentContext(ctx, chatOf(m), m.received_at),
    open_items: openItemsFor(ctx, m),
    ...(open_questions.length ? { open_questions } : {}),
    chat_expenses: chatExpenses(ctx, m),
    sender: senderFacts(ctx, m),
    ...(tab_last ? { tab_last } : {}),
    ...(settle ? { settle } : {}),
    message: {
      sender_phone: m.sender_phone,
      is_dm: m.is_dm,
      kind: m.kind,
      text: m.text,
      image_url: m.image_url,
      reply_to_id: m.reply_to_id,
      reply_to_tab: m.reply_to_id
        ? ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id)?.text
        : undefined,
      ...(photo ? { photo } : {}),
      ...(reply_target ? { reply_target } : {}),
    },
  };
}

// The gate's input: extractInput plus what only the gate may see (§19).
// Never pass this to an extractor.
export function gateInput(ctx: BrainCtx, m: Message): ClassifyInput {
  const input = extractInput(ctx, m);
  const key = chatKey(chatOf(m));
  const now = ctx.now();
  const lines = ctx.memory.transcript.recent(key, now, m.received_at).filter((e) => e.message_id !== m.message_id);
  // A reply to a message the module cleared: the gate still knows what it said.
  const target = input.message.reply_target;
  if (target && target.sender_phone !== "tab" && !target.text && !target.photo && m.reply_to_id) {
    const line = lines.find((e) => e.message_id === m.reply_to_id);
    const photo = line?.photo ?? ctx.memory.photos.get(m.reply_to_id);
    if (line?.text) target.text = line.text;
    if (photo) target.photo = photo;
  }
  return {
    ...input,
    ...(lines.length
      ? {
          raw_transcript: lines.map((e) => ({
            sender_phone: e.sender_phone,
            ...(e.text ? { text: e.text } : {}),
            ...(e.photo ? { photo: e.photo } : {}),
            seconds_ago: Math.max(0, Math.round((now.getTime() - e.at.getTime()) / 1000)),
          })),
        }
      : {}),
  };
}

// Adds a message to the gate's raw transcript (§19: memory only, 15 minutes).
export function remember(ctx: BrainCtx, m: Message) {
  if (m.kind !== "text" && m.kind !== "image") return;
  ctx.memory.transcript.add(
    chatKey(chatOf(m)),
    {
      message_id: m.message_id,
      sender_phone: m.sender_phone,
      ...(m.text ? { text: m.text } : {}),
      ...(m.kind === "image" && ctx.memory.photos.get(m.message_id) ? { photo: ctx.memory.photos.get(m.message_id)! } : {}),
      at: m.received_at,
    },
    ctx.now(),
  );
}

// The queue is serial across chats, so one slow image fetch or vision call
// can't hold every group for long (Joe's review on #41). Past this, the
// photo goes undescribed: a bare one still counts as a possible receipt.
export const DESCRIBE_TIMEOUT_MS = 6_000;

class DescribeTimeout extends Error {}

// What Grok vision sees in a photo (§7.4), from memory or described now.
// An image that's gone, unreadable, or too slow is skipped, and not tried
// again.
export async function describePhoto(ctx: BrainCtx, m: Pick<Message, "message_id" | "image_url" | "text">): Promise<PhotoNote | undefined> {
  if (ctx.memory.photos.has(m.message_id)) return ctx.memory.photos.get(m.message_id);
  if (!m.image_url || !ctx.extract.describe) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DescribeTimeout(`no description after ${DESCRIBE_TIMEOUT_MS} ms`)), DESCRIBE_TIMEOUT_MS);
  });
  try {
    const note = await Promise.race([ctx.extract.describe(m.image_url, m.text), timeout]);
    ctx.memory.photos.set(m.message_id, note);
    return note;
  } catch (err) {
    ctx.log(err instanceof DescribeTimeout ? "describe_timeout" : "describe_failed", { message_id: m.message_id, error: String(err) });
    ctx.memory.photos.set(m.message_id, null);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Most photos looked up again after a restart.
const REDESCRIBE = 3;

// Before the gate: describe the new photo, the photo it replies to, and
// kept photos this process hasn't seen (after a restart) that recentContext
// will show, so the synchronous input builders find them in memory. Only
// that window, never a walk back through the chat's photo history (Joe's
// review on #41).
export async function describePhotos(ctx: BrainCtx, m: Message): Promise<void> {
  if (m.kind === "image") {
    const note = await describePhoto(ctx, m);
    if (note) ctx.memory.transcript.describe(chatKey(chatOf(m)), m.message_id, note);
  }
  const chat = chatOf(m);
  const shown = new Set(recentMessageIds(ctx, chat, m.received_at));
  const targets = ctx.store
    .messages()
    .filter((x) => x.kind === "image" && x.image_url && x.message_id !== m.message_id && !ctx.memory.photos.has(x.message_id))
    .filter((x) => (chat.group_id ? x.group_id === chat.group_id : !x.group_id && x.sender_phone === chat.dm_phone))
    .filter((x) => x.message_id === m.reply_to_id || shown.has(x.message_id))
    // The photo being replied to first, then the newest.
    .sort((a, b) => Number(b.message_id === m.reply_to_id) - Number(a.message_id === m.reply_to_id) || b.received_at.getTime() - a.received_at.getTime())
    .slice(0, Math.min(REDESCRIBE, CONTEXT_MESSAGES));
  for (const x of targets) await describePhoto(ctx, x);
}
