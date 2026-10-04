import { describe, expect, it } from "vitest";
import { createLookup, scopeOf, words } from "../src/brain/lookup.js";
import { debts } from "../src/brain/talk.js";
import { GROUP, PEOPLE, world } from "./support/harness.js";
import { SAM, seedHistory, WORK } from "./support/seed.js";

function setup() {
  const w = world({});
  seedHistory(w.db);
  const inGroup = (who: keyof typeof PEOPLE = "Priya") => createLookup(w.ctx, { groups: [GROUP], asker: PEOPLE[who] });
  return { w, inGroup };
}
const json = (v: unknown) => JSON.stringify(v);
const PHONE = /\+?1?555555\d{4}/;

describe("lookup scope", () => {
  it("a group chat sees only that group", () => {
    const { inGroup } = setup();
    const l = inGroup("Joe");
    expect(json(l.findExpenses({ query: "sushi" }))).not.toMatch(/Sushi/);
    expect(json(l.totals({}))).not.toMatch(/Sam|90\.00/);
    expect(json(l.balances())).not.toMatch(/Sam/);
    expect(l.whyOwe({ from: "sam", to: "joe" })).toMatchObject({ error: expect.stringMatching(/No one named "sam"/) });
  });

  it("a DM sees every group the sender is in, and no other", () => {
    const { w } = setup();
    const dm = w.db.ingest({ sender_phone: PEOPLE.Joe, text: "how much was sushi" });
    expect(scopeOf(w.ctx, dm).groups.sort()).toEqual([GROUP, WORK]);
    const joe = createLookup(w.ctx, scopeOf(w.ctx, dm));
    expect(joe.findExpenses({ query: "sushi" })).toMatchObject({ count: 1, expenses: [{ description: "Sushi", total: "$90.00" }] });

    const priyaDm = w.db.ingest({ sender_phone: PEOPLE.Priya, text: "how much was sushi" });
    expect(scopeOf(w.ctx, priyaDm).groups).toEqual([GROUP]);
    const priya = createLookup(w.ctx, scopeOf(w.ctx, priyaDm));
    expect(priya.findExpenses({ query: "sushi" })).toMatchObject({ count: 0 });
    expect(json(priya.searchMessages({ query: "sushi" }))).not.toMatch(/sushi/i);
    expect(json(priya.payments())).not.toMatch(/Sam/);
  });

  it("never returns a phone number, from any tool", async () => {
    const { w, inGroup } = setup();
    w.db.addGroup("unnamed", [{ phone: PEOPLE.Joe, name: "Joe" }, { phone: SAM }]);
    const l = inGroup();
    const dm = createLookup(w.ctx, { groups: [GROUP, WORK, "unnamed"], asker: PEOPLE.Joe });
    for (const out of [
      l.findExpenses({}), l.expenseDetail("e1"), l.balances(), l.whyOwe({ from: "jake", to: "joe" }), l.totals({}),
      l.payments(), l.settleStatus(), l.searchMessages({}), dm.balances(), dm.totals({}), await l.ledgerLink(),
    ])
      expect(json(out)).not.toMatch(PHONE);
  });

  it("refers to expenses by short refs, oldest first", () => {
    const { inGroup } = setup();
    const l = inGroup();
    expect(l.expenseDetail("e1")).toMatchObject({ description: "The Bistro" });
    expect(l.expenseDetail("E2")).toMatchObject({ description: "Pizza" });
    expect(l.expenseDetail("e9")).toMatchObject({ error: expect.any(String) });
  });
});

describe("findExpenses", () => {
  it("ranks a description match over an item match, and finds receipts by their items", () => {
    const { inGroup } = setup();
    const l = inGroup();
    expect(l.findExpenses({ query: "bistro receipt" })).toMatchObject({ count: 1, expenses: [{ ref: "e1", total: "$47.07", payer: "Joe", receipt_items: 4 }] });
    expect(l.findExpenses({ query: "cheesecake" })).toMatchObject({ count: 1, expenses: [{ description: "The Bistro" }] });
    expect(l.findExpenses({ query: "the uber" })).toMatchObject({ expenses: [{ description: "Uber to the airport", payer: "Jake" }] });
  });

  it("widens a category: food finds dinner, pizza and groceries but not the uber or the cancelled tacos", () => {
    const { inGroup } = setup();
    const out = inGroup().findExpenses({ query: "food" }) as { expenses: { description: string }[]; all_matches_total: string };
    expect(out.expenses.map((e) => e.description).sort()).toEqual(["Groceries", "Pizza", "The Bistro"]);
    expect(out.all_matches_total).toBe("$158.07");
  });

  it("filters by payer, participant, status, and dates", () => {
    const { inGroup } = setup();
    const l = inGroup();
    expect(l.findExpenses({ payer: "jake" })).toMatchObject({ count: 1, expenses: [{ description: "Uber to the airport" }] });
    expect(l.findExpenses({ status: "void" })).toMatchObject({ count: 1, expenses: [{ description: "Tacos", status: "cancelled" }] });
    expect(l.findExpenses({ since: "2026-09-29", until: "2026-10-01" })).toMatchObject({ count: 2 });
    expect(l.findExpenses({ participant: "me" })).toMatchObject({ count: 4 });
    expect(l.findExpenses({ payer: "bob" })).toMatchObject({ error: expect.stringMatching(/No one named/) });
  });
});

