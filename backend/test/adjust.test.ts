import { describe, expect, it } from "vitest";
import { stubClassifier } from "@tab/gate";
import { PEOPLE, world } from "./support/harness.js";

// Harjyot's live test, round 2 on #14: an unsure adjustment got silence.
const raw = {
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: null,
  payer: "unknown",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
};

function unsureAdjustments(w: ReturnType<typeof world>) {
  // The gate's live result: split_adjustment at 0.64, the clarify band.
  w.ctx.classify = async (input) =>
    input.message.text?.includes("owes") || input.message.text?.includes("coke")
      ? { intent: "split_adjustment", confidence: 0.64 }
      : stubClassifier(input);
}

const script = {
  expense: {
    "new|got pizza, $48": {
      ...raw,
      payer: "sender",
      amount_cents: 4800,
      description: "Pizza",
    },
    "adjustment|yeah dhabush actually owes 10,000": {
      ...raw,
      fixed: [{ name: "dhabush", amount_cents: 1000000, item: null }],
    },
    "adjustment|jake actually owes 10,000": {
      ...raw,
      fixed: [{ name: "jake", amount_cents: 1000000, item: null }],
    },
    "adjustment|jake only had a $3 coke": {
      ...raw,
      fixed: [{ name: "jake", amount_cents: 300, item: "coke" }],
    },
  },
};

describe("unsure adjustments (SPEC 6.4 clarify band)", () => {
  it("asks who an unknown name is instead of staying silent (§9.1)", async () => {
    const w = world(script);
    unsureAdjustments(w);
    await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "yeah dhabush actually owes 10,000");
    expect(w.said("clarifying_question")).toEqual([
      "Who's dhabush? I only know people in this chat.",
    ]);
  });

  it("explains when a pinned amount is more than the total", async () => {
    const w = world(script);
    unsureAdjustments(w);
    await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "jake actually owes 10,000");
    expect(w.said("clarifying_question")).toEqual([
      "That's more than the $48.00 total. What did Jake actually have?",
    ]);
  });

  it("confirms a plausible adjustment, then applies it on yes", async () => {
    const w = world(script);
    unsureAdjustments(w);
    const pizza = await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "jake only had a $3 coke");
    expect(w.said("clarifying_question")).toEqual([
      "Change the split on Pizza?",
    ]);
    expect(
      w.db
        .shares(`exp_${pizza.message_id}`)
        .find((s) => s.phone === PEOPLE.Jake)!.amount_cents,
    ).toBe(1200);
    await w.say("Kian", "yes");
    expect(
      w.db
        .shares(`exp_${pizza.message_id}`)
        .find((s) => s.phone === PEOPLE.Jake)!.amount_cents,
    ).toBe(300);
  });
});
