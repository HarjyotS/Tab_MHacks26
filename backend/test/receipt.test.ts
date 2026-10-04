import { describe, expect, it } from "vitest";
import {
  checkReceiptMath,
  type ReceiptRead,
} from "../src/extraction/receipt.js";
import { PEOPLE, world, type Script } from "./support/harness.js";

const read = (
  r: Partial<ReceiptRead["receipt"]>,
  extra: Partial<Omit<ReceiptRead, "receipt">> = {},
): ReceiptRead => ({
  receipt: { is_receipt: true, items: [], ...r },
  tip_line_blank: false,
  math_problem: null,
  currency: "USD",
  ...extra,
});

// A lopsided dinner: the ribeye is more than 1.5x an even share (§7.4 step 6).
const FRITA = read({
  merchant: "Frita Batidos",
  items: [
    { description: "Ribeye", quantity: 1, amount_cents: 4500 },
    { description: "Chorizo burger", quantity: 1, amount_cents: 1500 },
    { description: "Fries", quantity: 1, amount_cents: 800 },
    { description: "Batido", quantity: 2, amount_cents: 1200 },
  ],
  subtotal_cents: 8000,
  tax_cents: 600,
  tip_cents: 1600,
  total_cents: 10200,
});

const MEIJER = read({
  merchant: "Meijer",
  items: [
    { description: "Milk", quantity: 1, amount_cents: 450 },
    { description: "Eggs", quantity: 1, amount_cents: 380 },
    { description: "Bread", quantity: 1, amount_cents: 320 },
    { description: "Chips", quantity: 1, amount_cents: 550 },
  ],
  subtotal_cents: 1700,
  total_cents: 1700,
});

const claims: Script["claim"] = {
  "1": { kind: "items", item_positions: [1], same_as_name: null },
  "2": { kind: "items", item_positions: [2], same_as_name: null },
  "we all split the fries": {
    kind: "everyone_shares",
    item_positions: [3],
    same_as_name: null,
  },
  even: { kind: "even", item_positions: [], same_as_name: null },
};

describe("checkReceiptMath (SPEC 7.4 step 3)", () => {
  it("accepts a receipt that adds up", () => {
    expect(checkReceiptMath(FRITA.receipt)).toBeNull();
  });

  it("allows 1 cent per item and 2 cents on the total", () => {
    expect(
      checkReceiptMath({
        ...FRITA.receipt,
        subtotal_cents: 8003,
        total_cents: 10205,
      }),
    ).toBeNull();
    expect(
      checkReceiptMath({ ...FRITA.receipt, total_cents: 10202 }),
    ).toBeNull();
  });

  it("flags items that don't reach the subtotal and a total that doesn't match", () => {
    expect(
      checkReceiptMath({ ...FRITA.receipt, subtotal_cents: 9000 }),
    ).toMatch(/items sum to 8000/);
    expect(checkReceiptMath({ ...FRITA.receipt, total_cents: 11000 })).toMatch(
      /total is 11000/,
    );
  });
});

describe("receipts (SPEC 7.4)", () => {
  it("proposes an even split when no item is lopsided", async () => {
    const w = world({ receipt: { meijer: MEIJER } });
    await w.photo("Joe", "meijer");
    expect(w.said("split_proposal")[0]).toMatch(
      /^Meijer, \$17\.00\. Split 4 ways, that's \$4\.25 each\./,
    );
    expect(w.db.lineItems(w.db.expenses()[0]!.expense_id)).toHaveLength(4);
  });

  it("goes straight to the item list when one item is lopsided", async () => {
    const w = world({ receipt: { frita: FRITA } });
    await w.photo("Joe", "frita");
    expect(w.db.expenses()[0]).toMatchObject({
      status: "itemizing",
      split_mode: "itemized",
      total_cents: 10200,
    });
    expect(w.said("item_list")[0]).toBe(
      'Frita Batidos, $102.00 total\n1. Ribeye $45.00\n2. Chorizo burger $15.00\n3. Fries $8.00\n4. Batido $12.00\nReply with what you had, or "even" for an even share of whatever\'s left.',
    );
  });

  it("asks the payer about a blank tip line, then adds the tip", async () => {
    const blank = read(
      { ...MEIJER.receipt, merchant: "Zingerman's" },
      { tip_line_blank: true },
    );
    const w = world({ receipt: { zing: blank } });
    await w.photo("Joe", "zing");
    expect(w.said("clarifying_question")).toEqual(["What tip did you leave?"]);
    await w.say("Kian", "10"); // not the payer: ignored as an answer
    expect(w.db.expenses()).toHaveLength(0);
    await w.say("Joe", "3");
    expect(w.db.expenses()[0]).toMatchObject({
      total_cents: 2000,
      tip_cents: 300,
      status: "proposed",
    });
  });

  it("asks before trusting a receipt that doesn't add up, then splits the confirmed total evenly", async () => {
    const bad = read(
      { ...FRITA.receipt },
      { math_problem: "items sum to 8000, subtotal is 9000" },
    );
    const w = world({ receipt: { bad } });
    await w.photo("Joe", "bad");
    expect(w.said("clarifying_question")).toEqual([
      "I read the total as $102.00. Is that right?",
    ]);
    await w.say("Joe", "yes");
    expect(w.db.expenses()[0]).toMatchObject({
      status: "proposed",
      split_mode: "even",
      total_cents: 10200,
    });
  });

  it("asks for dollars on a foreign receipt (SPEC 14)", async () => {
    const chf = read({ ...MEIJER.receipt }, { currency: "CHF" });
    const w = world({ receipt: { chf } });
    await w.photo("Joe", "chf");
    expect(w.said("clarifying_question")).toEqual([
      "What was that in dollars?",
    ]);
    await w.say("Joe", "about $60");
    expect(w.db.expenses()[0]).toMatchObject({
      total_cents: 6000,
      split_mode: "even",
    });
  });

  it('switches an even receipt to itemizing when someone says "not even" (SPEC 7.5)', async () => {
    const w = world({
      receipt: { meijer: MEIJER },
      expense: {
        "adjustment|not even": {
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
        },
      },
    });
    await w.photo("Joe", "meijer");
    await w.say("Priya", "not even");
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
    expect(w.said("item_list")).toHaveLength(1);
  });
});