describe("expenseDetail", () => {
  it("shows a receipt: items with prices and who claimed them, extras, shares with why, and payments", () => {
    const { inGroup } = setup();
    const d = inGroup().expenseDetail("e1");
    expect(d).toMatchObject({
      description: "The Bistro",
      total: "$47.07",
      subtotal: "$38.95",
      tax: "$3.12",
      tip: "$5.00",
      split: expect.stringMatching(/^itemized/),
      receipt_items: [
        { line: 1, description: "BURGER DELUXE", price: "$14.99", claimed_by: ["Kian"] },
        { line: 2, description: "CAESAR SALAD", price: "$9.99", claimed_by: ["Priya"] },
        { line: 3, description: "2 x SOFT DRINK @ $2.99", price: "$5.98", claimed_by: ["Priya", "Jake"] },
        { line: 4, description: "CHEESECAKE", price: "$7.99", claimed_by: "nobody (shared by everyone)" },
      ],
      payments: [{ from: "Jake", to: "Joe", amount: "$8.07", status: "in progress" }],
    });
    const shares = (d as { shares: { name: string; why: string; owes_payer?: string }[] }).shares;
    expect(shares.find((s) => s.name === "Kian")).toMatchObject({ owes_payer: "$15.00", why: expect.stringMatching(/burger deluxe/) });
  });

  it("includes the message that logged it", () => {
    const { inGroup } = setup();
    expect(inGroup().expenseDetail("e2")).toMatchObject({ logged_from_message: "got pizza for everyone, $48" });
  });
});

describe("balances and whyOwe", () => {
  it("nets debts per pair and gives each person's position", () => {
    const { inGroup } = setup();
    const b = inGroup().balances();
    expect(b).toMatchObject({
      all_square: false,
      debts: [
        { from: "Kian", owes: "Joe", amount: "$27.00" },
        { from: "Priya", owes: "Joe", amount: "$26.00" },
        { from: "Jake", owes: "Joe", amount: "$14.07" },
        { from: "Priya", owes: "Jake", amount: "$6.00" },
      ],
    });
    expect(inGroup().balances({ person: "jake" })).toMatchObject({ positions: [{ name: "Jake", owes_in_total: "$8.07" }] });
    expect(inGroup().balances({ person: "joe" })).toMatchObject({ positions: [{ name: "Joe", is_owed_in_total: "$67.07" }] });
  });

  it("whyOwe lists only that pair's expenses, and they add up to the debt", () => {
    const { w, inGroup } = setup();
    const why = inGroup("Jake").whyOwe({ from: "me", to: "joe" }) as Record<string, unknown>;
    expect(why).toMatchObject({
      from: "Jake",
      to: "Joe",
      owes_now: "$14.07",
      expenses: [
        { description: "Pizza", amount: "$12.00" },
        { description: "The Bistro", amount: "$8.07" },
      ],
      expenses_total: "$20.07",
      offset_by: [{ description: "Uber to the airport", amount: "$6.00" }],
      offset_total: "$6.00",
    });
    const cents = (s: unknown) => Math.round(Number(String(s).replace(/[$,]/g, "")) * 100);
    const debt = debts(w.ctx, GROUP).find((d) => d.from.phone === PEOPLE.Jake && d.to.phone === PEOPLE.Joe)!;
    expect(cents(why.expenses_total) - cents(why.offset_total)).toBe(debt.amount_cents);
    expect(cents(why.owes_now)).toBe(debt.amount_cents);
  });

  it("says when someone owes nothing, and the other way round", () => {
    const { inGroup } = setup();
    expect(inGroup().whyOwe({ from: "joe", to: "jake" })).toMatchObject({ owes_now: "nothing", instead_is_owed: "$14.07" });
  });
});

