// Tab's open questions (SPEC §7.3 step 2, §7.5), several per chat. Each one
// remembers the message Tab asked it in, so an answer finds the question it
// answers and the expense it's about, even when two are open at once.
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, type Chat, chatKey, type Pending } from "./context.js";

// Replies Tab invites without asking anyone in particular ("Anything
// uneven?", "reply if something's off"). They carry no payload: an answer
// goes to the handler the same message would reach on its own, bound to the
// expense the invite is about.
export type Invite = {
  kind:
    | "split_open" // the split proposal and "Anything else?"
    | "adjust_open" // "What's uneven?", "That's more than the total…", "What's off?"
    | "claims_open" // the item list, "Which ones?", claim nudges
    | "settle_open"; // the settle request's "reply if something's off"
};

export const INVITES = new Set<Thread["data"]["kind"]>([
  "split_open",
  "adjust_open",
  "claims_open",
  "settle_open",
]);

export type Thread = {
  id: string; // the outbox action_id Tab asked it with
  text: string; // what Tab asked
  asked_at: Date;
  expense_id?: string;
  expense_ids?: string[]; // a question about several expenses at once
  // Who may answer (Harjyot's review on #14): the person Tab asked, for
  // questions about their own money; anyone, for facts the group knows.
  who: "asker" | "anyone";
  asker?: string; // phone of the person Tab asked
  followed_up?: boolean; // Tab already asked again after an answer it couldn't use
  data: Pending | Invite;
};

// More than this many at once is stale; the oldest go first.
const MAX_PER_CHAT = 10;

// Remembers a question Tab just sent with `say`. The same kind of question
// about the same expense replaces the older one; different questions coexist.
export function addThread(
  ctx: BrainCtx,
  chat: Chat,
  t: Omit<Thread, "asked_at">,
): Thread {
  const key = chatKey(chat);
  const same = (x: Thread) =>
    x.id === t.id ||
    (x.data.kind === t.data.kind &&
      (singleton(t) || (t.expense_id !== undefined && x.expense_id === t.expense_id)));
  const before = ctx.memory.threads.get(key) ?? [];
  // The same words again (say didn't repeat them): still followed up once.
  const followed_up = t.followed_up || before.some((x) => same(x) && x.text === t.text && x.followed_up) || undefined;
  const thread: Thread = { ...t, asked_at: ctx.now(), ...(followed_up ? { followed_up } : {}) };
  const kept = before.filter((x) => !same(x));
  ctx.memory.threads.set(key, [...kept, thread].slice(-MAX_PER_CHAT));
  return thread;
}

// One per chat: the settle-mode question, "settle the rest now?", and the
// newest settle request (it takes over the expenses of older ones).
const singleton = (t: Pick<Thread, "data">) =>
  t.data.kind === "settle_mode" ||
  t.data.kind === "settle_open" ||
  (t.data.kind === "confirm" && t.data.then === "finalize_and_settle");

// A reply Tab invites from anyone (plan §2), sent with `say` as `id`.
export function addInvite(
  ctx: BrainCtx,
  chat: Chat,
  a: { id: string; text: string; kind: Invite["kind"]; expense_id?: string; expense_ids?: string[] },
): Thread {
  return addThread(ctx, chat, {
    id: a.id,
    text: a.text,
    expense_id: a.expense_id,
    expense_ids: a.expense_ids,
    who: "anyone",
    data: { kind: a.kind },
  });
}

// Whether an open question keeps its proposed expense from locking in
// (§7.5). Not the standing invites: the proposal's own "Anything uneven?"
// is open for as long as it's proposed, and would hold it forever.
export const holdsLockIn = (t: Thread) =>
  t.data.kind !== "split_open" && t.data.kind !== "claims_open" && t.data.kind !== "settle_open";

// Closes the given kinds of question about an expense, in every chat.
export function closeExpenseThreads(ctx: BrainCtx, expense_id: string, kinds: Thread["data"]["kind"][]) {
  for (const [key, list] of ctx.memory.threads) {
    const rest = list.filter((t) => t.expense_id !== expense_id || !kinds.includes(t.data.kind));
    if (rest.length > 0) ctx.memory.threads.set(key, rest);
    else ctx.memory.threads.delete(key);
  }
}

export function closeThread(ctx: BrainCtx, chat: Chat, t: Thread) {
  const key = chatKey(chat);
  const rest = (ctx.memory.threads.get(key) ?? []).filter((x) => x.id !== t.id);
  if (rest.length > 0) ctx.memory.threads.set(key, rest);
  else ctx.memory.threads.delete(key);
}

// Open questions in a chat, newest first. A question past
// PENDING_QUESTION_TTL, or whose expense moved on, is forgotten.
export function openThreads(ctx: BrainCtx, chat: Chat): Thread[] {
  const key = chatKey(chat);
  const ttl = ctx.timing.durations.PENDING_QUESTION_TTL;
  const now = ctx.now().getTime();
  const open = (ctx.memory.threads.get(key) ?? []).filter(
    (t) => now - t.asked_at.getTime() <= ttl && stillOpen(ctx, t),
  );
  if (open.length > 0) ctx.memory.threads.set(key, open);
  else ctx.memory.threads.delete(key);
  return [...open].reverse();
}

function stillOpen(ctx: BrainCtx, t: Thread): boolean {
  const ids = t.expense_ids ?? (t.expense_id ? [t.expense_id] : []);
  const expenses = ids.map((id) => ctx.store.expense(id)).filter((e): e is Expense => Boolean(e));
  const is = (...statuses: Expense["status"][]) => expenses.some((e) => statuses.includes(e.status));
  const d = t.data;
  switch (d.kind) {
    case "expense":
      return expenses.length === 0 || is("needs_info");
    case "adjustment":
      return is("proposed", "finalized");
    case "confirm":
      if (d.then === "large_amount") return is("needs_info");
      if (d.then === "adjustment") return is("proposed", "finalized");
      if (d.then === "finalize_and_settle") return is("itemizing");
      return true;
    case "receipt":
      return expenses.length === 0; // answered once the receipt is an expense
    case "settle_mode":
    case "which":
      return true;
    case "dispute":
      // Still disputed by them: their share hasn't been resolved yet.
      return expenses.some(
        (e) =>
          e.status === "finalized" &&
          ctx.store.shares(e.expense_id).some((s) => s.phone === t.asker && s.role === "participant" && s.status === "disputed"),
      );
    case "split_open":
      return is("proposed");
    case "adjust_open":
      return is("proposed", "finalized");
    case "settle_open":
      return is("finalized");
    case "claims_open":
      return is("itemizing");
  }
}

export function mayAnswer(t: Thread, m: Message): boolean {
  return t.who === "anyone" || t.asker === m.sender_phone;
}

export const isAsker = (t: Thread, m: Message) => t.asker === m.sender_phone;

// An inline reply to one of Tab's questions picks that question for
// certain. A reply to another Tab message about the same expense (an older
// version of the proposal) picks that expense's newest question.
export function threadForReply(ctx: BrainCtx, m: Message, threads: Thread[]): Thread | undefined {
  if (!m.reply_to_id) return undefined;
  const tab = ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id);
  if (!tab) return undefined;
  return (
    threads.find((t) => t.id === tab.action_id) ??
    (tab.expense_id ? threads.find((t) => t.expense_id === tab.expense_id) : undefined)
  );
}
