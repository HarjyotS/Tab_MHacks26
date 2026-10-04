// "@Tab breakdown" (§7.8): each balance traced to the expense records behind
// it, from the store only (no Grok), posted in the group.
import { describe, expect, it, vi } from "vitest";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { addThread } from "../src/brain/threads.js";
import { rejectReason, summarizeBreakdown } from "../src/copy/summary.js";
import { GROUP, world } from "./support/harness.js";

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

const SUSHI: ReceiptRead = {
  receipt: {
    is_receipt: true,
    merchant: "Blue Ocean Sushi",
    items: [
      { description: "Omakase Platter", quantity: 1, amount_cents: 9500 },
      { description: "Miso Soup", quantity: 1, amount_cents: 400 },
      { description: "Green Tea", quantity: 1, amount_cents: 300 },
      { description: "Edamame", quantity: 1, amount_cents: 600 },
    ],
    subtotal_cents: 10800,
    tax_cents: 648,
    total_cents: 11448,
  },
  tip_line_blank: false,
  math_problem: null,
  currency: "USD",
};

const script = {
  expense: {
    "new|got pizza for everyone, $40": raw(4000, "Pizza"),
    "new|paid $24 for the uber": raw(2400, "Uber"),
  },
  receipt: { sushi: SUSHI },
  claim: {
    "1": { kind: "items", item_positions: [1], same_as_name: null },
    "2": { kind: "items", item_positions: [2], same_as_name: null },
    "3": { kind: "items", item_positions: [3], same_as_name: null },
    "4": { kind: "items", item_positions: [4], same_as_name: null },
  },
};

// Joe's pizza ($10 each), Kian's uber ($6 each), Priya's lopsided sushi
// receipt (Joe had the platter), all locked in.
async function evening() {
  const w = world(script);
  await w.say("Joe", "got pizza for everyone, $40");
  await w.say("Kian", "paid $24 for the uber");
  await w.photo("Priya", "sushi");
  for (const [who, n] of [["Joe", "1"], ["Kian", "2"], ["Priya", "3"], ["Jake", "4"]] as const) await w.say(who, n);
  await w.wait(41_000);
  return w;
}
const last = (w: ReturnType<typeof world>) => w.said("breakdown_reply").at(-1)!.toLowerCase();

