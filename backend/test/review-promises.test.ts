// Regressions from the independent review of the site-promises branch
// (PR #82): each test is one finding that was reproduced, then fixed.
import { describe, expect, it, vi } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { timing } from "../src/config.js";
import { GROUP, PEOPLE, world, type Name } from "./support/harness.js";

const raw = (cents: number, description: string, over: object = {}) => ({
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
  ...over,
});

type W = ReturnType<typeof world>;
const gateSays = (w: W, verdicts: Record<string, [Intent, number]>) => {
  const before = w.ctx.classify;
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : before(input);
  };
};
const dmsTo = (w: W, who: Name) => w.db.outbox().filter((o) => o.kind === "dm" && o.to_phone === PEOPLE[who] && o.status !== "cancelled");
const share = (w: W, id: string, who: Name) => w.db.shares(id).find((s) => s.phone === PEOPLE[who])!;
const link = (w: W, debtor: Name, payee: Name) =>
  w.db.outbox().filter((o) => o.purpose === "payment_link" && o.action_id.startsWith(`payment_link:${PEOPLE[debtor]}:${PEOPLE[payee]}|`)).at(-1)!;

const script = {
  expense: {
    "new|got pizza, $40": raw(4000, "Pizza"),
    "new|got groceries, $60": raw(6000, "Groceries"),
    "new|got uber, $16": raw(1600, "Uber"),
    "new|got snacks, $15": raw(1500, "Snacks"),
    "new|paid rent, $2400": raw(240000, "Rent"),
  },
};

// Joe's pizza ($10 each) and Kian's groceries ($15 each), both settled up.
async function twoPayees(w: W) {
  w.ctx.payments = "links";
  await w.ctx.db.set_payment_handle({ phone: PEOPLE.Joe, venmo: "joe-smith" });
  await w.ctx.db.set_payment_handle({ phone: PEOPLE.Kian, venmo: "kian-l" });
  const pizza = await w.say("Joe", "got pizza, $40");
  const groceries = await w.say("Kian", "got groceries, $60");
  await w.wait(31_000);
  await w.say("Priya", "let's settle up");
  return { pizza: `exp_${pizza.message_id}`, groceries: `exp_${groceries.message_id}` };
}

