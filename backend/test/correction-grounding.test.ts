// #44's corrections and grounding, reworked on main with Joe's guards from
// his review: corrections that aren't replies, never at the cost of a new
// expense, and fixed names/items taken only from the message itself.
import { describe, expect, it } from "vitest";
import { itemSaid, nameSaid } from "../src/extraction/expense.js";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { world } from "./support/harness.js";

const raw = (cents: number | null, description: string | null, extra: object = {}) => ({
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
  ...extra,
});
const fix = (cents: number) => ({ target_expense_id: null, new_amount_cents: cents, new_description: null, unclear: false });

describe("corrections that name the expense (#44 #1, with Joe's guards)", () => {
  const UBER = "got an uber for everyone, $24";
  const FIX = "actually the uber was $30 not $24";
  const script = { expense: { [`new|${UBER}`]: raw(2400, "Uber") }, correction: { [FIX]: fix(3000) } };

  it("corrects the open expense without a reply, instead of offering a second one", async () => {
    const w = world(script);
    const uber = await w.say("Joe", UBER);
    await w.say("Joe", FIX);
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
  });

  it("corrects it when the gate is sure it's an expense", async () => {
    const w = world(script);
    const uber = await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.95 });
    await w.say("Joe", FIX);
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
  });

  it('asks "change uber to $30?" when the gate is unsure, and applies it only on yes', async () => {
    const w = world(script);
    const uber = await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.6 });
    await w.say("Joe", FIX);
    expect(w.said("clarifying_question").at(-1)?.toLowerCase()).toBe("change uber to $30.00?");
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(2400);
    w.ctx.classify = async () => ({ intent: "answer", confidence: 0.9 });
    await w.say("Joe", "yes");
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
  });

  // Joe's H3 reproductions: these are new expenses, not corrections.
  it.each([
    ["actually I paid for gas, $30", "got drinks for the team, $60", "Drinks for the team", 6000, "Gas"],
    ["actually got another uber home, $30", UBER, "Uber", 2400, "Uber home"],
    ["got the uber again, it was $30", UBER, "Uber", 2400, "Uber"],
  ])("leaves a new purchase as a new expense (case %#)", async (text, first, description, cents, newDescription) => {
    const w = world({
      expense: { [`new|${first}`]: raw(cents, description), [`new|${text}`]: raw(3000, newDescription) },
      correction: { [text]: fix(3000) },
    });
    const open = await w.say("Joe", first);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.95 });
    await w.say("Joe", text);
    expect(w.db.expense(`exp_${open.message_id}`)!.total_cents).toBe(cents);
    expect(w.db.expenses()).toHaveLength(2);
  });

  // Merge review: with no "another", a new purchase can still read like
  // "<expense> was $N". A confident gate's new expense wins unless the
  // message clearly corrects ("not $24", "meant", "actually" with no purchase).
  it.each([
    ["uber was $18, i got it", "Uber back"],
    ["the uber back was $18", "Uber back"],
  ])("a confident new expense that only sounds like a correction stays new (case %#)", async (text, newDescription) => {
    const w = world({ expense: { [`new|${UBER}`]: raw(2400, "Uber"), [`new|${text}`]: raw(1800, newDescription) }, correction: { [text]: fix(1800) } });
    const uber = await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.95 });
    await w.say("Joe", text);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(2400);
    expect(w.db.expenses()).toHaveLength(2);
  });

  it("corrects on a confident gate when it clearly reads as one", async () => {
    const text = "actually the uber was 30";
    const w = world({ expense: { [`new|${UBER}`]: raw(2400, "Uber") }, correction: { [text]: fix(3000) } });
    const uber = await w.say("Joe", UBER);
    w.ctx.classify = async () => ({ intent: "expense", confidence: 0.95 });
    await w.say("Joe", text);
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(3000);
  });

  it("with the stub gate, a correction-shaped message that isn't clearly one is asked about, never applied", async () => {
    const text = "uber was $18, i got it";
    const w = world({ expense: { [`new|${UBER}`]: raw(2400, "Uber") }, correction: { [text]: fix(1800) } });
    const uber = await w.say("Joe", UBER);
    await w.say("Joe", text);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(2400);
    expect(w.said("clarifying_question").at(-1)?.toLowerCase()).toBe("change uber to $18.00?");
  });
});

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

describe("fixed names and items come from the message (#44 #3)", () => {
  it("drops an item from an earlier message instead of asking what it cost", async () => {
    // Priya's "1 and 4" was about the last receipt; Kian said nothing specific.
    const w = world({
      receipt: { meijer: MEIJER },
      expense: { "adjustment|thats not even": raw(null, null, { payer: "unknown", fixed: [{ name: "Priya", amount_cents: null, item: "1 and 4" }] }) },
    });
    await w.photo("Joe", "meijer");
    await w.say("Kian", "thats not even");
    expect(w.said("clarifying_question")).toEqual([]);
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
  });

  it("matches whole words only, so Al isn't in 'all good' (Joe's review)", () => {
    expect(nameSaid("Al", "all good")).toBe(false);
    expect(nameSaid("Al", "al had the fries")).toBe(true);
    expect(nameSaid("Jo", "joe paid")).toBe(false);
    // The sender counts only when the message speaks for them.
    expect(nameSaid("me", "i had half")).toBe(true);
    expect(nameSaid("me", "half of the cost")).toBe(false);
    expect(nameSaid("Priya", "priyas fatass had half")).toBe(true);
    expect(itemSaid("both drinks", "alex had both drinks")).toBe(true);
    expect(itemSaid("2 soft drinks", "i only had a soft drink")).toBe(true);
    expect(itemSaid("1 and 4", "thats not even")).toBe(false);
  });
});
