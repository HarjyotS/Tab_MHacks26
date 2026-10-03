import type { ClassifyInput } from "../classifier/types.js";

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

// Extraction sees the same chat state as the classifier.
export type ExtractInput = ClassifyInput;

export type LineItem = {
  position: number;
  description: string;
  amount_cents: number;
};
