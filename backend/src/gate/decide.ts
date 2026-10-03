import type { ClassifyInput, ClassifyResult } from "@tab/gate";
import { thresholds as defaults } from "../config.js";

export type Decision = "act" | "clarify" | "ignore";

type Thresholds = { act: number; clarify: number };

function hasSettleRequestFor(input: ClassifyInput): boolean {
  return input.open_items.some(
    (o) => o.expense_status === "finalized" && o.my_share_status === "locked",
  );
}

// SPEC §6.4 thresholds on the gate's result.
export function decide(
  result: ClassifyResult,
  input: ClassifyInput,
  t: Thresholds = defaults,
): Decision {
  if (result.intent === "ignore") return "ignore";
  // A typed approval never moves money (P7, SPEC #15); it only earns a pointer
  // to the 👍, and only when something is waiting to be paid.
  if (result.intent === "approval" && !hasSettleRequestFor(input)) return "ignore";
  if (result.confidence >= t.act) return "act";
  if (result.confidence >= t.clarify) return "clarify";
  return "ignore";
}