describe("@Tab breakdown", () => {
  it("traces each pair to its expenses, nets them, and posts in the group", async () => {
    const w = await evening();
    await w.say("Joe", "@Tab breakdown");
    const out = w.db.outbox().filter((o) => o.purpose === "breakdown_reply").at(-1)!;
    expect(out).toMatchObject({ kind: "group_message", group_id: GROUP });
    const text = last(w);
    // Joe owes Priya the platter ($95 + 6% tax = $100.70), minus Priya's $10 pizza share.
    expect(text).toContain("here's joe's breakdown:");
    expect(text).toContain("joe owes priya $90.70");
    expect(text).toMatch(/\+ \$100\.70 joe's share of blue ocean sushi \(omakase platter \+ tax\) · priya paid \$114\.48, .+ · receipt photo/);
    expect(text).toMatch(/− \$10\.00 priya's share of pizza \(split 4 ways\) · joe paid \$40\.00, .+ · "got pizza for everyone, \$40"/);
    // Kian: $10 pizza to Joe against Joe's $6 uber share.
    expect(text).toContain("kian owes joe $4.00");
    expect(text).toMatch(/− \$6\.00 joe's share of uber \(split 4 ways\) · kian paid \$24\.00, .+ · "paid \$24 for the uber"/);
  });

  it("agrees with what do I owe, line for line", async () => {
    const w = await evening();
    await w.say("Joe", "what do i owe");
    await w.say("Joe", "@Tab breakdown");
    const balance = w.said("balance_reply").at(-1)!.toLowerCase();
    const text = last(w);
    for (const [, who, cents] of text.matchAll(/^joe owes (\w+) (\$[\d.]+)$/gm)) expect(balance).toContain(`${who} ${cents}`);
    for (const [, who, cents] of text.matchAll(/^(\w+) owes joe (\$[\d.]+)$/gm)) expect(balance).toContain(`${who} owes you ${cents}`);
    // And each headline is the signed sum of its lines.
    for (const section of text.split(/\n(?=\w+ owes )/).slice(1)) {
      const [head, ...lines] = section.split("\n");
      const net = Number(head!.match(/\$([\d.]+)$/)![1]);
      const sum = lines.reduce((s, l) => s + (l.startsWith("+") ? 1 : -1) * Number(l.match(/^[+−] \$([\d.]+)/)![1]), 0);
      expect(sum).toBeCloseTo(net, 2);
    }
  });

  it("narrows to one person, or to two other people", async () => {
    const w = await evening();
    await w.say("Joe", "@Tab breakdown Kian");
    expect(last(w)).toMatch(/^here's the breakdown:\nkian owes joe \$4\.00\n/);
    expect(last(w)).not.toContain("priya");
    await w.say("Jake", "@tab breakdown priya and kian");
    expect(last(w)).toMatch(/^here's the breakdown:\n(kian owes priya|priya owes kian) /);
    expect(last(w)).not.toContain("joe owes");
  });

  it("says when someone isn't in the group instead of guessing", async () => {
    const w = await evening();
    await w.say("Joe", "@Tab breakdown Bob");
    expect(last(w)).toMatch(/^don't see bob in this group, try "@tab breakdown" or "@tab breakdown <name>"$/);
  });

  it("leaves out paid shares, and says when someone is square", async () => {
    const w = world(script);
    await w.say("Joe", "@Tab breakdown");
    expect(last(w)).toBe("joe's square with everyone");
  });

  it("never calls Grok: every line is a database row", async () => {
    const w = await evening();
    const extract = vi.fn(() => {
      throw new Error("Grok called");
    });
    w.ctx.extract = { expense: extract, claim: extract, correction: extract, receipt: extract } as never;
    await w.say("Joe", "@Tab breakdown");
    expect(extract).not.toHaveBeenCalled();
    expect(last(w)).toContain("joe owes priya $90.70");
  });

  it.each([
    ["stub gate", undefined],
    ["gate says expense", 0.6],
  ])('points a free-form "whats the $90.70 from?" to the command, never a new expense (%s)', async (_, confidence) => {
    const w = await evening();
    const before = w.db.expenses().length;
    if (confidence) w.ctx.classify = async () => ({ intent: "expense", confidence });
    await w.say("Kian", "whats the $90.70 from?");
    expect(w.db.expenses()).toHaveLength(before);
    expect(w.said("clarifying_question")).toEqual([]);
    expect(w.said("other").at(-1)?.toLowerCase()).toMatch(/@tab breakdown/);
  });

  it('answers "why?" after a balance reply shortly, netting with the expenses behind it', async () => {
    const w = await evening();
    await w.say("Joe", "what do i owe");
    await w.say("Joe", "why");
    expect(last(w).split("\n")).toEqual([
      "joe owes priya $90.70: blue ocean sushi $100.70, less pizza $10.00",
      "jake owes joe $10.00: pizza $10.00",
      "kian owes joe $4.00: pizza $10.00, less uber $6.00",
    ]);
  });

  it.each([
    ["why do I owe Priya?", /^here's the breakdown:\njoe owes priya \$90\.70\n/],
    ["why does kian owe me", /^here's the breakdown:\nkian owes joe \$4\.00\n/],
  ])("routes %j to the breakdown for that person", async (text, want) => {
    const w = await evening();
    await w.say("Joe", text);
    expect(last(w)).toMatch(want);
  });

  it("answers the command even while Tab is waiting on another question", async () => {
    const w = await evening();
    const source = w.db.messages().find((m) => m.group_id === GROUP)!;
    addThread(w.ctx, { group_id: GROUP }, {
      id: `settle_mode:${GROUP}`, text: "got a trip coming up?", who: "anyone",
      data: { kind: "settle_mode", source, asked_at: w.ctx.now() },
    });
    await w.say("Joe", "@Tab breakdown");
    expect(last(w)).toContain("here's joe's breakdown:");
  });
});

// A fake Grok that returns `reasons` as the summary.
const grokSays = (reasons: string[] | (() => never)) =>
  ({
    chat: {
      completions: {
        create: vi.fn(async () => {
          if (typeof reasons === "function") reasons();
          return { choices: [{ message: { content: JSON.stringify({ reasons }) } }] };
        }),
      },
    },
  }) as never;

describe("@Tab breakdown, summarized by Grok when long", () => {
  const GOOD = [
    "Joe's sushi platter ($100.70), less Priya's pizza share ($10.00)",
    "Jake's pizza share ($10.00)",
    "Kian's pizza share ($10.00), less Joe's uber share ($6.00)",
  ];

  it("sends code's headlines with Grok's checked reasons, and points to the full list", async () => {
    const w = await evening();
    const grok = grokSays(GOOD);
    w.ctx.summarize = (s) => summarizeBreakdown(grok, "m", s);
    await w.say("Joe", "@Tab breakdown");
    expect(last(w).split("\n")).toEqual([
      "here's joe's breakdown:",
      "joe owes priya $90.70: joe's sushi platter ($100.70), less priya's pizza share ($10.00)",
      "jake owes joe $10.00: jake's pizza share ($10.00)",
      "kian owes joe $4.00: kian's pizza share ($10.00), less joe's uber share ($6.00)",
      `every line: "@tab breakdown full"`,
    ]);
    // Grok got the database records, not chat history.
    const prompt = (grok as any).chat.completions.create.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain("+ $100.70 Joe's share of Blue Ocean Sushi (omakase platter + tax), Priya paid $114.48");
  });

  it.each([
    ["an amount not in the records", [GOOD[0]!.replace("$100.70", "$100.00"), GOOD[1]!, GOOD[2]!]],
    ["a computed amount", [GOOD[0]!, GOOD[1]!, "Kian's $4.50 after the uber"]],
    ["an amount in words", [GOOD[0]!, "ten dollars of pizza", GOOD[2]!]],
    ["someone outside the pair", [GOOD[0]!, "Jake's pizza share ($10.00), same as Priya", GOOD[2]!]],
    ["a missing reason", [GOOD[0]!, GOOD[1]!]],
  ])("falls back to the full list on %s", async (_, reasons) => {
    const w = await evening();
    w.ctx.summarize = (s) => summarizeBreakdown(grokSays(reasons), "m", s);
    await w.say("Joe", "@Tab breakdown");
    expect(last(w)).toContain("+ $100.70 joe's share of blue ocean sushi");
    expect(last(w)).not.toContain("every line");
  });

  it("falls back to the full list when Grok fails", async () => {
    const w = await evening();
    w.ctx.summarize = (s) => summarizeBreakdown(grokSays(() => { throw new Error("down"); }), "m", s);
    await w.say("Joe", "@Tab breakdown");
    expect(last(w)).toContain("+ $100.70 joe's share of blue ocean sushi");
  });

  it('never summarizes "@Tab breakdown full", or a breakdown that is already short', async () => {
    const w = await evening();
    const summarize = vi.fn(async () => GOOD);
    w.ctx.summarize = summarize;
    await w.say("Joe", "@Tab breakdown full");
    expect(last(w)).toContain("+ $100.70 joe's share of blue ocean sushi");
    await w.say("Joe", "@Tab breakdown kian");
    expect(last(w)).toMatch(/^here's the breakdown:\nkian owes joe \$4\.00\n/);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("checks each reason's amounts and names", () => {
    const pair = {
      debtor: "Kian", creditor: "Joe", net_cents: 400,
      events: [
        { signed_cents: 1000, description: "Pizza", payer: "Joe", debtor: "Kian", total_cents: 4000, when: "", why: "split 4 ways" },
        { signed_cents: -600, description: "Uber", payer: "Kian", debtor: "Joe", total_cents: 2400, when: "", why: "split 4 ways" },
      ],
    };
    const names = ["Joe", "Kian", "Priya", "Jake"];
    expect(rejectReason("pizza ($10.00) less uber ($6.00), $40.00 total", pair, names)).toBeNull();
    expect(rejectReason("pizza ($10) less uber ($6)", pair, names)).toBeNull();
    expect(rejectReason("pizza ($12.00)", pair, names)).toBe("amount");
    expect(rejectReason("pizza 10.00 less uber", pair, names)).toBe("amount");
    expect(rejectReason("about four bucks", pair, names)).toBe("amount");
    expect(rejectReason("pizza, like Priya's", pair, names)).toBe("name");
    // Under "Kian owes Joe": Joe's uber share is owed back, so it can't lead (live run).
    expect(rejectReason("Joe's uber share ($6.00), less Kian's pizza share ($10.00)", pair, names)).toBe("order");
    expect(rejectReason("Kian's pizza share ($10.00), less Joe's uber share ($6.00)", pair, names)).toBeNull();
    expect(rejectReason("pizza\nuber", pair, names)).toBe("multiline");
    expect(rejectReason("what pizza?", pair, names)).toBe("question");
  });
});
