import { z } from "zod";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import { LARGE_AMOUNT_CENTS } from "../config.js";
import { isGrounded } from "./grounding.js";
import { resolveName } from "./names.js";
import { renderExtractInput, TAB, UNTRUSTED_RULE } from "./prompt.js";
import type {
  ExpenseExtraction,
  Extracted,
  ExtractInput,
  Problem,
} from "./types.js";


// Only multiply when the message itself says the amount is per person.
const PER_PERSON = /\b(each|apiece|per person|per head|a head|a person)\b/i;

// What Grok returns: names exactly as written and amounts exactly as stated.
// Code resolves names to members and does all arithmetic (P6), then
// `toContract` produces the §9.2 ExpenseExtraction.
const raw = z.object({
  is_expense: z.boolean(),
  amount_cents: z.number().int().nullable(),
  amount_is_per_person: z.boolean(),
  description: z.string().nullable(),
  payer: z.enum(["sender", "named", "unknown"]),
  payer_name: z.string().nullable(),
  participants: z.enum(["everyone", "list"]),
  participant_names: z.array(z.string()),
  exclusion_names: z.array(z.string()),
  fixed: z.array(
    z.object({
      name: z.string(),
      amount_cents: z.number().int().nullable(),
      item: z.string().nullable(),
      // "only had" / "just had" (their whole share) vs "had" (it's theirs,
      // and they still share the rest). Missing reads as only, as before.
      only: z.boolean().optional(),
    }),
  ),
});
type Raw = z.infer<typeof raw>;

const nullable = (type: string) => ({ type: [type, "null"] });
const names = { type: "array", items: { type: "string" } };
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_expense",
    "amount_cents",
    "amount_is_per_person",
    "description",
    "payer",
    "payer_name",
    "participants",
    "participant_names",
    "exclusion_names",
    "fixed",
  ],
  properties: {
    is_expense: { type: "boolean" },
    amount_cents: nullable("integer"),
    amount_is_per_person: { type: "boolean" },
    description: nullable("string"),
    payer: { type: "string", enum: ["sender", "named", "unknown"] },
    payer_name: nullable("string"),
    participants: { type: "string", enum: ["everyone", "list"] },
    participant_names: names,
    exclusion_names: names,
    fixed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount_cents", "item", "only"],
        properties: {
          name: { type: "string" },
          amount_cents: nullable("integer"),
          item: nullable("string"),
          only: { type: "boolean" },
        },
      },
    },
  },
};

export type ExpenseMode = "new" | "adjustment";

function systemPrompt(mode: ExpenseMode): string {
  const task =
    mode === "new"
      ? `The message reports a purchase or bill to split. Extract it.
- is_expense: true when the message describes something bought or a bill, including requests to be paid back for one even when no amount is given. False only when no purchase is described at all (for example "X owes me $20" with nothing bought).
- amount_cents: the amount in cents exactly as stated (spoken numbers count: "forty bucks" is 4000; "4 x 25" is 10000). null if no amount is stated. Never add tax or tip.
- amount_is_per_person: true only if the message says the amount is per person ("15 each"); code will multiply it.
- description: two or three words for what was bought, like "Groceries" or "Uber to airport".
- payer: "sender" if the sender says they paid, covered, or got it, or asks to be paid back; "named" with payer_name if the message names who paid; "unknown" if the message only states what something cost without saying who paid ("dinner was 60").
- participants: "everyone" unless the message names who shared it; then "list" with participant_names.
- exclusion_names: people the message says were not there.`
      : `The message adjusts the split of the sender's open expense. Do not extract a new total: amount_cents is null, amount_is_per_person is false, payer is "unknown".
- exclusion_names: people the message says were not there or should be left out. "Just Sam and Alex" or "only Sam and Alex went" leaves out every other member. Never list someone the message says was there or had something.
- fixed: people the message says had specific things, with the item and its price in cents if stated (null if not).
  - only: true if the message says that was all they had ("Jake only had a Diet Coke", "I just had the salad"); false if it only says they had or got it ("Alex had both drinks", "I got the cheesecake"), so it's theirs and they may still share the rest.
  - A share of the whole thing ("Priya had half", "a third of it", "75%"): the fraction in the message's words as the item ("half of the pizza"), price null; code works out the amount. People who split "the rest" or "the other half": each one with that as the item.`;
  return `You extract structured data for Tab, a bot that splits shared expenses in a group chat.
${UNTRUSTED_RULE}

${task}

Names: write every person's name exactly as the message says it. Use "me" for the sender. Never translate a name into a different member.`;
}

