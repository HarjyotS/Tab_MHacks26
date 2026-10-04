import { describe, expect, it, vi } from "vitest";
import type { ChatClient } from "../src/grok/structured.js";
import { extractExpense } from "../src/extraction/expense.js";
import { resolveClaim } from "../src/extraction/claim.js";
import { extractCorrection } from "../src/extraction/correction.js";
import { resolveAnswer } from "../src/extraction/answer.js";
import { resolveName } from "../src/extraction/names.js";
import type { ExtractInput } from "../src/extraction/types.js";
import { FRITA_ITEMS, MEMBERS, PHONES } from "../scripts/extraction-cases.js";

const members = MEMBERS;
const people = MEMBERS.filter((m) => m.phone !== "tab");
const input = (text: string, sender: string = PHONES.Joe): ExtractInput => ({
  members,
  context: [],
  open_items: [
    { expense_id: "e1", description: "Pizza", expense_status: "proposed" },
  ],
  message: { sender_phone: sender, is_dm: false, kind: "text", text },
});

function fake(output: Record<string, unknown>): ChatClient {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(output) } }],
  });
  return { chat: { completions: { create } } } as unknown as ChatClient;
}

const expenseRaw = (over: Record<string, unknown>) => ({
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: "Pizza",
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
  ...over,
});

describe("resolveName", () => {
  it("maps me to the sender, exact names, and unique nicknames", () => {
    expect(resolveName("me", members, PHONES.Kian)).toBe(PHONES.Kian);
    expect(resolveName("Priya", members, PHONES.Joe)).toBe(PHONES.Priya);
    expect(resolveName("harj", members, PHONES.Joe)).toBe(PHONES.Harjyot);
  });

  it("never resolves a name to Tab", () => {
    expect(resolveName("tab", members, PHONES.Joe)).toBeNull();
  });

  it("returns null for strangers and ambiguous prefixes instead of guessing", () => {
    expect(resolveName("marco", members, PHONES.Joe)).toBeNull();
    expect(resolveName("jo", members, PHONES.Kian)).toBeNull();
  });
});

describe("extractExpense validation", () => {
  it("drops an amount that is not in the message and asks about it", async () => {
    const out = await extractExpense(
      fake(expenseRaw({ amount_cents: 100000 })),
      "m",
      input("got pizza for everyone, $48"),
    );
    expect(out.result.amount_cents).toBeUndefined();
    expect(out.result.missing).toContain("amount");
    expect(out.problems).toEqual([
      { kind: "ungrounded_amount", amount_cents: 100000 },
    ]);
  });

  it("never turns an unknown name into a member", async () => {
    const out = await extractExpense(
      fake(
        expenseRaw({ amount_cents: 2200, payer: "named", payer_name: "Marco" }),
      ),
      "m",
      input("marco paid for the uber, 22"),
    );
    expect(out.result.payer).toEqual({ kind: "unknown" });
    expect(out.problems).toEqual([{ kind: "unknown_name", name: "Marco" }]);
  });

  it("multiplies a per-person amount by the headcount only when the text says each", async () => {
    const each = await extractExpense(
      fake(expenseRaw({ amount_cents: 1500, amount_is_per_person: true })),
      "m",
      input("venmo me 15 each for firewood"),
    );
    expect(each.result.amount_cents).toBe(1500 * people.length);

    const notEach = await extractExpense(
      fake(expenseRaw({ amount_cents: 10000, amount_is_per_person: true })),
      "m",
      input("i got the tickets, 4 x 25"),
    );
    expect(notEach.result.amount_cents).toBe(10000);
  });

  it("flags amounts over $1,000 for confirmation", async () => {
    const out = await extractExpense(
      fake(expenseRaw({ amount_cents: 240000 })),
      "m",
      input("paid rent, 2,400"),
    );
    expect(out.problems).toEqual([
      { kind: "large_amount", amount_cents: 240000 },
    ]);
  });

  it("derives missing payer in code and asks one question", async () => {
    const out = await extractExpense(
      fake(expenseRaw({ amount_cents: 4800, payer: "unknown" })),
      "m",
      input("pizza was $48"),
    );
    expect(out.result.missing).toEqual(["payer"]);
    expect(out.problems).toEqual([{ kind: "missing_payer" }]);
  });

  it("asks for the price of an item someone only had", async () => {
    const out = await extractExpense(
      fake(
        expenseRaw({
          payer: "unknown",
          fixed: [{ name: "John", amount_cents: null, item: "diet coke" }],
        }),
      ),
      "m",
      input("not even, john only had a diet coke"),
      "adjustment",
    );
    expect(out.result.fixed).toEqual([
      { phone: PHONES.John, item: "diet coke" },
    ]);
    expect(out.result.missing).toEqual(["item_price"]);
    expect(out.problems).toEqual([
      { kind: "missing_item_price", phone: PHONES.John, item: "diet coke" },
    ]);
  });
});

