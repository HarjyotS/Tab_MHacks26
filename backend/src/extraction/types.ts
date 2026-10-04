import type { ClassifyInput } from "@tab/gate";

// SPEC §9.2 [CONTRACT] output shapes.
export type ExpenseExtraction = {
  is_expense: boolean;
  amount_cents?: number;
  description?: string;
  payer:
    | { kind: "sender" }
    | { kind: "member"; phone: string }
    | { kind: "unknown" };
  participants: { kind: "everyone" } | { kind: "list"; phones: string[] };
  exclusions: string[];
  fixed: { phone: string; amount_cents?: number; item?: string }[];
  missing: ("amount" | "payer" | "item_price")[];
};

export type ClaimResolution = {
  kind: "items" | "even" | "same_as" | "everyone_shares" | "unclear";
  item_positions: number[];
  same_as_phone?: string;
};

export type CorrectionExtraction = {
  target_expense_id?: string;
  new_amount_cents?: number;
  new_description?: string;
  unclear: boolean;
};

// One of Tab's open questions, as the answer resolver sees it.
export type OpenThread = {
  id: string;
  question: string; // Tab's own words
  expects: string; // what an answer looks like, in words
  choices?: number; // numbered choices 1..n
  who: string; // "anyone", or the one person who may answer
};

// What else a message that answers a question may also be doing.
export const ALSO_INTENTS = [
  "expense",
  "split_adjustment",
  "claim",
  "dispute",
  "settle_up",
  "balance_query",
  "breakdown_request",
  "help",
] as const;

// The answer resolver's output after validation in code (P6): thread_id is
// one of the questions offered, amounts are grounded in the message, and a
// choice is in range. Fields it couldn't read are absent.
export type AnswerResolution = {
  thread_id?: string;
  relevance: number;
  yes_no?: "yes" | "no";
  amount_cents?: number;
  percent?: number;
  choice?: number;
  settle_mode?: "ledger" | "per_expense";
  restated?: string;
  also_new: boolean;
  also_intent?: (typeof ALSO_INTENTS)[number];
};

// Why Tab can't act yet. Each problem maps to exactly one short clarifying
// question, so handlers ask one thing at a time (P2) and never guess (P3).
export type Problem =
  | { kind: "missing_amount" }
  | { kind: "missing_payer" }
  | { kind: "missing_item_price"; phone: string; item: string }
  | { kind: "ungrounded_amount"; amount_cents: number }
  | { kind: "unknown_name"; name: string }
  | { kind: "large_amount"; amount_cents: number }
  | { kind: "invalid_amount"; amount_cents: number };

export type Extracted<T> = { result: T; problems: Problem[] };

// Extraction sees the same chat state as the gate (SPEC §6.3). Tab's own
// messages appear in `context` with sender_phone "tab".
export type ExtractInput = ClassifyInput;

export type LineItem = {
  position: number;
  description: string;
  amount_cents: number;
};
