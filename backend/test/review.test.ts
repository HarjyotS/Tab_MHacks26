import { describe, expect, it } from "vitest";
import { stubClassifier } from "@tab/gate";
import {
  answerCents,
  answerPercent,
  inThirdPerson,
} from "../src/brain/process.js";
import { finalize } from "../src/brain/settle.js";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { answer, GROUP, PEOPLE, world } from "./support/harness.js";

// Harjyot's full review of #14 at 76c3413, finding by finding.
const raw = (
  cents: number | null,
  description: string | null,
  payer = "sender",
) => ({
  is_expense: true,
  amount_cents: cents,
  amount_is_per_person: false,
  description,
  payer,
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
});

const script = {
  expense: {
    "new|got pizza, $40": raw(4000, "Pizza"),
    "new|got groceries, $60": raw(6000, "Groceries"),
    "new|pizza was $48 lol": raw(4800, "Pizza", "unknown"),
    "new|pizza was $48 lol\nJoe": {
      ...raw(4800, "Pizza", "named"),
      payer_name: "joe",
    },
  },
  // While "Who paid for the Pizza?" is open, Grok reads Joe's own uber as
  // no answer to it.
  answer: { "uber was $30, I paid": answer({ relevance: 0.05, also_new: true, also_intent: "expense" }) },
};

const finalized = async (w: ReturnType<typeof world>) => {
  const pizza = await w.say("Joe", "got pizza, $40");
  await w.wait(31_000); // past the demo objection window
  return `exp_${pizza.message_id}`;
};

describe("settle requests (findings 1, 2)", () => {
  it("routes a 👍 on an older settle request to the sender's current one", async () => {
    const w = world(script);
    const id = await finalized(w);
    const first = await w.say("Kian", "let's settle up");
    await w.say("Priya", "let's settle up"); // takes over the pizza
    await w.react("Jake", `settle_request:${GROUP}:${first.message_id}`);
    expect(w.db.transfers().map((t) => [t.expense_id, t.from_phone])).toEqual([
      [id, PEOPLE.Jake],
    ]);
  });

  it("pays every share a 👍 covers: the module dedupes on (approval, expense)", async () => {
    const w = world(script);
    await finalized(w);
    await w.say("Priya", "got groceries, $60");
    await w.wait(31_000);
    const settle = await w.say("Kian", "let's settle up");
    await w.react("Jake", `settle_request:${GROUP}:${settle.message_id}`);
    expect(w.db.transfers()).toHaveLength(2);
  });
});

describe("answers to Tab's questions (findings 3, 5)", () => {
  async function askWhoPaid(w: ReturnType<typeof world>) {
    await w.say("Priya", "pizza was $48 lol");
    await w.say("Priya", "yes");
    expect(w.said("clarifying_question").at(-1)).toBe(
      "Who paid for the Pizza?",
    );
  }

  it("doesn't take a bystander's own expense as the answer", async () => {
    const w = world(script);
    await askWhoPaid(w);
    const uber = await w.say("Joe", "uber was $30, I paid");
    expect(uber.status).toBe("done");
    expect(w.db.expenses()[0]).toMatchObject({
      status: "needs_info",
      payer_phone: undefined,
    });
  });

  it('takes an inline reply from someone else, and their "me" means them', async () => {
    const w = world(script);
    await askWhoPaid(w);
    w.ctx.classify = async (input) =>
      input.message.text === "me"
        ? { intent: "expense", confidence: 0.9 }
        : stubClassifier(input);
    const question = w.db
      .outbox()
      .filter((o) => o.purpose === "clarifying_question")
      .at(-1)!;
    await w.say("Joe", "me", { reply_to_id: question.sent_photon_id });
    expect(w.db.expenses()[0]).toMatchObject({
      status: "proposed",
      payer_phone: PEOPLE.Joe,
    });
  });

  it("ignores someone else's answer the gate didn't pass, even inline", async () => {
    const w = world(script);
    await askWhoPaid(w);
    const question = w.db
      .outbox()
      .filter((o) => o.purpose === "clarifying_question")
      .at(-1)!;
    await w.say("Joe", "me", { reply_to_id: question.sent_photon_id }); // the stub says ignore
    expect(w.db.expenses()[0]).toMatchObject({ status: "needs_info" });
  });

  it("clears the text of a message that fails before it proves money-related (§19)", async () => {
    const w = world(script);
    w.ctx.classify = () => Promise.reject(new Error("gate down"));
    const m = await w.say("Kian", "see you at 8");
    expect(m).toMatchObject({
      status: "error",
      intent: "ignore",
      text: undefined,
    });
  });

  it.each([
    ["I paid", "Joe paid"],
    ["me", "Joe"],
    ["I'm the one who paid", "Joe is the one who paid"],
    ["my card", "Joe's card"],
  ])("rewrites %j from Joe as %j", (text, out) => {
    expect(inThirdPerson(text, "Joe")).toBe(out);
  });
});