function toContract(
  r: Raw,
  input: ExtractInput,
  mode: ExpenseMode,
): Extracted<ExpenseExtraction> {
  const problems: Problem[] = [];
  const { members, message } = input;
  const text = message.text ?? "";
  const ground = (cents: number) => isGrounded(cents, text);
  const resolve = (name: string): string | null => {
    const phone = resolveName(name, members, message.sender_phone);
    if (!phone) problems.push({ kind: "unknown_name", name });
    return phone;
  };
  const resolveAll = (ns: string[]) => [
    ...new Set(ns.map(resolve).filter((p): p is string => p !== null)),
  ];

  let payer: ExpenseExtraction["payer"] = { kind: "unknown" };
  if (mode === "new" && r.payer === "sender") payer = { kind: "sender" };
  if (mode === "new" && r.payer === "named" && r.payer_name) {
    const phone = resolve(r.payer_name);
    if (phone)
      payer =
        phone === message.sender_phone
          ? { kind: "sender" }
          : { kind: "member", phone };
  }

  const participants: ExpenseExtraction["participants"] =
    r.participants === "list" && r.participant_names.length > 0
      ? { kind: "list", phones: resolveAll(r.participant_names) }
      : { kind: "everyone" };
  const exclusions = resolveAll(r.exclusion_names);

  let amount = r.amount_cents ?? undefined;
  if (amount !== undefined) {
    if (!ground(amount)) {
      problems.push({ kind: "ungrounded_amount", amount_cents: amount });
      amount = undefined;
    } else if (amount <= 0) {
      problems.push({ kind: "invalid_amount", amount_cents: amount });
      amount = undefined;
    } else if (r.amount_is_per_person && PER_PERSON.test(text)) {
      const headcount =
        participants.kind === "list"
          ? participants.phones.length
          : members.filter((m) => m.phone !== TAB && !exclusions.includes(m.phone)).length;
      amount *= headcount;
    }
  }
  if (amount !== undefined && amount > LARGE_AMOUNT_CENTS) {
    problems.push({ kind: "large_amount", amount_cents: amount });
  }

  const fixed: ExpenseExtraction["fixed"] = [];
  for (const f of r.fixed) {
    const phone = resolve(f.name);
    if (!phone) continue;
    let cents = f.amount_cents ?? undefined;
    if (cents !== undefined && !ground(cents)) {
      problems.push({ kind: "ungrounded_amount", amount_cents: cents });
      cents = undefined;
    }
    fixed.push({
      phone,
      ...(cents !== undefined ? { amount_cents: cents } : {}),
      ...(f.item ? { item: f.item } : {}),
      // Owning an item needs an item to own.
      ...(f.only === false && f.item ? { had: true as const } : {}),
    });
    if (cents === undefined && f.item)
      problems.push({ kind: "missing_item_price", phone, item: f.item });
  }

  // Someone who had something was there (live: "jake only had a $3 diet
  // coke" also came back with Jake excluded).
  const had = new Set(fixed.map((f) => f.phone));
  const there = exclusions.filter((p) => !had.has(p));
  exclusions.length = 0;
  exclusions.push(...there);

  // Missing fields are derived here, never trusted from the model.
  const missing: ExpenseExtraction["missing"] = [];
  if (mode === "new" && r.is_expense) {
    if (amount === undefined) {
      missing.push("amount");
      if (
        !problems.some(
          (p) => p.kind === "ungrounded_amount" || p.kind === "invalid_amount",
        )
      ) {
        problems.push({ kind: "missing_amount" });
      }
    }
    if (payer.kind === "unknown") {
      missing.push("payer");
      if (!problems.some((p) => p.kind === "unknown_name"))
        problems.push({ kind: "missing_payer" });
    }
  }
  if (fixed.some((f) => f.amount_cents === undefined))
    missing.push("item_price");

  return {
    result: {
      is_expense: r.is_expense,
      ...(amount !== undefined ? { amount_cents: amount } : {}),
      ...(r.description ? { description: r.description } : {}),
      payer,
      participants,
      exclusions,
      fixed,
      missing,
    },
    problems,
  };
}

export async function extractExpense(
  client: ChatClient,
  model: string,
  input: ExtractInput,
  mode: ExpenseMode = "new",
): Promise<Extracted<ExpenseExtraction>> {
  const r = await structuredCall({
    client,
    model,
    system: systemPrompt(mode),
    user: renderExtractInput(input),
    name: "expense_extraction",
    schema: JSON_SCHEMA,
    safeParse: (v) => raw.safeParse(v),
  });
  return toContract(r, input, mode);
}
