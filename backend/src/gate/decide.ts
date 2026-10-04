import type { ClassifyInput, ClassifyResult, Intent } from "@tab/gate";
import { thresholds as defaults } from "../config.js";

export type Decision = "act" | "clarify" | "ignore";

type Thresholds = { act: number; clarify: number };

const addressed: Thresholds = { act: 0.6, clarify: 0.3 };

// Intents that only read data. Anything that writes money state keeps the
// normal act bar even in a reply to Tab, so a loose read gets a question,
// not a changed split.
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
  // weight), so a less certain read still gets an answer or a question.
  const bar = !input.message.reply_to_tab
    ? t
    : READ_ONLY.has(result.intent)
      ? addressed
      : { act: t.act, clarify: addressed.clarify };
  if (result.confidence >= bar.act) return "act";
  if (result.confidence >= bar.clarify) return "clarify";
  return "ignore";
}