describe("typed amounts (finding 4)", () => {
  it.each([
    ["22", 2200],
    ["$18.50", 1850],
    ["it was 1,240", 124000],
    ["$1,240.50", 124050],
  ])("reads %s as the right number of cents", (text, cents) => {
    expect(answerCents(text)).toBe(cents);
  });

  it("computes a percentage tip from the subtotal in code", () => {
    expect(answerPercent("20%", 5000)).toBe(1000);
    expect(answerPercent("18 percent", 5000)).toBe(900);
    expect(answerPercent("$10", 5000)).toBeUndefined();
  });
});

describe("finalize (finding 6)", () => {
  it("does nothing the second time, even from a stale snapshot", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const pizza = await w.say("Joe", "got pizza, $40");
    const stale = w.db.expense(`exp_${pizza.message_id}`)!;
    await finalize(w.ctx, stale);
    await finalize(w.ctx, stale); // the deadline tick racing the last 👍
    expect(w.said("settle_request")).toHaveLength(1);
  });
});

describe("claims (finding 7)", () => {
  const read: ReceiptRead = {
    receipt: {
      is_receipt: true,
      merchant: "Diner",
      items: [
        { description: "Steak", quantity: 1, amount_cents: 4000 },
        { description: "Salad", quantity: 1, amount_cents: 1000 },
        { description: "Fries", quantity: 1, amount_cents: 600 },
      ],
      subtotal_cents: 5600,
      total_cents: 5600,
    },
    tip_line_blank: false,
    math_problem: null,
    currency: "USD",
  };

  it("replaces the sender's claims with their latest answer, keeping shared items", async () => {
    const w = world({
      receipt: { r: read },
      claim: {
        "we all split 3": {
          kind: "everyone_shares",
          item_positions: [3],
          same_as_name: null,
        },
        "1": { kind: "items", item_positions: [1], same_as_name: null },
        "actually just 2": {
          kind: "items",
          item_positions: [2],
          same_as_name: null,
        },
      },
    });
    const photo = await w.photo("Joe", "r");
    w.ctx.classify = async () => ({ intent: "claim", confidence: 0.95 });
    await w.say("Priya", "we all split 3");
    await w.say("Kian", "1");
    await w.say("Kian", "actually just 2");
    const mine = w.db
      .claims(`exp_${photo.message_id}`)
      .filter((c) => c.phone === PEOPLE.Kian)
      .map((c) => c.item_id)
      .sort();
    expect(mine).toEqual([
      `exp_${photo.message_id}:2`,
      `exp_${photo.message_id}:3`,
    ]);
  });
});

describe("settling gaps in §7.6 (finding 8)", () => {
  it("nudges people who haven't tapped 👍, in the group, until they do", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const id = await finalized(w);
    await w.react("Kian", `settle_request:${id}`);
    await w.wait(21_000); // the first nudge: 2h, scaled
    expect(w.said("approval_followup")).toHaveLength(2);
    expect(w.said("approval_followup").join("\n")).not.toContain("Kian");
    const priya = w.db
      .outbox()
      .find(
        (o) => o.purpose === "approval_followup" && o.text?.startsWith("Priya"),
      )!;
    expect(priya).toMatchObject({ kind: "group_message", group_id: GROUP });
    expect(priya.text).toMatch(
      /Joe \$10\.00\. Tap 👍 on the settle request to pay\.$/,
    );
    await w.wait(121_000);
    await w.wait(400_000);
    await w.wait(400_000);
    expect(w.said("approval_followup")).toHaveLength(6); // three each, then quiet
  });

  it("disputes every share a 👎 covers, and asks by DM", async () => {
    const w = world(script);
    const pizza = await finalized(w);
    await w.say("Priya", "got groceries, $60");
    await w.wait(31_000);
    const settle = await w.say("Kian", "let's settle up");
    await w.react(
      "Kian",
      `settle_request:${GROUP}:${settle.message_id}`,
      "dislike",
    );
    const kian = w.db
      .expenses()
      .map(
        (e) =>
          w.db.shares(e.expense_id).find((s) => s.phone === PEOPLE.Kian)!
            .status,
      );
    expect(kian).toEqual(["disputed", "disputed"]);
    expect(
      w.db.outbox().find((o) => o.purpose === "dispute_followup"),
    ).toMatchObject({
      kind: "dm",
      to_phone: PEOPLE.Kian,
      text: "What's off with your $25.00? Tell me what you had and I'll fix it.",
    });
  });
});

describe("seeded history (finding 10)", () => {
  it("announces nothing for transfers no one approved in the chat", async () => {
    const w = world(script);
    const id = await finalized(w);
    for (const s of w.db.shares(id).filter((x) => x.phone !== PEOPLE.Joe)) {
      w.db.trs.set(`historic-${s.phone}`, {
        transfer_id: `historic-${s.phone}`,
        group_id: GROUP,
        expense_id: id,
        from_phone: s.phone,
        to_phone: PEOPLE.Joe,
        amount_cents: s.amount_cents,
        status: "done",
        approved_by_message_id: `historic-approval-${s.phone}`,
        created_at: new Date(),
      });
      s.status = "paid";
    }
    w.db.exps.set(id, {
      ...w.db.expense(id)!,
      status: "settled",
      settle_message_id: "demo-settle-pizza",
    });
    await w.wait(1000);
    expect(w.said("payment_receipt")).toEqual([]);
    expect(w.said("all_square")).toEqual([]);
  });
});
