// Argument shapes for the reducers the backend calls (SPEC §5.5), using the
// §5.2 field names. Money is integer cents as a number, times are Dates;
// reducers.ts converts both to what SpacetimeDB expects.
import type { ExpenseStatus, Intent, ShareStatus } from "@tab/gate";

export type { ExpenseStatus, ShareStatus };

// SPEC §5.2
export type OutboxPurpose =
  | "onboarding_intro"
  | "name_prompt"
  | "split_proposal"
  | "objection_reminder"
  | "item_list"
  | "claim_followup"
  | "group_mention"
  | "settle_request"
  | "approval_followup"
  | "payment_receipt"
  | "all_square"
  | "clarifying_question"
  | "balance_reply"
  | "breakdown_reply"
  | "dispute_followup"
  | "help_reply"
  | "tapback"
  | "other";

export type MessageStatus = "new" | "processing" | "done" | "error";
export type GroupStatus = "pending" | "active";
export type SplitMode = "even" | "custom" | "itemized";
export type ShareRole = "payer" | "participant";
export type OutboxKind = "group_message" | "dm" | "reaction" | "contact_card";
export type Reaction =
  "like" | "love" | "dislike" | "laugh" | "emphasize" | "question";
// SPEC §7.6, stored by set_settle_mode. A group that never chose is "ledger".
export type SettleMode = "ledger" | "per_expense";

export type SetMessageResult = {
  message_id: string;
  intent?: Intent;
  confidence?: number;
  status: MessageStatus;
  error?: string;
};

export type UpsertExpense = {
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
  finalized_at?: Date;
};

export type LineItemInput = {
  item_id: string;
  position: number;
  description: string;
  quantity: number;
  amount_cents: number;
};

export type SetShare = {
  expense_id: string;
  phone: string;
  role: ShareRole;
  status: ShareStatus;
  fixed_cents?: number;
  responded: boolean;
  followup_count: number;
  last_followup_at?: Date;
};

export type EnqueueOutbox = {
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
};

export type CreateTransfer = {
  transfer_id: string;
  expense_id: string;
  from_phone: string;
  approved_by_message_id: string;
};