describe("totals", () => {
  it("adds up in code: count, total, who paid, and each person's share", () => {
    const { inGroup } = setup();
    expect(inGroup().totals({ query: "food" })).toMatchObject({
      count: 3,
      total_spent: "$158.07",
      tax_included: "$3.12",
      tip_included: "$5.00",
      paid_upfront_by: [{ name: "Joe", paid: "$95.07" }, { name: "Kian", paid: "$63.00" }],
      each_persons_share: [
        { name: "Priya", share: "$41.75" },
        { name: "Joe", share: "$37.75" },
        { name: "Kian", share: "$42.75" },
        { name: "Jake", share: "$35.82" },
      ].sort((a, b) => Number(b.share.slice(1)) - Number(a.share.slice(1))),
    });
  });

  it("takes refs, and refuses unknown ones", () => {
    const { inGroup } = setup();
    const l = inGroup();
    expect(l.totals({ refs: ["e2", "e3"] })).toMatchObject({ count: 2, total_spent: "$72.00" });
    expect(l.totals({ refs: ["e2", "e42"] })).toMatchObject({ error: "Unknown refs: e42" });
  });

  it("what one person paid for", () => {
    const { inGroup } = setup();
    expect(inGroup().totals({ payer: "priya" })).toMatchObject({ count: 0, total_spent: "$0.00" });
    expect(inGroup().totals({ participant: "priya" })).toMatchObject({ count: 4, each_persons_share: expect.arrayContaining([{ name: "Priya", share: "$47.75" }]) });
  });
});

describe("payments and settle status", () => {
  it("lists transfers with status", () => {
    const { inGroup } = setup();
    expect(inGroup().payments({ person: "kian" })).toMatchObject({
      count: 1,
      paid_total: "$6.00",
      payments: [{ from: "Kian", to: "Jake", amount: "$6.00", status: "paid", for: "Uber to the airport" }],
    });
  });

  it("shows who the open request is waiting on, what's on the tab, and what isn't locked in", () => {
    const { inGroup } = setup();
    const s = inGroup().settleStatus();
    expect(s).toMatchObject({
      settle_mode: expect.stringMatching(/running tab/),
      open_settle_requests: [
        {
          expenses: [{ ref: "e1", description: "The Bistro" }],
          waiting_for_thumbs_up: [
            { name: "Kian", amount: "$15.00", to: "Joe" },
            { name: "Priya", amount: "$14.00", to: "Joe" },
          ],
          approved_payment_in_progress: [{ name: "Jake", amount: "$8.07" }],
        },
      ],
      not_locked_in_yet: [{ description: "Groceries", total: "$63.00" }],
    });
    expect((s as { locked_in_not_requested_yet: unknown[] }).locked_in_not_requested_yet).toHaveLength(5);
  });
});

describe("searchMessages", () => {
  it("finds kept money messages and Tab's replies, never ignored chat", () => {
    const { w, inGroup } = setup();
    w.db.msgs.set("chat", { message_id: "chat", group_id: GROUP, sender_phone: PEOPLE.Kian, is_dm: false, kind: "text", received_at: new Date(), intent: "ignore", status: "done" });
    w.db.msgs.set("dm", { message_id: "dm", sender_phone: PEOPLE.Kian, is_dm: true, kind: "text", text: "uber was my fault", received_at: new Date(), intent: "balance_query", status: "done" });
    const out = inGroup().searchMessages({ query: "uber" });
    expect(out.messages).toEqual([expect.objectContaining({ from: "Jake", text: "uber to the airport was 24, i got it" })]);
  });
});

describe("ledgerLink", () => {
  it("returns the group's link when the ledger is set up", async () => {
    const { w, inGroup } = setup();
    expect(await inGroup().ledgerLink()).toMatchObject({ error: expect.any(String) });
    w.ctx.ledger = { baseUrl: "https://tab.example", key: "k".repeat(32) };
    expect(await inGroup().ledgerLink()).toMatchObject({ links: [{ url: expect.stringMatching(/^https:\/\/tab\.example\/g\//) }] });
  });
});

describe("words", () => {
  it("stems plurals and drops numbers", () => {
    expect(words("2 x SOFT DRINKS @ $2.99, Jake's fries")).toEqual(["soft", "drink", "jake", "fry"]);
  });
});
