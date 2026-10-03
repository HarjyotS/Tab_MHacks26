// Everything a handler needs, injected so tests can run the whole brain
// against an in-memory database and fake models.
import type { Classify, GateMessage } from "@tab/gate";
import { CONTEXT_MESSAGES, type Timing } from "../config.js";
import type { BackendReducers } from "../db/reducers.js";
import type { OutboxPurpose, Reaction } from "../db/types.js";
import { compose } from "../copy/compose.js";
import { detectStyle, type GroupStyle } from "../copy/style.js";
import type { WitContext } from "../copy/wit.js";
import type { ExpenseMode } from "../extraction/expense.js";
import type {
  ExpenseExtraction,
  Extracted,
  ExtractInput,
  Problem,
} from "../extraction/types.js";
import type { ReceiptRead } from "../extraction/receipt.js";
import type { ClaimResolution, LineItem as ClaimItem } from "../extraction/types.js";
import type { Message, Store } from "../store/types.js";

export type Chat = { group_id?: string; dm_phone?: string };

export const chatKey = (c: Chat) => c.group_id ?? `dm:${c.dm_phone}`;
export const chatOf = (m: Message): Chat =>
  m.group_id ? { group_id: m.group_id } : { dm_phone: m.sender_phone };

// A question Tab asked and is waiting on (SPEC §7.3 step 2, §7.5).
export type Pending =
  | {
      kind: "expense";
      source: Message;
      text: string; // the source text plus any answers so far
      problems: Problem[];
      expense_id?: string; // set once a needs_info row exists
      asked_at: Date;
    }
  | {
      kind: "adjustment";
      source: Message;
      text: string;
      expense_id: string;
      problems: Problem[];
      asked_at: Date;
    }
  | {
      kind: "confirm"; // "yes" proceeds with `then`
      source: Message;
      then: "expense" | "approval" | "large_amount";
      extraction?: Extracted<ExpenseExtraction>;
      expense_id?: string;
      asked_at: Date;
    }
  | {
      kind: "receipt"; // §7.4: confirming the total, a total in dollars, or the tip
      stage: "confirm_total" | "total" | "tip";
      source: Message;
      read: ReceiptRead;
      asked_at: Date;
    }
  | {
      kind: "which"; // a DM claim with two open lists (§14)
      source: Message;
      expense_ids: string[];
      asked_at: Date;
    };

// Process-local memory. Kian's backend_messages view only returns new and
// processing messages, so recent chat history for classifier context and
// style matching lives here, and is lost on restart.
export class Memory {
  private history = new Map<
    string,
    { sender_phone: string; text: string; at: Date }[]
  >();
  pending = new Map<string, Pending>();
  lastHadWit = new Map<string, boolean>();

  remember(m: Message) {
    if (m.kind !== "text" || !m.text) return;
    const key = chatKey(chatOf(m));
    const list = this.history.get(key) ?? [];
    list.push({
      sender_phone: m.sender_phone,
      text: m.text,
      at: m.received_at,
    });
    this.history.set(key, list.slice(-30));
  }

  humanHistory(chat: Chat) {
    return this.history.get(chatKey(chat)) ?? [];
  }
}

export type Extractors = {
  expense: (
    input: ExtractInput,
    mode: ExpenseMode,
  ) => Promise<Extracted<ExpenseExtraction>>;
  // `image_url` comes from the client; main.ts fetches it for Grok.
  receipt: (image_url: string, caption?: string) => Promise<ReceiptRead>;
  claim: (input: ExtractInput, items: ClaimItem[]) => Promise<Extracted<ClaimResolution>>;
};

export type BrainCtx = {
  store: Store;
  db: BackendReducers;
  now: () => Date;
  classify: Classify;
  extract: Extractors;
  wit?: (ctx: WitContext) => Promise<string | null>;
  timing: Timing;
  memory: Memory;
  log: (event: string, fields: Record<string, unknown>) => void;
};

// ── Reading chat state ───────────────────────────────────────────────────

export function activeMembers(ctx: BrainCtx, group_id: string) {
  return ctx.store.members(group_id).filter((m) => !m.left_at);
}

