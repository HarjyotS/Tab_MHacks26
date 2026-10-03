import type { TextIntent } from "./intents.js";

export type ExpenseStatus =
  "needs_info" | "proposed" | "itemizing" | "finalized" | "settled" | "void";

export type ShareStatus =
  | "proposed"
  | "awaiting_claim"
  | "locked"
  | "approved"
  | "paid"
  | "disputed"
  | "opted_out";

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

export type Member = { phone: string; name?: string };

// A recent message in the same chat. Tab's own messages come from the outbox
// and carry their purpose, which is most of the context the classifier needs.
export type ContextEntry =
  | { from: "tab"; text: string; purpose: OutboxPurpose }
  | { from: string; text: string };

export type OpenItem = {
  expense_id: string;
  description: string;
  expense_status: ExpenseStatus;
  my_share_status?: ShareStatus;
};

// SPEC §6.3, adjusted: context entries are chat lines with Tab's purpose
// attached, rather than raw `messages` rows.
export type ClassifyInput = {
  chat: "group" | "dm";
  message: {
    sender: string;
    text: string;
    reply_to_tab_purpose?: OutboxPurpose;
  };
  context: ContextEntry[];
  members: Member[];
  open_items: OpenItem[];
};

export type ClassifyResult = {
  intent: TextIntent;
  confidence: number;
  reason: string;
};