describe("review of the site-promises branch", () => {
  it("a correction that names an expense asks, instead of changing another one at the old amount", async () => {
    const w = world({ ...script, correction: {} });
    const fix = "the uber was 18 not 15";
    gateSays(w, { "got uber, $16": ["expense", 1], "got snacks, $15": ["expense", 1], [fix]: ["correction", 0.95] });
    const uber = await w.say("Joe", "got uber, $16");
    const snacks = await w.say("Kian", "got snacks, $15");
    w.ctx.extract.correction = async () => ({ result: { target_expense_id: `exp_${uber.message_id}`, new_amount_cents: 1800, new_description: undefined, unclear: false }, problems: [] });
    await w.say("Joe", fix);
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(1600);
    expect(w.db.expense(`exp_${snacks.message_id}`)!.total_cents).toBe(1500);
    expect(w.said("clarifying_question").at(-1)).toBe("which one? reply to the expense you mean");
  });

  it('"sent" after "Joe doesn\'t see it yet" goes back to Joe, not the newest link', async () => {
    const w = world(script);
    await twoPayees(w);
    await w.react("Priya", link(w, "Priya", "Joe").action_id);
    await w.dm("Joe", "nope not yet");
    await w.dm("Priya", "ok sent");
    expect(dmsTo(w, "Kian").filter((o) => o.purpose === "payment_check")).toEqual([]);
    expect(dmsTo(w, "Joe").filter((o) => o.purpose === "payment_check" && o.action_id.startsWith("payment_check:"))).toHaveLength(2);
  });

  it("mixed answers aren't taken, and with two payments waiting the payee taps the one they mean", async () => {
    const w = world(script);
    const { pizza } = await twoPayees(w);
    await w.react("Priya", link(w, "Priya", "Joe").action_id);
    await w.dm("Joe", "yea not yet");
    expect(share(w, pizza, "Priya").status).toBe("approved");
    await w.react("Jake", link(w, "Jake", "Joe").action_id);
    await w.dm("Joe", "got it");
    expect(share(w, pizza, "Priya").status).toBe("approved");
    expect(share(w, pizza, "Jake").status).toBe("approved");
    expect(dmsTo(w, "Joe").at(-1)!.text).toBe("a couple payments are waiting on you, tap 👍 or 👎 on the one you mean");
  });

  it('"priya paid me back 25 for the concert tickets" doesn\'t settle her pizza share', async () => {
    const w = world(script);
    const { pizza } = await twoPayees(w);
    const text = "priya paid me back 25 for the concert tickets";
    gateSays(w, { [text]: ["payment_reported", 0.95] });
    await w.say("Joe", text);
    expect(share(w, pizza, "Priya").status).toBe("locked");
  });

  it('"priya and jake paid me" pays both, and each gets their own receipt', async () => {
    const w = world(script);
    const { pizza } = await twoPayees(w);
    gateSays(w, { "priya and jake paid me": ["payment_reported", 0.95] });
    await w.say("Joe", "priya and jake paid me");
    expect(share(w, pizza, "Priya").status).toBe("paid");
    expect(share(w, pizza, "Jake").status).toBe("paid");
    await w.wait(1000);
    expect(dmsTo(w, "Priya").at(-1)!.text).toBe("Joe got your $10.00 for pizza");
    expect(dmsTo(w, "Jake").at(-1)!.text).toBe("Joe got your $10.00 for pizza");
  });

  it("an expense waiting on a large-amount confirmation is never dropped", async () => {
    const w = world(script, new Date("2026-10-03T22:00:00Z"));
    w.ctx.timing = timing({});
    gateSays(w, { "paid rent, $2400": ["expense", 0.95] });
    const rent = await w.say("Joe", "paid rent, $2400");
    expect(w.db.expense(`exp_${rent.message_id}`)!.status).toBe("needs_info");
    for (let i = 0; i < 20; i++) await w.wait(6 * 3_600_000);
    expect(w.db.expense(`exp_${rent.message_id}`)!.status).toBe("needs_info");
  });

  it("the link from a settle request after a dispute can be 👍'd", async () => {
    const w = world(script);
    const { pizza } = await twoPayees(w);
    await w.react("Jake", link(w, "Jake", "Joe").action_id, "dislike");
    expect(share(w, pizza, "Jake").status).toBe("disputed");
    await w.dm("Jake", "i only had $4");
    expect(share(w, pizza, "Jake")).toMatchObject({ status: "locked", amount_cents: 400 });
    const fresh = link(w, "Jake", "Joe");
    expect(fresh.text).toMatch(/^you owe Joe \$4\.00 for pizza/);
    await w.react("Jake", fresh.action_id);
    expect(share(w, pizza, "Jake").status).toBe("approved");
  });

  it("deleting a payee's data scrubs their number from ids and their handle from texts others got", async () => {
    const w = world(script);
    await twoPayees(w);
    await w.dm("Joe", "delete my data");
    await w.dm("Joe", "DELETE");
    const phone = PEOPLE.Joe;
    expect(w.db.outbox().filter((o) => o.action_id.includes(phone) && !o.action_id.startsWith("forgotten:"))).toEqual([]);
    expect(w.db.outbox().filter((o) => o.text?.includes("joe-smith"))).toEqual([]);
    expect(w.db.messages().filter((m) => m.message_id.includes(phone) || m.sender_phone === phone)).toEqual([]);
    expect(w.db.transfers().filter((t) => t.transfer_id.includes(phone))).toEqual([]);
    // Reminders afterwards are only about debts to Kian, never "someone who left".
    for (let i = 0; i < 5; i++) await w.wait(200_000);
    const reminders = w.db.outbox().filter((o) => o.purpose === "approval_followup" && o.status !== "cancelled");
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((o) => o.action_id.includes(`:${PEOPLE.Kian}|`))).toBe(true);
    expect(reminders.filter((o) => o.text?.includes("someone who left"))).toEqual([]);
  });

  it("asks nothing again and again of a payee who texted STOP", async () => {
    const w = world(script);
    await twoPayees(w);
    await w.react("Priya", link(w, "Priya", "Joe").action_id);
    await w.dm("Joe", "STOP");
    const enqueue = vi.spyOn(w.ctx.db, "enqueue_outbox");
    for (let i = 0; i < 5; i++) await w.wait(200_000);
    expect(enqueue.mock.calls.filter(([a]) => a.to_phone === PEOPLE.Joe)).toEqual([]);
    expect(GROUP).toBe("house");
  });
});