describe("claims and finalizing (SPEC 7.5)", () => {
  it("locks each claim, finalizes when everyone has answered, and splits by what people had", async () => {
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.ctx.db.set_settle_mode({ group_id: "house", settle_mode: "per_expense" });
    await w.photo("Joe", "frita");
    await w.say("Kian", "1");
    await w.say("Priya", "2");
    await w.say("Jake", "we all split the fries");
    const id = w.db.expenses()[0]!.expense_id;
    expect(w.db.expense(id)!.status).toBe("itemizing");
    await w.say("Joe", "even");
    expect(w.db.expense(id)!.status).toBe("finalized");
    // §8: items + shared fries + an even share of the unclaimed batidos, then
    // tax and tip in proportion; the leftover cent goes to Joe by phone order.
    const amounts = Object.fromEntries(
      w.db.shares(id).map((s) => [s.phone, s.amount_cents]),
    );
    expect(amounts).toEqual({
      [PEOPLE.Joe]: 638,
      [PEOPLE.Kian]: 6375,
      [PEOPLE.Priya]: 2550,
      [PEOPLE.Jake]: 637,
    });
    expect(w.said("settle_request")[0]).toContain(
      "Cool, here's what's owed to Joe for Frita Batidos:\nKian $63.75, Priya $25.50, Jake $6.37.",
    );
  });

  it("takes a claim by DM", async () => {
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.photo("Joe", "frita");
    await w.dm("Kian", "2");
    const share = w.db
      .shares(w.db.expenses()[0]!.expense_id)
      .find((s) => s.phone === PEOPLE.Kian)!;
    expect(share).toMatchObject({ status: "locked", responded: true });
    expect(
      w.db.claims(w.db.expenses()[0]!.expense_id).map((c) => c.item_id),
    ).toEqual([`${w.db.expenses()[0]!.expense_id}:2`]);
  });

  it("nudges in the group by name, gives a last call with a dollar amount, then finalizes", async () => {
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.photo("Joe", "frita");
    await w.say("Kian", "1");
    await w.say("Priya", "2");
    await w.say("Joe", "even");
    const nudges = () => w.db.outbox().filter((o) => o.purpose === "claim_followup");

    await w.wait(21_000); // demo: 2h → 20s
    expect(nudges()).toHaveLength(1);
    expect(nudges()[0]).toMatchObject({ kind: "group_message", group_id: "house" });
    expect(nudges()[0]!.text).toMatch(/^Jake, what (did you have|was yours) at Frita Batidos\?/);

    await w.wait(121_000); // +12h → +120s
    expect(nudges()[1]!.text).toBe('Jake, still need yours for Frita Batidos. Numbers, or "even".');

    await w.wait(300_000); // 44h → 440s
    expect(nudges()[2]!.text).toMatch(/^Last call, Jake: in \d+ seconds I'll put you down for \$\d+\.\d{2} for Frita Batidos/);
    expect(w.db.outbox().filter((o) => o.kind === "dm")).toEqual([]); // no DMs at all

    await w.wait(41_000); // 48h → 480s: deadline
    expect(w.db.expenses()[0]!.status).toBe("finalized");
  });
});