export function styleFor(ctx: BrainCtx, chat: Chat): GroupStyle {
  return detectStyle(
    ctx.memory
      .humanHistory(chat)
      .slice(-10)
      .map((h) => h.text),
  );
}

// SPEC §6.3 context: recent messages in the chat, oldest first, with Tab's
// own messages (from the outbox) as sender "tab".
export function recentContext(
  ctx: BrainCtx,
  chat: Chat,
  before: Date,
): GateMessage[] {
  const humans = ctx.memory
    .humanHistory(chat)
    .filter((h) => h.at < before)
    .map((h) => ({
      at: h.at,
      msg: {
        sender_phone: h.sender_phone,
        is_dm: !chat.group_id,
        kind: "text" as const,
        text: h.text,
      },
    }));
  const tab = ctx.store
    .outbox()
    .filter(
      (o) =>
        o.kind !== "reaction" &&
        o.text &&
        (chat.group_id
          ? o.group_id === chat.group_id
          : o.to_phone === chat.dm_phone),
    )
    .filter((o) => o.created_at < before && o.status !== "cancelled")
    .map((o) => ({
      at: o.created_at,
      msg: {
        sender_phone: "tab",
        is_dm: !chat.group_id,
        kind: "text" as const,
        text: o.text,
      },
    }));
  return [...humans, ...tab]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-CONTEXT_MESSAGES)
    .map((x) => x.msg);
}

// ── Sending (every write goes through reducers) ──────────────────────────

export async function say(
  ctx: BrainCtx,
  a: {
    chat: Chat;
    purpose: OutboxPurpose;
    id: string;
    text: string;
    expense_id?: string;
    send_after?: Date;
    wit?: string | null;
  },
) {
  const text = compose({
    purpose: a.purpose,
    text: a.text,
    in_group: Boolean(a.chat.group_id),
    style: styleFor(ctx, a.chat),
    wit: a.wit,
  });
  ctx.memory.lastHadWit.set(chatKey(a.chat), Boolean(a.wit));
  await ctx.db.enqueue_outbox({
    action_id: a.id,
    kind: a.chat.group_id ? "group_message" : "dm",
    group_id: a.chat.group_id,
    to_phone: a.chat.dm_phone,
    text,
    expense_id: a.expense_id,
    purpose: a.purpose,
    send_after: a.send_after ?? ctx.now(),
  });
}

// SPEC §13: Like = logged or understood; Question = not sure, a question follows.
export async function tapback(
  ctx: BrainCtx,
  m: Message,
  reaction: Extract<Reaction, "like" | "question">,
  expense_id?: string,
) {
  await ctx.db.enqueue_outbox({
    action_id: `tapback:${m.message_id}:${reaction}`,
    kind: "reaction",
    group_id: m.group_id,
    to_phone: m.group_id ? undefined : m.sender_phone,
    target_message_id: m.message_id,
    reaction,
    expense_id,
    purpose: "tapback",
    send_after: ctx.now(),
  });
}

export function alreadyQueued(ctx: BrainCtx, action_id: string): boolean {
  return ctx.store.outbox().some((o) => o.action_id === action_id);
}

// Quiet hours (SPEC §11.3): push unprompted messages to the end of the window.
export function outsideQuietHours(
  ctx: BrainCtx,
  at: Date,
  timezone: string,
): Date {
  const q = ctx.timing.quietHours;
  if (!q) return at;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(at),
  );
  const quiet =
    q.start > q.end
      ? hour >= q.start || hour < q.end
      : hour >= q.start && hour < q.end;
  if (!quiet) return at;
  const hoursUntilEnd = (q.end - hour + 24) % 24 || 24;
  const next = new Date(at.getTime() + hoursUntilEnd * 3_600_000);
  next.setMinutes(0, 0, 0);
  return next;
}

// "in an hour", "in 10 seconds": for reminders that quote the deadline.
export function inWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `in ${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 90) return m === 60 ? "in an hour" : `in ${m} minutes`;
  const h = Math.round(m / 60);
  return h === 1 ? "in an hour" : `in ${h} hours`;
}
