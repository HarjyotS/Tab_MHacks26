import { describe, expect, it } from "vitest";
import {
  checkReceiptMath,
  type ReceiptRead,
} from "../src/extraction/receipt.js";
import { receiptPrice } from "../src/brain/expense.js";
import type { LineItem } from "../src/store/types.js";
import { tick } from "../src/brain/process.js";
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

// Harjyot's playground receipt: even split, a drinks line with a count.
const BISTRO = read({
  merchant: "THE BISTRO",
  items: [
    { description: "BURGER DELUXE", quantity: 1, amount_cents: 1499 },
    { description: "CAESAR SALAD", quantity: 1, amount_cents: 999 },
    { description: "2 x SOFT DRINK @ $2.99", quantity: 1, amount_cents: 598 },
    { description: "CHEESECAKE", quantity: 1, amount_cents: 799 },
  ],
  subtotal_cents: 3895,
  tax_cents: 312,
  tip_cents: 500,
  total_cents: 4707,
});

const adjustment = (
  exclusion_names: string[],
  fixed: { name: string; amount_cents: number | null; item: string | null }[],
) => ({
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: null,
  payer: "unknown",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names,
  fixed,
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
      /^meijer \$17\.00 split 4 ways, so \$4\.25 each\n/,
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
      'frita batidos, $102.00 total\n1. ribeye $45.00\n2. chorizo burger $15.00\n3. fries $8.00\n4. batido $12.00\nreply w what you had (numbers work), or "even" for a share of whatever\'s left',
    );
  });

  it("asks the payer about a blank tip line, then adds the tip", async () => {
    const blank = read(
      { ...MEIJER.receipt, merchant: "Zingerman's" },
      { tip_line_blank: true },
    );
    const w = world({ receipt: { zing: blank } });
    await w.photo("Joe", "zing");
    expect(w.said("clarifying_question")).toEqual(["what'd you tip?"]);
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
      "total looks like $102.00 to me, right?",
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
      "how much was that in dollars?",
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

describe("settling while a receipt is open", () => {
  it("names a receipt still waiting on claims instead of saying everyone's square", async () => {
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.photo("Joe", "frita");
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
    await w.say("Kian", "let's settle up");
    expect(w.said("clarifying_question")).toEqual([
      "still waiting on claims for frita batidos ($102.00)\nsplit what's unclaimed evenly and settle now?",
    ]);
    expect(w.said("balance_reply")).toEqual([]);
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
  });

  it('takes "yeah lock it in" as yes: splits the unclaimed items evenly and asks to settle', async () => {
    // Harjyot's playground: the old "isn't locked in yet" wasn't a question,
    // so "yeah lock it in" went nowhere.
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.photo("Joe", "frita");
    await w.say("Kian", "let's settle up");
    // Only whoever asked to settle answers (Joe's review on #35): a
    // bystander's "ok" doesn't split unclaimed items onto people.
    await w.say("Priya", "ok");
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
    await w.say("Kian", "yeah lock it in");
    expect(w.db.expenses()[0]!.status).toBe("finalized");
    expect(w.said("settle_request")).toHaveLength(1);
    expect(w.db.transfers()).toEqual([]);
  });

  it("leaves the receipt open on no", async () => {
    const w = world({ receipt: { frita: FRITA }, claim: claims });
    await w.photo("Joe", "frita");
    await w.say("Kian", "let's settle up");
    await w.say("Kian", "nah wait");
    expect(w.db.expenses()[0]!.status).toBe("itemizing");
    expect(w.said("settle_request")).toEqual([]);
  });
});

describe("an item named without a price (SPEC 7.5)", () => {
  const SOFT = "kian and jake wasn't there and I only had 2 soft drinks";
  const PIE = "I only had the key lime pie";

  it("takes the price from the receipt instead of asking", async () => {
    const w = world({
      receipt: { bistro: BISTRO },
      expense: {
        [`adjustment|${SOFT}`]: adjustment(["Kian", "Jake"], [{ name: "Priya", amount_cents: null, item: "2 soft drinks" }]),
      },
    });
    await w.photo("Priya", "bistro");
    const id = w.db.expenses()[0]!.expense_id;
    expect(w.db.expense(id)!.status).toBe("proposed");
    await w.say("Priya", SOFT);
    expect(w.said("clarifying_question")).toEqual([]);
    const shares = Object.fromEntries(w.db.shares(id).map((s) => [s.phone, s]));
    expect(shares[PEOPLE.Priya]!.fixed_cents).toBe(598);
    expect(shares[PEOPLE.Kian]!.status).toBe("opted_out");
    expect(shares[PEOPLE.Jake]!.status).toBe("opted_out");
  });

  it("asks when the item isn't on the receipt, and doesn't lock in under the question", async () => {
    const w = world({
      receipt: { bistro: BISTRO },
      expense: {
        [`adjustment|${PIE}`]: adjustment([], [{ name: "Priya", amount_cents: null, item: "key lime pie" }]),
      },
    });
    await w.photo("Priya", "bistro");
    const id = w.db.expenses()[0]!.expense_id;
    await w.say("Priya", PIE);
    expect(w.said("clarifying_question")).toHaveLength(1);
    w.advance(31_000);
    await tick(w.ctx);
    expect(w.db.expense(id)!.status).toBe("proposed");
  });

  it("prices an answer that names the item from the receipt", async () => {
    const ANSWER = "oh it's the cheesecake on the receipt";
    const w = world({
      receipt: { bistro: BISTRO },
      expense: {
        [`adjustment|${PIE}`]: adjustment([], [{ name: "Priya", amount_cents: null, item: "key lime pie" }]),
        [`adjustment|${PIE}\n${ANSWER}`]: adjustment([], [{ name: "Priya", amount_cents: null, item: "cheesecake" }]),
      },
    });
    await w.photo("Priya", "bistro");
    const id = w.db.expenses()[0]!.expense_id;
    await w.say("Priya", PIE);
    expect(w.said("clarifying_question")).toHaveLength(1);
    await w.say("Priya", ANSWER);
    expect(w.said("clarifying_question")).toHaveLength(1); // nothing more to ask
    expect(w.db.shares(id).find((s) => s.phone === PEOPLE.Priya)!.fixed_cents).toBe(799);
    // Answered, so the split can lock in again on schedule.
    w.advance(60_000); // past the demo deadline, well inside the question TTL
    await tick(w.ctx);
    expect(w.db.expense(id)!.status).toBe("finalized");
  });

  const items = (rows: [string, number, number][]): LineItem[] =>
    rows.map(([description, quantity, amount_cents], i) => ({
      item_id: `i${i}`, expense_id: "e", position: i + 1, description, quantity, amount_cents,
    }));
  const bistro = items([["BURGER DELUXE", 1, 1499], ["2 x SOFT DRINK @ $2.99", 1, 598], ["CHEESECAKE", 1, 799]]);

  it.each([
    ["2 soft drinks", 598],
    ["soft drinks", 598],
    ["a soft drink", 299],
    ["one soft drink", 299],
    ["the burger", 1499],
    ["cheesecake", 799],
  ])("matches %s to the receipt", (item, cents) => {
    expect(receiptPrice(item, bistro)).toBe(cents);
  });

  // Harjyot's playground on #35: "alex had both drinks" got "How much was
  // Alex's both drinks?"; quantifiers and filler mustn't block a match.
  it.each([
    ["both drinks", 598],
    ["both soft drinks", 598],
    ["the drinks", 598],
    ["all the drinks", 598],
    ["those drinks", 598],
    ["our drinks", 598],
    ["a drink", 299],
    ["the 2 drinks", 598],
  ])("matches %s to the drinks line", (item, cents) => {
    expect(receiptPrice(item, bistro)).toBe(cents);
  });

  it("asks rather than guess on no match or a tie", () => {
    expect(receiptPrice("key lime pie", bistro)).toBeUndefined();
    expect(receiptPrice("burger", items([["CHEESE BURGER", 1, 1200], ["VEGGIE BURGER", 1, 1100]]))).toBeUndefined();
    expect(receiptPrice("burger", items([["VEGGIE BURGER", 1, 1100], ["CHEESEBURGER", 1, 1200]]))).toBeUndefined();
    expect(receiptPrice("cheeseburger", items([["VEGGIE BURGER", 1, 1100], ["CHEESEBURGER", 1, 1200]]))).toBe(1200);
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
      "cool, here's what's owed to Joe for frita batidos:\nKian $63.75, Priya $25.50, Jake $6.37\n",
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
    expect(nudges()[0]!.text).toMatch(/^Jake,? what('d you get| was yours) at frita batidos\? numbers.*"even"/);

    await w.wait(121_000); // +12h → +120s
    expect(nudges()[1]!.text).toMatch(/^Jake,? (still|no rush, just) need yours for frita batidos.*numbers or "even"$/);

    await w.wait(300_000); // 44h → 440s
    expect(nudges()[2]!.text).toMatch(/^last call Jake: in \d+ seconds i'll put you down for \$\d+\.\d{2} for frita batidos/);
    expect(w.db.outbox().filter((o) => o.kind === "dm")).toEqual([]); // no DMs at all

    await w.wait(41_000); // 48h → 480s: deadline
    expect(w.db.expenses()[0]!.status).toBe("finalized");
  });
});
