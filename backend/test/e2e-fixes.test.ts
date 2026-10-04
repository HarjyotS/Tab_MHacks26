// Fixes for what the playground end-to-end run found: corrections that
// weren't replies, "not even" on a receipt, context leaking into a new
// expense, and disputes that covered several expenses.
import { describe, expect, it, vi } from "vitest";
import { readDisputeAnswer } from "../src/brain/process.js";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { GROUP, PEOPLE, world } from "./support/harness.js";

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
const adjustment = (fixed: object[]) => ({ ...raw(0, ""), amount_cents: null, description: null, payer: "unknown", fixed });
const fix = (cents: number) => ({ target_expense_id: null, new_amount_cents: cents, new_description: null, unclear: false });

const MEIJER: ReceiptRead = {
  receipt: {
    is_receipt: true,
    merchant: "Meijer",
    items: [
      { description: "Milk", quantity: 1, amount_cents: 450 },
      { description: "Eggs", quantity: 1, amount_cents: 380 },
      { description: "Bread", quantity: 1, amount_cents: 320 },
      { description: "Chips", quantity: 1, amount_cents: 550 },
    ],
    subtotal_cents: 1700,
    total_cents: 1700,
  },
  tip_line_blank: false,
  math_problem: null,
  currency: "USD",
};

describe("a correction that names the expense, not sent as a reply (§7.7)", () => {
  const UBER = "got an uber, $24";
  const FIX = "actually the uber was $30 not $24";
  const script = { expense: { [`new|${UBER}`]: raw(2400, "Uber") }, correction: { [FIX]: fix(3000) } };

  it("corrects the open expense instead of asking to split a second one", async () => {
    const w = world(script);
    const uber = await w.say("Joe", UBER);
    await w.say("Joe", FIX);
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
    expect(w.said("clarifying_question")).toEqual([]);
  });

  it.each([0.95, 0.6])("still corrects it when the gate calls it an expense (confidence %s)", async (confidence) => {
    const w = world(script);
    const uber = await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence });
    await w.say("Joe", FIX);
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
  });

  it("leaves a new expense alone when it names no open one", async () => {
    const GAS = "actually I got gas too, $30";
    const w = world({ ...script, expense: { ...script.expense, [`new|${GAS}`]: raw(3000, "Gas") } });
    await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.95 });
    await w.say("Joe", GAS);
    expect(w.db.expenses().map((e) => e.description).sort()).toEqual(["Gas", "Uber"]);
  });
});

describe('"not even" on a receipt (§7.5)', () => {
  it("itemizes even when Grok restates Tab's proposal as fixed amounts", async () => {
    // Grok copied "$4.25 each" from Tab's proposal; none of it is in the message.
    const w = world({
      receipt: { meijer: MEIJER },
      expense: { "adjustment|thats not even": adjustment([{ name: "Joe", amount_cents: 425, item: null }, { name: "Kian", amount_cents: 425, item: null }]) },
    });
    await w.photo("Joe", "meijer");
    await w.say("Kian", "thats not even");
    const e = w.db.expenses()[0]!;
    expect(e).toMatchObject({ status: "itemizing", split_mode: "itemized" });
    expect(w.said("item_list")).toHaveLength(1);
  });

  it("ignores an item from an earlier message instead of asking what it cost", async () => {
    // Priya's "1 and 4" was about the last receipt; Kian said nothing specific.
    const w = world({
      receipt: { meijer: MEIJER },
      expense: { "adjustment|thats not even": adjustment([{ name: "Priya", amount_cents: null, item: "1 and 4" }]) },
    });
    await w.photo("Joe", "meijer");
    await w.say("Kian", "thats not even");
    expect(w.said("clarifying_question")).toEqual([]);
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
  });

  it("takes item numbers as the sender's claim and starts itemizing", async () => {
    const TEXT = "not even, lets split by item. I had 1 and 4";
    const w = world({
      receipt: { meijer: MEIJER },
      expense: { [`adjustment|${TEXT}`]: adjustment([{ name: "me", amount_cents: null, item: "1 and 4" }]) },
    });
    await w.photo("Joe", "meijer");
    await w.say("Priya", TEXT);
    const e = w.db.expenses()[0]!;
    expect(e.status).toBe("itemizing");
    expect(w.said("item_list")).toHaveLength(1);
    expect(w.said("clarifying_question")).toEqual([]);
    const claimed = w.db
      .claims(e.expense_id)
      .map((c) => w.db.lineItems(e.expense_id).find((i) => i.item_id === c.item_id)!.position);
    expect(claimed.sort()).toEqual([1, 4]);
    expect(w.db.shares(e.expense_id).find((s) => s.phone === PEOPLE.Priya)).toMatchObject({ status: "locked", responded: true });
  });
});

