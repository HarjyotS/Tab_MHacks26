// Store backed by Kian's role-gated backend_* views (subscribed by main.ts).
import type { Timestamp } from "spacetimedb";
import { tables, type DbConnection } from "../module_bindings/index.js";
import type {
  Expense,
  Group,
  Member,
  Message,
  Outbox,
  Share,
  Store,
  Transfer,
} from "./types.js";

type Db = DbConnection["db"];
type Row<K extends keyof Db> = Db[K] extends { iter(): Iterable<infer R> }
  ? R
  : never;

export const BACKEND_VIEWS = [
  tables.backendMessages,
  tables.backendGroups,
  tables.backendMembers,
  tables.backendOutbox,
  tables.backendExpenses,
  tables.backendLineItems,
  tables.backendClaims,
  tables.backendShares,
  tables.backendTransfers,
];

function cents(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`cents out of range: ${v}`);
  return n;
}
const date = (t: Timestamp) => t.toDate();
const optDate = (t: Timestamp | undefined) =>
  t === undefined ? undefined : t.toDate();
const optCents = (v: bigint | undefined) =>
  v === undefined ? undefined : cents(v);

// The module validates every enum before insert, so these narrowings hold.
const message = (r: Row<"backendMessages">): Message => ({
  message_id: r.messageId,
  group_id: r.groupId,
  sender_phone: r.senderPhone,
  is_dm: r.isDm,
  kind: r.kind as Message["kind"],
  text: r.text,
  image_url: r.imageUrl,
  reply_to_id: r.replyToId,
  reaction: r.reaction as Message["reaction"],
  received_at: date(r.receivedAt),
  intent: r.intent,
  confidence: r.confidence,
  status: r.status as Message["status"],
  error: r.error,
});

const group = (r: Row<"backendGroups">): Group => ({
  group_id: r.groupId,
  ledger_id: r.ledgerId,
  display_name: r.displayName,
  timezone: r.timezone,
  onboarding_status: r.onboardingStatus as Group["onboarding_status"],
  created_at: date(r.createdAt),
});

const member = (r: Row<"backendMembers">): Member => ({
  member_id: r.memberId,
  group_id: r.groupId,
  phone: r.phone,
  name: r.name,
  joined_at: date(r.joinedAt),
  left_at: optDate(r.leftAt),
});

const outbox = (r: Row<"backendOutbox">): Outbox => ({
  action_id: r.actionId,
  kind: r.kind as Outbox["kind"],
  group_id: r.groupId,
  to_phone: r.toPhone,
  target_message_id: r.targetMessageId,
  text: r.text,
  reaction: r.reaction as Outbox["reaction"],
  expense_id: r.expenseId,
  purpose: r.purpose as Outbox["purpose"],
  send_after: date(r.sendAfter),
  status: r.status as Outbox["status"],
  sent_photon_id: r.sentPhotonId,
  created_at: date(r.createdAt),
});

const expense = (r: Row<"backendExpenses">): Expense => ({
  expense_id: r.expenseId,
  group_id: r.groupId,
  payer_phone: r.payerPhone,
  description: r.description,
  source_message_id: r.sourceMessageId,
  split_mode: r.splitMode as Expense["split_mode"],
  status: r.status as Expense["status"],
  subtotal_cents: optCents(r.subtotalCents),
  tax_cents: cents(r.taxCents),
  tip_cents: cents(r.tipCents),
  fees_cents: cents(r.feesCents),
  discount_cents: cents(r.discountCents),
  total_cents: cents(r.totalCents),
  objection_deadline: optDate(r.objectionDeadline),
  claim_deadline: optDate(r.claimDeadline),
  proposal_message_id: r.proposalMessageId,
  settle_message_id: r.settleMessageId,
  created_at: date(r.createdAt),
  finalized_at: optDate(r.finalizedAt),
});

const share = (r: Row<"backendShares">): Share => ({
  share_id: r.shareId,
  expense_id: r.expenseId,
  phone: r.phone,
  role: r.role as Share["role"],
  status: r.status as Share["status"],
  fixed_cents: optCents(r.fixedCents),
  amount_cents: cents(r.amountCents),
  responded: r.responded,
  followup_count: r.followupCount,
  last_followup_at: optDate(r.lastFollowupAt),
});

const transfer = (r: Row<"backendTransfers">): Transfer => ({
  transfer_id: r.transferId,
  group_id: r.groupId,
  expense_id: r.expenseId,
  from_phone: r.fromPhone,
  to_phone: r.toPhone,
  amount_cents: cents(r.amountCents),
  status: r.status as Transfer["status"],
  approved_by_message_id: r.approvedByMessageId,
  created_at: date(r.createdAt),
  completed_at: optDate(r.completedAt),
});

export function spacetimeStore(db: Db): Store {
  return {
    messages: () => [...db.backendMessages.iter()].map(message),
    group: (id) =>
      [...db.backendGroups.iter()].map(group).find((g) => g.group_id === id),
    groups: () => [...db.backendGroups.iter()].map(group),
    members: (id) =>
      [...db.backendMembers.iter()]
        .map(member)
        .filter((m) => m.group_id === id),
    outbox: () => [...db.backendOutbox.iter()].map(outbox),
    expense: (id) =>
      [...db.backendExpenses.iter()]
        .map(expense)
        .find((e) => e.expense_id === id),
    expenses: () => [...db.backendExpenses.iter()].map(expense),
    shares: (id) =>
      [...db.backendShares.iter()]
        .map(share)
        .filter((s) => s.expense_id === id),
    transfers: () => [...db.backendTransfers.iter()].map(transfer),
  };
}
