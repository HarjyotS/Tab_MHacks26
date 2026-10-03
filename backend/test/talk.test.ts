import { describe, expect, it } from "vitest";
import { world } from "./support/harness.js";

const raw = {
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: null,
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
};

describe("what do i owe", () => {
  it("answers with just the amount, and explains only when asked why", async () => {
    const w = world({
      expense: {
        "new|got pizza for everyone, $48": {
          ...raw,
          amount_cents: 4800,
          description: "Pizza",
        },
        "adjustment|not even, jake only had a $3 diet coke": {
          ...raw,
          payer: "unknown",
          fixed: [{ name: "jake", amount_cents: 300, item: "diet coke" }],
        },
      },
    });
    await w.say("Joe", "got pizza for everyone, $48");
    await w.say("Kian", "not even, jake only had a $3 diet coke");
    await w.wait(41_000);
    await w.say("Priya", "what do i owe");
    expect(w.said("balance_reply")).toEqual(["you owe joe $15.00"]);
    await w.say("Priya", "why");
    expect(w.said("breakdown_reply")).toEqual([
      "pizza $15.00: split 3 ways after jake's $3.00",
    ]);
  });

  it("ignores a why that isn't about a balance", async () => {
    const w = world({});
    await w.say("Priya", "why");
    expect(w.said("breakdown_reply")).toEqual([]);
  });
});
