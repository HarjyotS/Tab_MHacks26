import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import { resolveName } from "./names.js";
import { renderExtractInput, UNTRUSTED_RULE } from "./prompt.js";
import type {
  ClaimResolution,
  Extracted,
  ExtractInput,
  LineItem,
} from "./types.js";

const KINDS = [
  "items",
  "even",
  "same_as",
  "everyone_shares",
  "unclear",
] as const;

const raw = z.object({
  kind: z.enum(KINDS),
  item_positions: z.array(z.number().int()),
  same_as_name: z.string().nullable(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "item_positions", "same_as_name"],
  properties: {
    kind: { type: "string", enum: [...KINDS] },
    item_positions: { type: "array", items: { type: "integer" } },
    same_as_name: { type: ["string", "null"] },
  },
};

const SYSTEM = `You resolve what a person had from a numbered receipt list, for Tab, a bot that splits shared expenses.
${UNTRUSTED_RULE}

kind:
- "items": the sender names items they had, by number or by name. item_positions are the 1-based numbers from <item_list>.
- "even": the sender wants an even share of whatever is unclaimed. item_positions is empty.
- "same_as": the sender had the same as another person. same_as_name is that person's name exactly as the message says it.
- "everyone_shares": the sender says the whole group shared some items. item_positions are those items.
- "unclear": none of the above, or an item the list doesn't contain.`;

export async function resolveClaim(
  client: ChatClient,
  model: string,
  input: ExtractInput,
  items: LineItem[],
): Promise<Extracted<ClaimResolution>> {
  const list = items
    .map(
      (i) =>
        `${i.position}. ${i.description} $${(i.amount_cents / 100).toFixed(2)}`,
    )
    .join("\n");
  const r = await structuredCall({
    client,
    model,
    system: SYSTEM,
    user: `${renderExtractInput(input)}\n<item_list>\n${list}\n</item_list>`,
    name: "claim_resolution",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });

  // Positions must exist on the list, and "same as" must name a member;
  // otherwise Tab asks instead of guessing.
  const valid = new Set(items.map((i) => i.position));
  const positions = [...new Set(r.item_positions)].sort((a, b) => a - b);
  const unclear: Extracted<ClaimResolution> = {
    result: { kind: "unclear", item_positions: [] },
    problems: [],
  };

  if (
    (r.kind === "items" || r.kind === "everyone_shares") &&
    (positions.length === 0 || positions.some((p) => !valid.has(p)))
  ) {
    return unclear;
  }
  if (r.kind === "same_as") {
    const phone = r.same_as_name ? resolveName(r.same_as_name, input.members, input.message.sender_phone) : null;
    if (
      !phone ||
      phone === input.message.sender_phone ||
      !input.members.some((m) => m.phone === phone)
    )
      return unclear;
    return {
      result: { kind: "same_as", item_positions: [], same_as_phone: phone },
      problems: [],
    };
  }
  if (r.kind === "even" || r.kind === "unclear") {
    return { result: { kind: r.kind, item_positions: [] }, problems: [] };
  }
  return { result: { kind: r.kind, item_positions: positions }, problems: [] };
}
