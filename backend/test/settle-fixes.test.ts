// The backend on the module's settle storage (#22): settle mode stored by
// set_settle_mode, one 👍 paying every share it covers, and resolve_dispute.
import { describe, expect, it, vi } from "vitest";
import { Memory, type BrainCtx } from "../src/brain/context.js";
import { disputeCents, processMessage, tick } from "../src/brain/process.js";
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

const script = {
  expense: {
    "new|got pizza, $40": raw(4000, "Pizza"),
    "new|got groceries, $60": raw(6000, "Groceries"),
  },
};

// Joe's $40 pizza, $10 each, locked in.
async function pizza(w: ReturnType<typeof world>) {
  const m = await w.say("Joe", "got pizza, $40");
  await w.wait(31_000); // past the demo objection window
  return `exp_${m.message_id}`;
}

// Pizza (Joe) and groceries (Priya, $15 each), in one ledger request.
async function ledgerRequest(w: ReturnType<typeof world>) {
  const p = await pizza(w);
  const g = await w.say("Priya", "got groceries, $60");
  await w.wait(31_000);
  const settle = await w.say("Kian", "let's settle up");
  return { pizza: p, groceries: `exp_${g.message_id}`, request: `settle_request:${GROUP}:${settle.message_id}` };
}

const share = (w: ReturnType<typeof world>, expense_id: string, who: keyof typeof PEOPLE) =>
  w.db.shares(expense_id).find((s) => s.phone === PEOPLE[who])!;

describe("settle mode is stored in the module (set_settle_mode)", () => {
  it('writes "each" through the reducer, and a restarted backend still reads it', async () => {
    const w = world(script);
    w.db.addGroup("trip", [{ phone: PEOPLE.Joe }, { phone: PEOPLE.Kian }], "pending");
    await tick(w.ctx);
    for (const [who, text] of [[PEOPLE.Joe, "joe"], [PEOPLE.Kian, "kian"], [PEOPLE.Kian, "each"]] as const) {
      w.advance(1000);
      await processMessage(w.ctx, w.db.ingest({ sender_phone: who, group_id: "trip", text }));
    }
    expect(w.db.settings.get("trip")).toBe("per_expense");

    // A restart loses process memory, not the group's choice.
    const restarted: BrainCtx = { ...w.ctx, memory: new Memory() };
    expect(restarted.store.settleMode("trip")).toBe("per_expense");
    expect(restarted.store.settleMode(GROUP)).toBe("ledger"); // never chose
  });

  it("settles per expense when the stored mode says so, and waits for settle up otherwise", async () => {
    const w = world(script);
    await pizza(w);
    expect(w.said("settle_request")).toEqual([]); // ledger by default

    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    await w.say("Priya", "got groceries, $60");
    await w.wait(31_000);
    const requests = w.said("settle_request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("Cool, here's what's owed to Priya for Groceries:\nJoe $15.00, Kian $15.00, Jake $15.00.");
  });

  it("rejects an unknown group or mode, like the module", async () => {
    const w = world(script);
    await expect(w.ctx.db.set_settle_mode({ group_id: "nope", settle_mode: "ledger" })).rejects.toThrow("Unknown group");
    await expect(
      w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "weekly" as "ledger" }),
    ).rejects.toThrow("Invalid settle mode");
  });
});

describe("one 👍 pays every share the request covers", () => {
  it("creates one transfer per expense with the same approval, and a repeat 👍 pays nothing twice", async () => {
    const w = world(script);
    const { pizza: p, groceries: g, request } = await ledgerRequest(w);
    await w.react("Jake", request);
    const transfers = () => w.db.transfers().map((t) => [t.expense_id, t.to_phone, t.amount_cents]);
    expect(transfers()).toEqual([
      [p, PEOPLE.Joe, 1000],
      [g, PEOPLE.Priya, 1500],
    ]);
    expect(new Set(w.db.transfers().map((t) => t.approved_by_message_id)).size).toBe(1);

    // The same reaction delivered again (a retry) is deduped per expense.
    const reaction = w.db.messages().filter((m) => m.kind === "reaction").at(-1)!;
    await processMessage(w.ctx, reaction);
    expect(transfers()).toHaveLength(2);

    w.db.completeTransfers();
    await w.wait(1000);
    expect(w.said("payment_receipt")).toEqual([
      "Simulated settlement complete: you paid Joe $10.00 and Priya $15.00. All square.",
    ]);
  });
});

