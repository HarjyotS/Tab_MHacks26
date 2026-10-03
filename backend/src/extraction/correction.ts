import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import { isGrounded } from "./grounding.js";
import { renderExtractInput, UNTRUSTED_RULE } from "./prompt.js";
import type {
  CorrectionExtraction,
  Extracted,
  ExtractInput,
  Problem,
} from "./types.js";

const raw = z.object({
  target_expense_id: z.string().nullable(),
  new_amount_cents: z.number().int().nullable(),
  new_description: z.string().nullable(),
  unclear: z.boolean(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "target_expense_id",
    "new_amount_cents",
    "new_description",
    "unclear",
  ],
  properties: {
    target_expense_id: { type: ["string", "null"] },
    new_amount_cents: { type: ["integer", "null"] },
    new_description: { type: ["string", "null"] },
    unclear: { type: "boolean" },
  },
};

const SYSTEM = `You extract a correction to an expense Tab already logged, for Tab, a bot that splits shared expenses.
${UNTRUSTED_RULE}

- target_expense_id: which of the sender's open expenses (listed below) is being corrected; null if you cannot tell.
- new_amount_cents: the corrected total in cents as stated in the message, or null. When a message gives both the old and new amount ("44 not 48"), use the new one.
- new_description: the corrected description if the message changes what was bought, or null.
- unclear: true if the message does not clearly give a new amount or description.`;

export async function extractCorrection(
  client: ChatClient,
  model: string,
  input: ExtractInput,
): Promise<Extracted<CorrectionExtraction>> {
  const ids = input.open_items
    .map((o) => `${o.expense_id}: ${o.description} (${o.expense_status})`)
    .join("\n");
  const r = await structuredCall({
    client,
    model,
    system: SYSTEM,
    user: `${renderExtractInput(input)}\n<open_expense_ids>\n${ids || "(none)"}\n</open_expense_ids>`,
    name: "correction_extraction",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });

  const problems: Problem[] = [];
  let amount = r.new_amount_cents ?? undefined;
  if (amount !== undefined && !isGrounded(amount, input.message.text ?? "")) {
    problems.push({ kind: "ungrounded_amount", amount_cents: amount });
    amount = undefined;
  }
  // With exactly one open expense, that's the target, whatever the model said.
  const only =
    input.open_items.length === 1 ? input.open_items[0]!.expense_id : undefined;
  const target =
    only ??
    (r.target_expense_id &&
    input.open_items.some((o) => o.expense_id === r.target_expense_id)
      ? r.target_expense_id
      : undefined);
  const description = r.new_description ?? undefined;

  return {
    result: {
      ...(target ? { target_expense_id: target } : {}),
      ...(amount !== undefined ? { new_amount_cents: amount } : {}),
      ...(description ? { new_description: description } : {}),
      unclear: r.unclear || (amount === undefined && !description),
    },
    problems,
  };
}
