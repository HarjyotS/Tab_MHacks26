import { describe, expect, it } from "vitest";
import { stubClassifier } from "@tab/gate";
import { processMessage } from "../src/brain/process.js";
import { GROUP, PEOPLE, world } from "./support/harness.js";

// Harjyot's playground testing on #14, after f573ea6.
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

const COKE = "not even, jake only had a $3 diet coke";
const script = {
  expense: {
    "new|got pizza, $40": raw(4000, "Pizza"),
    [`adjustment|${COKE}`]: {
      ...raw(null, null, "unknown"),
      fixed: [{ name: "jake", amount_cents: 300, item: "diet coke" }],
    },
  },
};

function cokeIsAnAdjustment(w: ReturnType<typeof world>) {
  // Jev's live verdict; the stub would call it a dispute once finalized.
  w.ctx.classify = async (input) =>
    input.message.text === COKE
      ? { intent: "split_adjustment", confidence: 0.9 }
      : stubClassifier(input);
}

describe("the settle-mode answer", () => {
  async function asked() {
    const w = world({});
    w.db.addGroup(
      "trip",
      [{ phone: PEOPLE.Joe }, { phone: PEOPLE.Kian }],
      "pending",
    );
    await w.wait(1000);
    for (const [phone, name] of [
      [PEOPLE.Joe, "joe"],
      [PEOPLE.Kian, "kian"],
    ] as const) {
      w.advance(1000);
      await processMessage(
        w.ctx,
        w.db.ingest({ sender_phone: phone, group_id: "trip", text: name }),
      );
    }
    expect(w.db.outbox().some((o) => o.action_id === "settle_mode:trip")).toBe(
      true,
    );
    const reply = async (text: string, after = 1000) => {
      w.advance(after);
      await processMessage(
        w.ctx,
        w.db.ingest({ sender_phone: PEOPLE.Kian, group_id: "trip", text }),
      );
      return w.db.outbox().find((o) => o.action_id === "settle_mode_set:trip")
        ?.text;
    };
    return { w, reply };
  }

  it("understands a no-trip answer as a running tab, and confirms it", async () => {
    const { w, reply } = await asked();
    expect(
      await reply(
        "nah we are just adding it for friend expenses in the long run",
      ),
    ).toBe('bet, running tab it is\nsay "settle up" whenever');
    expect(w.db.settings.get("trip")).toBe("ledger"); // stored, not just the default
  });

  it("still takes the answer half a minute later in DEMO_MODE", async () => {
    // Harjyot's playground: Priya answered 34s after the question, but
    // DEMO_MODE had cut the answer window to 20s.
    const { w, reply } = await asked();
    expect(
      await reply(
        "nah we are just keeping a ledger for the long run and we will settle it every month",
        34_000,
      ),
    ).toBe('bet, running tab it is\nsay "settle up" whenever');
    expect(w.db.settings.get("trip")).toBe("ledger"); // stored, not just the default
  });

  it('confirms "each"', async () => {
    const { w, reply } = await asked();
    expect(await reply("each")).toBe("bet, i'll settle up after each one");
    expect(w.db.settleMode("trip")).toBe("per_expense");
  });

  it("stays quiet on unrelated chatter", async () => {
    const { reply } = await asked();
    expect(await reply("who's driving tonight")).toBeUndefined();
  });
});

describe("balance questions by DM", () => {
  it("answers someone in two groups, adding up what they owe each person", async () => {
    const w = world(script);
    w.db.addGroup("trip", [
      { phone: PEOPLE.Joe, name: "Joe" },
      { phone: PEOPLE.Kian, name: "Kian" },
    ]);
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    await w.dm("Kian", "what do i owe");
    expect(
      w.db.outbox().find((o) => o.purpose === "balance_reply"),
    ).toMatchObject({
      kind: "dm",
      to_phone: PEOPLE.Kian,
      text: "you owe joe $10.00",
    });
  });
});

describe("no lock-in under Tab's question (Joe's review on #30)", () => {
  it('holds a split while "What\'s uneven?" is unanswered', async () => {
    const w = world({ expense: { ...script.expense, "adjustment|not even": raw(null, null, "unknown") } });
    await w.say("Joe", "got pizza, $40");
    await w.say("Kian", "not even");
    expect(w.said("clarifying_question")).toEqual(["ok what was uneven?"]);
    await w.wait(31_000);
    expect(w.db.expenses()[0]!.status).toBe("proposed");
  });
});

describe("let's settle up with something still open", () => {
  it("locks in a split still open for changes and asks to settle it", async () => {
    // "settle it now lol" used to get "isn't locked in yet", and "yeah
    // lock it in" after that went nowhere.
    const w = world(script);
    await w.say("Joe", "got pizza, $40");
    await w.say("Kian", "let's settle up");
    expect(w.said("balance_reply")).toEqual([]);
    expect(w.db.expenses()[0]!.status).toBe("finalized");
    expect(w.said("settle_request")).toHaveLength(1);
  });
});

describe("changing a locked-in expense (§7.7)", () => {
  it("asks before reopening one nobody has paid, then re-splits it", async () => {
    const w = world(script);
    cokeIsAnAdjustment(w);
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    const id = `exp_${pizza.message_id}`;
    expect(w.db.expense(id)!.status).toBe("finalized");
    await w.say("Kian", COKE);
    expect(w.said("clarifying_question")).toEqual([
      "pizza is already locked in, reopen it and change the split?",
    ]);
    await w.say("Kian", "yes");
    expect(w.db.expense(id)).toMatchObject({
      status: "proposed",
      settle_message_id: undefined,
    });
    expect(
      w.db.shares(id).find((s) => s.phone === PEOPLE.Jake)!.amount_cents,
    ).toBe(300);
    await w.wait(31_000);
    expect(w.db.expense(id)!.status).toBe("finalized"); // locks in again
  });

  it("posts a new settle request after reopening in per-expense mode", async () => {
    const w = world(script);
    cokeIsAnAdjustment(w);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    await w.say("Kian", COKE);
    await w.say("Kian", "yes");
    await w.wait(31_000);
    expect(w.said("settle_request")).toHaveLength(2);
    expect(w.said("settle_request")[1]).toMatch(/jake \$3\.00/i);
  });

  it("explains it can't change one that's already being paid", async () => {
    const w = world(script);
    cokeIsAnAdjustment(w);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    await w.react("Priya", `settle_request:exp_${pizza.message_id}`);
    await w.say("Kian", COKE);
    expect(w.said("clarifying_question")).toEqual([
      "pizza is already being paid, so i can't change it\njust log the difference as a new expense",
    ]);
  });
});