describe("disputes covering several expenses (§7.6)", () => {
  const script = { expense: { "new|got pizza, $40": raw(4000, "Pizza"), "new|got groceries, $60": raw(6000, "Groceries") } };

  // Pizza (Joe, $10 each) and groceries (Priya, $15 each) in one request; Kian 👎.
  async function disputed() {
    const w = world(script);
    const p = await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    const g = await w.say("Priya", "got groceries, $60");
    await w.wait(31_000);
    const settle = await w.say("Jake", "let's settle up");
    await w.react("Kian", `settle_request:${GROUP}:${settle.message_id}`, "dislike");
    const share = (id: string) => w.db.shares(id).find((s) => s.phone === PEOPLE.Kian)!;
    return { w, pizza: `exp_${p.message_id}`, groceries: `exp_${g.message_id}`, share };
  }

  it('resolves "$8 for pizza, groceries is fine" without asking which one', async () => {
    const { w, pizza, groceries, share } = await disputed();
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");
    await w.dm("Kian", "I only had one slice of pizza, so $8. Groceries is fine");
    expect(resolve).toHaveBeenCalledWith({ expense_id: pizza, phone: PEOPLE.Kian, amount_cents: 800 });
    expect(resolve).toHaveBeenCalledWith({ expense_id: groceries, phone: PEOPLE.Kian, amount_cents: 1500 });
    expect(share(pizza)).toMatchObject({ status: "locked", amount_cents: 800 });
    expect(share(groceries)).toMatchObject({ status: "locked", amount_cents: 1500 });
    expect(w.db.outbox().some((o) => o.text?.startsWith("Which one?"))).toBe(false);
  });

  it("asks about the one still disputed, and takes \"fine\"", async () => {
    const { w, pizza, groceries, share } = await disputed();
    await w.dm("Kian", "$8 for pizza");
    expect(share(pizza)).toMatchObject({ status: "locked", amount_cents: 800 });
    expect(w.said("clarifying_question").at(-1)).toBe('And Groceries ($15.00): is that right? Reply "fine", or tell me what you had.');
    await w.dm("Kian", "fine");
    expect(share(groceries)).toMatchObject({ status: "locked", amount_cents: 1500 });
  });

  it("takes the answer in the group, though Tab asked by DM", async () => {
    const { w, pizza, groceries, share } = await disputed();
    await w.say("Kian", "I only had one slice of pizza, I owe Joe $8 for the pizza");
    expect(share(pizza)).toMatchObject({ status: "locked", amount_cents: 800 });
    expect(share(groceries).status).toBe("disputed");
  });

  it("takes it in the group even while another question is open there", async () => {
    const { w, pizza, groceries, share } = await disputed();
    // The onboarding "Reply \"each\"" question was never answered (playground run).
    const source = w.db.messages().find((m) => m.group_id === GROUP)!;
    w.ctx.memory.pending.set(GROUP, { kind: "settle_mode", source, asked_at: w.ctx.now() });
    await w.say("Kian", "the groceries are fine");
    expect(share(groceries)).toMatchObject({ status: "locked", amount_cents: 1500 });
    expect(share(pizza).status).toBe("disputed");
  });

  it.each([
    ["$8 for pizza, groceries is fine", { Pizza: 800, Groceries: 1500 }],
    ["pizza was $8 and the rest is fine", { Pizza: 800, Groceries: 1500 }],
    ["all good", { Pizza: 1000, Groceries: 1500 }],
    ["pizza was good but I only had one slice", {}],
    ["I had $5", {}], // no name: "Which one?" handles it
  ])("reads %j", async (text, want) => {
    const { w, pizza, groceries } = await disputed();
    const open = [w.db.expense(pizza)!, w.db.expense(groceries)!];
    const got = readDisputeAnswer(w.ctx, PEOPLE.Kian, text, open);
    expect(Object.fromEntries([...got].map(([e, cents]) => [e.description, cents]))).toEqual(want);
  });

  it("reminds once, then keeps the share as it was so it can be settled", async () => {
    const { w, pizza, groceries, share } = await disputed();
    await w.wait(121_000); // demo: 12h → 120s
    expect(w.said("dispute_followup").at(-1)).toBe(
      "Still sorting out Pizza ($10.00), Groceries ($15.00). Tell me what you actually had, or I'll keep it as it is.",
    );
    expect(share(pizza).status).toBe("disputed");
    await w.wait(121_000);
    expect(share(pizza)).toMatchObject({ status: "locked", amount_cents: 1000 });
    expect(share(groceries)).toMatchObject({ status: "locked", amount_cents: 1500 });
  });
});
