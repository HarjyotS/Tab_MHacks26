import { describe, expect, it } from "vitest";
import { GROUP, world } from "./support/harness.js";

// SPEC §7.7: a correction replies to the expense (or Tab's proposal) with a
// new amount or description.
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
const fix = (cents: number | null, description: string | null = null) => ({
  target_expense_id: null,
  new_amount_cents: cents,
  new_description: description,
  unclear: false,
});

const script = {
  expense: { "new|got pizza, $40": raw(4000, "Pizza") },
  correction: {
    "actually it was 44": fix(4400),
    "actually it was thai food, $44": fix(4400, "Thai food"),
  },
};

const shares = (w: ReturnType<typeof world>, id: string) =>
  w.db.shares(id).map((s) => s.amount_cents);

describe("corrections (§7.7)", () => {
  it("updates an open split and posts the new proposal", async () => {
    const w = world(script);
    const pizza = await w.say("Joe", "got pizza, $40");
    const id = `exp_${pizza.message_id}`;
    await w.say("Joe", "actually it was thai food, $44", {
      reply_to_id: pizza.message_id,
    });
    expect(w.db.expense(id)).toMatchObject({
      total_cents: 4400,
      description: "Thai food",
      status: "proposed",
    });
    expect(shares(w, id)).toEqual([1100, 1100, 1100, 1100]);
    expect(w.said("split_proposal").at(-1)).toMatch(
      /^(ok redid it|fixed it|bet, redid it): thai food \$44\.00 split 4 ways, so \$11\.00 each$/,
    );
  });

  it("reopens a locked-in expense nobody has paid, with a fresh window", async () => {
    const w = world(script);
    const pizza = await w.say("Joe", "got pizza, $40");
    const id = `exp_${pizza.message_id}`;
    await w.wait(31_000);
    expect(w.db.expense(id)!.status).toBe("finalized");
    await w.say("Joe", "actually it was 44", { reply_to_id: pizza.message_id });
    expect(w.db.expense(id)).toMatchObject({
      status: "proposed",
      total_cents: 4400,
      settle_message_id: undefined,
    });
    await w.wait(31_000);
    expect(w.db.expense(id)).toMatchObject({
      status: "finalized",
      total_cents: 4400,
    });
  });

  it("explains it can't change one that's already being paid", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({
      group_id: GROUP,
      settle_mode: "per_expense",
    });
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    await w.react("Priya", `settle_request:exp_${pizza.message_id}`);
    await w.say("Joe", "actually it was 44", { reply_to_id: pizza.message_id });
    expect(w.db.expense(`exp_${pizza.message_id}`)!.total_cents).toBe(4000);
    expect(w.said("clarifying_question")).toEqual([
      "pizza is already being paid, so i can't change it\njust log the difference as a new expense",
    ]);
  });

  it("asks what it should be when the correction is unclear", async () => {
    const w = world({
      ...script,
      correction: {
        "actually that's wrong $": { ...fix(null), unclear: true },
      },
    });
    const pizza = await w.say("Joe", "got pizza, $40");
    w.ctx.classify = async () => ({ intent: "correction", confidence: 0.95 });
    await w.say("Joe", "actually that's wrong $", {
      reply_to_id: pizza.message_id,
    });
    expect(w.said("clarifying_question")).toEqual(["what should pizza be instead?"]);
    expect(w.db.expense(`exp_${pizza.message_id}`)!.total_cents).toBe(4000);
  });

  it("applies a correction from anyone who replies to the expense", async () => {
    const w = world(script);
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.say("Kian", "actually it was 44", {
      reply_to_id: pizza.message_id,
    });
    expect(w.db.expense(`exp_${pizza.message_id}`)!.total_cents).toBe(4400);
  });
});
