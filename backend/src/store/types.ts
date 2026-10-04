// SPEC §5.2 rows as the backend sees them through Kian's backend_* views:
// snake_case field names, money as integer cents, times as Dates.
import type { ExpenseStatus, ShareStatus } from "@tab/gate";
import type {
  GroupStatus,
  MessageStatus,
  OutboxKind,
  OutboxPurpose,
  Reaction,
  SettleMode,
  ShareRole,
  SplitMode,
} from "../db/types.js";

export type Message = {
  message_id: string;
  group_id?: string;
  sender_phone: string;
  is_dm: boolean;
  kind: "text" | "image" | "reaction" | "system";
  text?: string;
  image_url?: string;
  reply_to_id?: string;
  reaction?: Reaction;
  received_at: Date;
  intent?: string;
  confidence?: number;
  status: MessageStatus;
  error?: string;
};

export type Group = {
  group_id: string;
  ledger_id: string;
  display_name?: string;
  timezone: string;
  onboarding_status: GroupStatus;
  created_at: Date;
};

export type Member = {
  member_id: string;
  group_id: string;
  phone: string;
  name?: string;
  joined_at: Date;
  left_at?: Date;
};

export type OutboxStatus =
  "queued" | "sending" | "sent" | "cancelled" | "failed";

export type Outbox = {
  action_id: string;
  kind: OutboxKind;
  group_id?: string;
  to_phone?: string;
  target_message_id?: string;
  text?: string;
  reaction?: Reaction;
  expense_id?: string;
  purpose: OutboxPurpose;
  send_after: Date;
  status: OutboxStatus;
  sent_photon_id?: string;
  created_at: Date;
};

export type Expense = {
  expense_id: string;
  group_id: string;
  payer_phone?: string;
  description: string;
  source_message_id: string;
  split_mode: SplitMode;
  status: ExpenseStatus;
  subtotal_cents?: number;
  tax_cents: number;
  tip_cents: number;
  fees_cents: number;
  discount_cents: number;
  total_cents: number;
  objection_deadline?: Date;
  claim_deadline?: Date;
  proposal_message_id?: string;
  settle_message_id?: string;
  created_at: Date;
  finalized_at?: Date;
};

export type Share = {
  share_id: string;
  expense_id: string;
  phone: string;
  role: ShareRole;
  status: ShareStatus;
  fixed_cents?: number;
  amount_cents: number;
  responded: boolean;
  followup_count: number;
  last_followup_at?: Date;
};

export type Transfer = {
  transfer_id: string;
  group_id: string;
  expense_id: string;
  from_phone: string;
  to_phone: string;
  amount_cents: number;
  status: "pending" | "done" | "failed";
  approved_by_message_id: string;
  created_at: Date;
  completed_at?: Date;
};

export type LineItem = {
  item_id: string;
  expense_id: string;
  position: number;
  description: string;
  quantity: number;
  amount_cents: number;
};

export type Claim = {
  claim_id: string;
  item_id: string;
  expense_id: string;
  phone: string;
  source_message_id: string;
  created_at: Date;
};

// Reads the backend needs. Kian's views back the real implementation; tests
// use an in-memory one that mimics the module.
export interface Store {
  messages(): Message[];
  group(group_id: string): Group | undefined;
  groups(): Group[];
  // backend_group_settings: "ledger" for a group that never chose (§7.6).
  settleMode(group_id: string): SettleMode;
  members(group_id: string): Member[];
  outbox(): Outbox[];
  expense(expense_id: string): Expense | undefined;
  expenses(): Expense[];
  shares(expense_id: string): Share[];
  transfers(): Transfer[];
  lineItems(expense_id: string): LineItem[];
  claims(expense_id: string): Claim[];
}
