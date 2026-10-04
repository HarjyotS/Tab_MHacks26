import { describe, expect, it } from "vitest";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { PEOPLE, world } from "./support/harness.js";

// Harjyot's review on #14: an inline reply binds a message to one expense.
const lopsided = (merchant: string): ReceiptRead => ({
  receipt: {
    is_receipt: true,
    merchant,
    items: [
      { description: "Steak", quantity: 1, amount_cents: 4000 },
      { description: "Salad", quantity: 1, amount_cents: 1000 },
    ],
    subtotal_cents: 5000,
    total_cents: 5000,
  },
  tip_line_blank: false,
  math_problem: null,
  currency: "USD",
});

const raw = (cents: number, description: string) => ({
  is_expense: true,
  amount_cents: cents,
  amount_is_per_person: false,
  description,
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
});

describe("inline replies", () => {
  it("binds a claim to the item list it replies to, even when a newer list is open", async () => {
    const w = world({
      receipt: { a: lopsided("Older Diner"), b: lopsided("Newer Grill") },
      claim: {
        "2": { kind: "items", item_positions: [2], same_as_name: null },
      },
    });
    const older = await w.photo("Joe", "a");
    await w.photo("Joe", "b");
    const olderList = w.db.out.get(`item_list:exp_${older.message_id}`)!;
    await w.say("Kian", "2", { reply_to_id: olderList.sent_photon_id });
    const claimed = w.db
      .claims(`exp_${older.message_id}`)
      .filter((c) => c.phone === PEOPLE.Kian);
    expect(claimed.map((c) => c.item_id)).toEqual([
      `exp_${older.message_id}:2`,
    ]);
  });

  it("never pays on a typed yes, even replying to the settle request (P7)", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    await w.ctx.db.set_settle_mode({ group_id: "house", settle_mode: "per_expense" });
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    const settle = w.db.out.get(`settle_request:exp_${pizza.message_id}`)!;
    await w.say("Priya", "yes", { reply_to_id: settle.sent_photon_id });
    expect(w.db.transfers()).toEqual([]);
    expect(w.said("clarifying_question")).toEqual(["just tap 👍 on the settle msg to pay your part"]);
  });

  it("threads Tab's answers to the message they answer, and nothing unprompted (#19)", async () => {
    const w = world({
      expense: {
        "new|got pizza, $40": raw(4000, "Pizza"),
        "new|venmo me for the uber": { ...raw(0, "Uber"), amount_cents: null },
      },
    });
    const pizza = await w.say("Joe", "got pizza, $40");
    const uber = await w.say("Kian", "venmo me for the uber");
    const ask = await w.say("Priya", "what do i owe");
    await w.wait(21_000); // the reminder: unprompted
    const by = (purpose: string) => w.db.outbox().find((o) => o.purpose === purpose)!;
    expect(by("split_proposal").target_message_id).toBe(pizza.message_id);
    expect(by("clarifying_question").target_message_id).toBe(uber.message_id);
    expect(by("balance_reply").target_message_id).toBe(ask.message_id);
    expect(by("objection_reminder").target_message_id).toBeUndefined();
  });
});
