import type { ClassifyInput, ClassifyResult, Intent } from "@tab/gate";
import { thresholds as defaults } from "../config.js";

export type Decision = "act" | "clarify" | "ignore";

type Thresholds = { act: number; clarify: number };

// Intents that only read data; nothing is written when Tab acts on them.
const READ_ONLY = new Set<Intent>(["help", "balance_query", "breakdown_request"]);

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
  // An inline reply to Tab is talking to Tab (Harjyot: replies carry more
  // weight), so a less certain read still gets a question instead of
  // silence. Only read-only answers also act on it; anything that changes
  // money keeps the full act bar (Joe's review on #24).
  const bar = !input.message.reply_to_tab
    ? t
    : { act: READ_ONLY.has(result.intent) ? 0.6 : t.act, clarify: 0.3 };
  if (result.confidence >= bar.act) return "act";
  if (result.confidence >= bar.clarify) return "clarify";
  return "ignore";
}
