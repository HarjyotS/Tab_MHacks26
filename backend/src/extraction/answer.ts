import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import { isGrounded } from "./grounding.js";
import { renderExtractInput, UNTRUSTED_RULE } from "./prompt.js";
import {
  ALSO_INTENTS,
  type AnswerResolution,
  type ExtractInput,
  type OpenThread,
} from "./types.js";

const raw = z.object({
  thread_id: z.string().nullable(),
  relevance: z.number(),
  yes_no: z.string().nullable(),
  amount_cents: z.number().int().nullable(),
  percent: z.number().nullable(),
  choice: z.number().int().nullable(),
  settle_mode: z.string().nullable(),
  restated: z.string().nullable(),
  also_new: z.boolean(),
  also_intent: z.string().nullable(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "thread_id",
    "relevance",
    "yes_no",
    "amount_cents",
    "percent",
    "choice",
    "settle_mode",
    "restated",
    "also_new",
    "also_intent",
  ],
  properties: {
    thread_id: { type: ["string", "null"] },
    relevance: { type: "number" },
    yes_no: { type: ["string", "null"] },
    amount_cents: { type: ["integer", "null"] },
    percent: { type: ["number", "null"] },
    choice: { type: ["integer", "null"] },
    settle_mode: { type: ["string", "null"] },
    restated: { type: ["string", "null"] },
    also_new: { type: "boolean" },
    also_intent: { type: ["string", "null"] },
  },
};

const SYSTEM = `You match one new chat message to the questions Tab is waiting on, and read the answer out of it, for Tab, a bot that splits shared expenses.
${UNTRUSTED_RULE}

<open_questions> lists what Tab asked, newest first, each with an id, what kind of answer it expects, and who may answer it. Pick the one question the message answers, if any.
- thread_id: the id of the question the message answers, or null if it answers none of them (the sender logs a new purchase of their own, asks something else, or is just chatting).
- relevance: 0 to 1, how sure you are that the message answers that question. Below 0.5 means it probably doesn't.
- yes_no: "yes" if the message agrees or accepts ("yeah lock it in", "go for it"), "no" if it declines ("nah leave it"), else null.
- amount_cents: the dollar amount the message gives as the answer, in cents, or null. Only an amount written in the message; never compute one.
- percent: a percentage the message gives as the answer (a tip of "20%"), or null.
- choice: for a question with numbered choices, the number the message picks, or null.
- settle_mode: for the question about how to settle, "ledger" if the group wants a running tab settled later (no trip, the long run, monthly), "per_expense" if they want to settle after every expense, else null.
- restated: the answer as one short self-contained sentence in the third person, naming people from <members> instead of "I", "me" or "my" (the sender is named in <message from>). Only what the message says. null if it answers nothing.
- also_new: true only if the message ALSO says something money-related that is not part of the answer, such as a separate new purchase ("yep, and I also got gas $30").
- also_intent: what that other part is, one of ${ALSO_INTENTS.map((i) => `"${i}"`).join(", ")}, or null.`;

// Enum fields are plain strings in the schema; anything else reads as null.
const oneOf = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined;

// Grok's answer, checked field by field before anything uses it (P6).
export async function resolveAnswer(
  client: ChatClient,
  model: string,
  input: ExtractInput,
  threads: OpenThread[],
): Promise<AnswerResolution> {
  // Short ids, newest first, so the model never has to copy an outbox id.
  const list = threads
    .map(
      (t, i) =>
        `- id: q${i + 1}; asked: ${JSON.stringify(t.question)}; expects: ${t.expects}${t.choices ? ` (1 to ${t.choices})` : ""}; who may answer: ${t.who}`,
    )
    .join("\n");
  const r = await structuredCall({
    client,
    model,
    system: SYSTEM,
    user: `${renderExtractInput(input)}\n<open_questions newest_first="true">\n${list}\n</open_questions>`,
    name: "answer_resolution",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });

  const text = input.message.text ?? "";
  const yes_no = oneOf(r.yes_no, ["yes", "no"] as const);
  const settle_mode = oneOf(r.settle_mode, ["ledger", "per_expense"] as const);
  const also_intent = r.also_new ? oneOf(r.also_intent, ALSO_INTENTS) : undefined;
  const also = { also_new: r.also_new, ...(also_intent ? { also_intent } : {}) };
  // The id must be one of the questions offered.
  const index = r.thread_id?.match(/^q(\d+)$/)?.[1];
  const thread = index ? threads[Number(index) - 1] : undefined;
  if (!thread) return { relevance: 0, ...also };

  // Every number must be readable from the message itself (§9.1).
  const amount = r.amount_cents !== null && r.amount_cents > 0 && isGrounded(r.amount_cents, text) ? r.amount_cents : undefined;
  const percent =
    r.percent !== null && r.percent > 0 && r.percent <= 100 && isGrounded(Math.round(r.percent * 100), text) ? r.percent : undefined;
  const choice = r.choice !== null && thread.choices && r.choice >= 1 && r.choice <= thread.choices ? r.choice : undefined;
  const restated = r.restated?.trim().slice(0, 300);
  const numbers = [...(restated ?? "").matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g)];
  const restatedOk = restated && numbers.every((n) => isGrounded(Math.round(Number(n[0].replace(/,/g, "")) * 100), text));

  return {
    thread_id: thread.id,
    relevance: Number.isFinite(r.relevance) ? Math.min(1, Math.max(0, r.relevance)) : 0,
    ...(yes_no ? { yes_no } : {}),
    ...(amount !== undefined ? { amount_cents: amount } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(choice !== undefined ? { choice } : {}),
    ...(settle_mode ? { settle_mode } : {}),
    ...(restatedOk ? { restated } : {}),
    ...also,
  };
}
