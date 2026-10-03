import type { ClassifyInput, ClassifyResult } from "@tab/gate";
import { thresholds as defaults } from "../config.js";

export type Decision = "act" | "clarify" | "ignore";

type Thresholds = { act: number; clarify: number; approvalText: number };

function hasSettleRequestFor(input: ClassifyInput): boolean {
  return input.open_items.some(
    (o) => o.expense_status === "finalized" && o.my_share_status === "locked",
  );
}

// SPEC §6.4 thresholds on the gate's result, plus a code-level check for
// approvals: the only intent that moves money must clear a higher bar AND
// have something to approve, regardless of what the classifier says.
export function decide(
  result: ClassifyResult,
  input: ClassifyInput,
  t: Thresholds = defaults,
): Decision {
  if (result.intent === "ignore") return "ignore";
  if (result.intent === "approval") {
    if (!hasSettleRequestFor(input)) return "ignore";
    if (result.confidence >= t.approvalText) return "act";
    return result.confidence >= t.clarify ? "clarify" : "ignore";
  }
  if (result.confidence >= t.act) return "act";
  if (result.confidence >= t.clarify) return "clarify";
  return "ignore";
}