describe("disputes are resolved with resolve_dispute (SPEC 7.6)", () => {
  it("changes only the disputer's amount, the payer absorbs it, and they get a new request", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const p = await pizza(w);
    await w.react("Priya", `settle_request:${p}`); // already approved: untouched
    await w.react("Kian", `settle_request:${p}`, "dislike");
    expect(share(w, p, "Kian").status).toBe("disputed");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");

    await w.dm("Kian", "I only had a $4 slice");
    expect(resolve).toHaveBeenCalledWith({ expense_id: p, phone: PEOPLE.Kian, amount_cents: 400 });
    expect(
      Object.fromEntries((["Joe", "Kian", "Priya", "Jake"] as const).map((who) => [who, [share(w, p, who).amount_cents, share(w, p, who).status]])),
    ).toEqual({
      Joe: [1600, "locked"],
      Kian: [400, "locked"],
      Priya: [1000, "approved"],
      Jake: [1000, "locked"],
    });
    const fresh = w.db.outbox().filter((o) => o.purpose === "settle_request").at(-1)!;
    expect(fresh.action_id).not.toBe(`settle_request:${p}`);
    expect(fresh.text).toContain("Kian $4.00, Jake $10.00.");
    expect(w.db.expense(p)!.settle_message_id).toBe(fresh.action_id);
    expect(w.db.outbox().find((o) => o.action_id.startsWith("dispute_resolved:"))).toMatchObject({
      kind: "dm",
      to_phone: PEOPLE.Kian,
      text: "Fixed: you're down for $4.00 for Pizza. Tap 👍 on the new settle request to pay.",
    });

    await w.react("Kian", fresh.action_id);
    expect(w.db.transfers().find((t) => t.from_phone === PEOPLE.Kian)).toMatchObject({ amount_cents: 400, to_phone: PEOPLE.Joe });
  });

  it("asks which one when the dispute covered several expenses", async () => {
    const w = world(script);
    const { pizza: p, groceries: g, request } = await ledgerRequest(w);
    await w.react("Kian", request, "dislike");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");

    await w.dm("Kian", "I had $5");
    expect(resolve).not.toHaveBeenCalled();
    expect(w.db.outbox().at(-1)!.text).toBe("Which one?\n1. Pizza ($10.00)\n2. Groceries ($15.00)");

    await w.dm("Kian", "2");
    expect(resolve).toHaveBeenCalledWith({ expense_id: g, phone: PEOPLE.Kian, amount_cents: 500 });
    expect(share(w, g, "Priya").amount_cents).toBe(2500);
    expect(share(w, p, "Kian").status).toBe("disputed"); // still open to an answer

    await w.dm("Kian", "and $8 for pizza");
    expect(resolve).toHaveBeenLastCalledWith({ expense_id: p, phone: PEOPLE.Kian, amount_cents: 800 });
  });

  it("asks again, writing nothing, when the payer's share can't absorb the amount", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const p = await pizza(w);
    await w.react("Kian", `settle_request:${p}`, "dislike");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");

    await w.dm("Kian", "it was $25");
    expect(resolve).not.toHaveBeenCalled();
    expect(w.db.outbox().at(-1)!.text).toBe("Your part of Pizza can be at most $20.00. What did you actually have?");
    expect(share(w, p, "Kian")).toMatchObject({ status: "disputed", amount_cents: 1000 });

    await w.dm("Kian", "ok $12");
    expect(resolve).toHaveBeenCalledWith({ expense_id: p, phone: PEOPLE.Kian, amount_cents: 1200 });
  });

  it("leaves a resolved share on the running tab when there was no request to approve", async () => {
    const w = world(script);
    const p = await pizza(w); // ledger: no settle request yet
    await w.say("Kian", "no");
    expect(share(w, p, "Kian").status).toBe("disputed");
    await w.say("Kian", "mine was 6 bucks");
    expect(share(w, p, "Kian")).toMatchObject({ status: "locked", amount_cents: 600 });
    expect(w.said("settle_request")).toEqual([]);
    expect(w.said("dispute_followup").at(-1)).toBe("fixed: you're down for $6.00 for pizza");
  });

  // Joe's review on #29: a count is not a price.
  it.each([["I had 2 beers"], ["only 1 slice"]])("writes nothing for a count: %s", async (text) => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const p = await pizza(w);
    await w.react("Kian", `settle_request:${p}`, "dislike");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");
    await w.dm("Kian", text); // falls through to normal handling
    expect(resolve).not.toHaveBeenCalled();
    expect(share(w, p, "Kian")).toMatchObject({ status: "disputed", amount_cents: 1000 });
  });

  it.each([
    ["$4", 400],
    ["4", 400],
    ["it was 4.50", 450],
    ["4 bucks", 400],
  ])("resolves a clear amount of money (case %#)", async (text, cents) => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const p = await pizza(w);
    await w.react("Kian", `settle_request:${p}`, "dislike");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");
    await w.dm("Kian", text);
    expect(resolve).toHaveBeenCalledWith({ expense_id: p, phone: PEOPLE.Kian, amount_cents: cents });
    expect(share(w, p, "Kian")).toMatchObject({ status: "locked", amount_cents: cents });
  });

  it("reads only clear money as a dispute amount", () => {
    const read = (t: string) => disputeCents(t);
    expect([read("$4"), read("4"), read("$ 4.50"), read("4.50"), read("it was 4.50"), read("4 bucks"), read("12 dollars"), read("1,240"), read("4.5")]).toEqual([
      400, 400, 450, 450, 450, 400, 1200, 124000, 450,
    ]);
    for (const t of ["I had 2 beers", "only 1 slice", "2 of the 3 pizzas", "i had 1.5 slices of 8", "table 12"])
      expect(read(t)).toBeUndefined();
  });

  it("ignores someone else's amount", async () => {
    const w = world(script);
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    const p = await pizza(w);
    await w.say("Kian", "no");
    const resolve = vi.spyOn(w.ctx.db, "resolve_dispute");
    await w.say("Jake", "lol it was like $3");
    expect(resolve).not.toHaveBeenCalled();
    expect(share(w, p, "Kian").status).toBe("disputed");
  });
});