describe("resolveClaim validation", () => {
  it("treats item numbers that are not on the list as unclear", async () => {
    const out = await resolveClaim(
      fake({ kind: "items", item_positions: [1, 9], same_as_name: null }),
      "m",
      input("1 and 9"),
      FRITA_ITEMS,
    );
    expect(out.result).toEqual({ kind: "unclear", item_positions: [] });
  });

  it("resolves same-as to a member and rejects copying yourself", async () => {
    const jake = await resolveClaim(
      fake({ kind: "same_as", item_positions: [], same_as_name: "Jake" }),
      "m",
      input("same as jake"),
      FRITA_ITEMS,
    );
    expect(jake.result).toEqual({
      kind: "same_as",
      item_positions: [],
      same_as_phone: PHONES.Jake,
    });

    const self = await resolveClaim(
      fake({ kind: "same_as", item_positions: [], same_as_name: "me" }),
      "m",
      input("same as me"),
      FRITA_ITEMS,
    );
    expect(self.result.kind).toBe("unclear");
  });

  it("dedupes and sorts item positions", async () => {
    const out = await resolveClaim(
      fake({ kind: "items", item_positions: [4, 1, 4], same_as_name: null }),
      "m",
      input("4 and 1 and 4"),
      FRITA_ITEMS,
    );
    expect(out.result.item_positions).toEqual([1, 4]);
  });
});

describe("extractCorrection validation", () => {
  it("targets the only open expense and rejects an ungrounded new amount", async () => {
    const out = await extractCorrection(
      fake({
        target_expense_id: null,
        new_amount_cents: 5000,
        new_description: null,
        unclear: false,
      }),
      "m",
      input("actually it was 38"),
    );
    expect(out.result).toEqual({ target_expense_id: "e1", unclear: true });
    expect(out.problems).toEqual([
      { kind: "ungrounded_amount", amount_cents: 5000 },
    ]);
  });
});

describe("resolveAnswer validation", () => {
  const threads = [
    { id: "clarify:m2", question: "What tip did you leave?", expects: "an amount or a percent", who: "Joe" },
    { id: "clarify:m1", question: "Which one?\n1. Diner\n2. Frita", expects: "a numbered choice", choices: 2, who: "Joe" },
  ];
  const resolution = (over: Record<string, unknown>) => ({
    thread_id: "q1",
    relevance: 0.9,
    yes_no: null,
    amount_cents: null,
    percent: null,
    choice: null,
    settle_mode: null,
    restated: null,
    also_new: false,
    also_intent: null,
    ...over,
  });

  it("maps the short id back to the thread and keeps a grounded amount", async () => {
    const out = await resolveAnswer(fake(resolution({ amount_cents: 600 })), "m", input("left 6 bucks"), threads);
    expect(out).toEqual({ thread_id: "clarify:m2", relevance: 0.9, amount_cents: 600, also_new: false });
  });

  it("drops an amount, percent, or restated number the message doesn't contain", async () => {
    const out = await resolveAnswer(
      fake(resolution({ amount_cents: 900, percent: 18, restated: "Joe left a $9 tip." })),
      "m",
      input("the usual"),
      threads,
    );
    expect(out).toEqual({ thread_id: "clarify:m2", relevance: 0.9, also_new: false });
  });

  it("answers nothing when the id isn't one of the questions offered", async () => {
    const out = await resolveAnswer(fake(resolution({ thread_id: "clarify:m2", yes_no: "yes" })), "m", input("yes"), threads);
    expect(out).toEqual({ relevance: 0, also_new: false });
  });

  it("keeps a choice only in range, and reads unknown enum strings as nothing", async () => {
    const bad = await resolveAnswer(fake(resolution({ thread_id: "q2", choice: 3, yes_no: "maybe" })), "m", input("the third"), threads);
    expect(bad).toEqual({ thread_id: "clarify:m1", relevance: 0.9, also_new: false });
    const good = await resolveAnswer(fake(resolution({ thread_id: "q2", choice: 2, relevance: 4 })), "m", input("the second one"), threads);
    expect(good).toMatchObject({ choice: 2, relevance: 1 });
  });

  it("reports what else the message does only when it says something else", async () => {
    const out = await resolveAnswer(
      fake(resolution({ also_new: true, also_intent: "expense", amount_cents: 300 })),
      "m",
      input("3, and I also got gas $30"),
      threads,
    );
    expect(out).toMatchObject({ amount_cents: 300, also_new: true, also_intent: "expense" });
    const quiet = await resolveAnswer(fake(resolution({ also_intent: "expense" })), "m", input("3"), threads);
    expect(quiet.also_intent).toBeUndefined();
  });
});
