// Fixes from the noise eval (fixtures/noise, scripts/noise-eval.ts): an open
// question no longer swallows a new expense, half-sure guesses and settle-up
// talk stay quiet, and a correction must match the expense it changes.
import { describe, expect, it } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { answer, toolClient, world, type Script } from "./support/harness.js";

const raw = (cents: number | null, description: string | null, over: object = {}) => ({
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

function gateSays(w: ReturnType<typeof world>, verdicts: Record<string, [Intent, number]>) {
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : stubClassifier(input);
  };
}

// A money brain that would answer anything; tests check it is never asked.
function chattyAgent(w: ReturnType<typeof world>) {
  const clock = { now: 0 };
  const t = toolClient([{ reply: "i don't see that on the tab" }], clock);
  w.ctx.ask = { client: t.client, model: "m", clock: () => clock.now };
  return t;
}

const repliesTo = (w: ReturnType<typeof world>, message_id: string) =>
  w.db.outbox().filter((o) => o.target_message_id === message_id && o.kind !== "reaction");

const CAB = "yo I paid the cab from jfk, came out to 68 bucks";
const script: Script = {
  expense: {
    "new|pizza was $48 lol": raw(4800, "Pizza", { payer: "unknown" }),
    [`new|${CAB}`]: raw(6800, "Cab"),
  },
};

async function askWhoPaid(w: ReturnType<typeof world>) {
  const pizza = await w.say("Priya", "pizza was $48 lol");
  await w.say("Priya", "yes");
  expect(w.said("clarifying_question").at(-1)).toBe("who paid for the pizza?");
  return pizza;
}

describe("open questions don't swallow new messages", () => {
  it("logs a new expense the gate is sure about, even from the person Tab asked", async () => {
    const w = world(script);
    const pizza = await askWhoPaid(w);
    gateSays(w, { [CAB]: ["expense", 0.96] });
    const cab = await w.say("Priya", CAB);
    expect(w.db.expense(`exp_${cab.message_id}`)).toMatchObject({ status: "proposed", total_cents: 6800, description: "Cab" });
    expect(w.db.expense(`exp_${pizza.message_id}`)).toMatchObject({ status: "needs_info", payer_phone: undefined });
  });

  it("chatter the gate is sure about gets no follow-up while a question is open", async () => {
    const w = world(script);
    await askWhoPaid(w);
    gateSays(w, { "the sunset pics are unreal": ["ignore", 0.95] });
    const chat = await w.say("Priya", "the sunset pics are unreal");
    expect(repliesTo(w, chat.message_id)).toEqual([]);
  });
});

describe("quiet unless there's something to log", () => {
  it("a half-sure plan with no amount gets no question and no fallback", async () => {
    const w = world({});
    const t = chattyAgent(w);
    const text = "anyone wanna go in on a new coffee maker? the one we have is dying";
    gateSays(w, { [text]: ["expense", 0.57] });
    const m = await w.say("Joe", text);
    expect(repliesTo(w, m.message_id)).toEqual([]);
    expect(w.db.expenses()).toEqual([]);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("settle-up talk with nothing to match gets no reply", async () => {
    const w = world({});
    const t = chattyAgent(w);
    const text = "i venmo'd marcus 35 for the parking last week btw";
    gateSays(w, { [text]: ["payment_reported", 1] });
    const m = await w.say("Joe", text);
    expect(repliesTo(w, m.message_id)).toEqual([]);
    expect(t.create).not.toHaveBeenCalled();
  });
});

describe("unsure guesses that still get a word", () => {
  it("a half-sure purchase with an amount still asks", async () => {
    const w = world({});
    const text = "oh i filled it up too, $41";
    gateSays(w, { [text]: ["expense", 0.65] });
    const m = await w.say("Joe", text);
    expect(repliesTo(w, m.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
  });

  it("a purchase on someone's card, or a clear cost just under the clarify bar, asks too", async () => {
    const w = world({});
    const card = "lol i put the first round on my card, 68";
    const bill = "got the bill, came to 67 total";
    gateSays(w, { [card]: ["expense", 0.84], [bill]: ["expense", 0.41] });
    const a = await w.say("Joe", card);
    const b = await w.say("Priya", bill);
    expect(repliesTo(w, a.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
    expect(repliesTo(w, b.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
  });

  it("an unsure money question is answered only when it's put to Tab", async () => {
    const w = world({});
    const t = chattyAgent(w);
    gateSays(w, { "lol how much was the soap alone": ["money_question", 0.6], "tab how much do i owe": ["money_question", 0.6] });
    const roommate = await w.say("Joe", "lol how much was the soap alone");
    expect(repliesTo(w, roommate.message_id)).toEqual([]);
    expect(t.create).not.toHaveBeenCalled();
    await w.say("Joe", "tab how much do i owe");
    expect(t.create).toHaveBeenCalled();
  });
});

describe("corrections match the expense they change", () => {
  it("asks which one when the old amount isn't the expense Grok picked", async () => {
    const SURF = "i paid for the surfboard rentals btw, $120 for all of us";
    const FIX = "wait the tacos were actually 62 not 55";
    const w = world({ expense: { [`new|${SURF}`]: raw(12000, "Surfboard rentals") }, correction: {} });
    gateSays(w, { [SURF]: ["expense", 1] });
    const surf = await w.say("Joe", SURF);
    const id = `exp_${surf.message_id}`;
    w.ctx.extract.correction = async () => ({
      result: { target_expense_id: id, new_amount_cents: 6200, new_description: "Tacos", unclear: false },
      problems: [],
    });
    gateSays(w, { [FIX]: ["correction", 0.99] });
    await w.say("Priya", FIX);
    expect(w.db.expense(id)).toMatchObject({ total_cents: 12000, description: "Surfboard rentals" });
    expect(w.said("clarifying_question").at(-1)).toBe("which one? reply to the expense you mean");
  });
});

describe("corrections find the expense by its old amount (noise eval, round 2)", () => {
  const TACOS = "dinner at that taco truck was $55 total";
  const SURF = "i paid for the surfboard rentals btw, $120 for all of us";
  const FIX = "wait the tacos were actually 62 not 55";

  it("moves to the $55 expense when Grok picked another one", async () => {
    const w = world({
      expense: { [`new|${TACOS}`]: raw(5500, "Taco truck dinner"), [`new|${SURF}`]: raw(12000, "Surfboard rentals") },
      correction: {},
    });
    gateSays(w, { [TACOS]: ["expense", 1], [SURF]: ["expense", 1], [FIX]: ["correction", 0.99] });
    const tacos = await w.say("Priya", TACOS);
    const surf = await w.say("Joe", SURF);
    w.ctx.extract.correction = async () => ({
      result: { target_expense_id: `exp_${surf.message_id}`, new_amount_cents: 6200, new_description: undefined, unclear: false },
      problems: [],
    });
    await w.say("Priya", FIX);
    expect(w.db.expense(`exp_${tacos.message_id}`)).toMatchObject({ total_cents: 6200 });
    expect(w.db.expense(`exp_${surf.message_id}`)).toMatchObject({ total_cents: 12000 });
  });

  it("an expense named after another doesn't take its correction", async () => {
    const SUPPLIES = "just grabbed party supplies, 87 total";
    const FOOD = "wings and pizza came out to 112";
    const OOPS = "the supplies were actually 76 not 87";
    const w = world({
      // Grok borrowed the supplies' name for the food order.
      expense: { [`new|${SUPPLIES}`]: raw(8700, "Party supplies"), [`new|${FOOD}`]: raw(11200, "Party supplies") },
      correction: {},
    });
    gateSays(w, { [SUPPLIES]: ["expense", 1], [FOOD]: ["expense", 1], [OOPS]: ["correction", 0.97] });
    const supplies = await w.say("Joe", SUPPLIES);
    const food = await w.say("Priya", FOOD);
    expect(w.db.expense(`exp_${food.message_id}`)!.description).toBe("Expense"); // no borrowed name
    w.ctx.extract.correction = async () => ({
      result: { target_expense_id: `exp_${food.message_id}`, new_amount_cents: 7600, new_description: undefined, unclear: false },
      problems: [],
    });
    await w.say("Joe", OOPS);
    expect(w.db.expense(`exp_${supplies.message_id}`)).toMatchObject({ total_cents: 7600 });
    expect(w.db.expense(`exp_${food.message_id}`)).toMatchObject({ total_cents: 11200 });
  });

  it('"wait i thought it was 200" right after an expense asks to change it, and a yes does', async () => {
    const DJ = "i just paid the dj $250 cash";
    const THOUGHT = "wait i thought it was 200";
    const w = world({ expense: { [`new|${DJ}`]: raw(25000, "DJ") }, correction: {} });
    const t = chattyAgent(w);
    gateSays(w, { [DJ]: ["expense", 1], [THOUGHT]: ["correction", 0.85], yes: ["answer", 0.9] });
    const dj = await w.say("Joe", DJ);
    w.ctx.extract.correction = async () => ({
      result: { target_expense_id: undefined, new_amount_cents: 20000, new_description: undefined, unclear: false },
      problems: [],
    });
    await w.say("Priya", THOUGHT);
    expect(w.said("clarifying_question").at(-1)).toBe("change dj to $200.00?");
    expect(t.create).not.toHaveBeenCalled(); // not the money brain's "got it"
    await w.say("Priya", "yes");
    expect(w.db.expense(`exp_${dj.message_id}`)).toMatchObject({ total_cents: 20000 });
  });

  it("never names an expense after its amount", async () => {
    const w = world({ expense: { "new|came out to like 42": raw(4200, "came out") } });
    gateSays(w, { "came out to like 42": ["expense", 1] });
    const m = await w.say("Joe", "came out to like 42");
    expect(w.db.expense(`exp_${m.message_id}`)!.description).toBe("Expense");
  });
});

describe("chatter that isn't for Tab (noise eval, round 2)", () => {
  it("an unsure 'ignore' on the sender's own purchase with an amount gets one question", async () => {
    const w = world({});
    const a = "i got a big pack at target earlier, 18 bucks";
    const b = "they're doing a deal, got 12 tacos for $28";
    gateSays(w, { [a]: ["ignore", 0.46], [b]: ["ignore", 0.66], "lmao same": ["ignore", 0.5] });
    const ma = await w.say("Joe", a);
    const mb = await w.say("Priya", b);
    const mc = await w.say("Kian", "lmao same");
    expect(repliesTo(w, ma.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
    expect(repliesTo(w, mb.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
    expect(repliesTo(w, mc.message_id)).toEqual([]);
  });

  it("a bill's total read as an unsure correction, with nothing to correct, gets the question", async () => {
    const w = world({});
    const text = "got the bill, came to 67 total";
    gateSays(w, { [text]: ["correction", 0.43], "or was it 50": ["correction", 0.43] });
    const m = await w.say("Joe", text);
    const n = await w.say("Joe", "or was it 50");
    expect(repliesTo(w, m.message_id).map((o) => o.text)).toEqual(["want me to split that?"]);
    expect(repliesTo(w, n.message_id)).toEqual([]);
  });

  it('"got it thanks" from the person Tab asked is not their answer', async () => {
    const w = world(script);
    const pizza = await askWhoPaid(w);
    gateSays(w, { "got it thanks": ["ignore", 0.78] });
    const m = await w.say("Priya", "got it thanks");
    expect(m.status).toBe("done");
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("needs_info");
  });

  it("a yeah right after a friend's question answers the friend, not Tab", async () => {
    const w = world(script);
    await w.say("Priya", "pizza was $48 lol");
    expect(w.said("clarifying_question")).toEqual(["want me to split that?"]);
    gateSays(w, { "oh shit fr?": ["ignore", 0.67], "yeah sorry i forgot to mention": ["answer", 0.5] });
    await w.say("Kian", "oh shit fr?");
    await w.say("Priya", "yeah sorry i forgot to mention");
    expect(w.said("clarifying_question")).toEqual(["want me to split that?"]);
    expect(w.db.expenses()).toEqual([]);
    // Said straight to Tab's question, the same yes works.
    await w.say("Priya", "yes");
    expect(w.said("clarifying_question").at(-1)).toBe("who paid for the pizza?");
  });

  it('"for all of us right?" to a split is a question for the payer, not an objection', async () => {
    const PIZZA = "got pizza, $40";
    const ASK = "for all of us right?";
    const w = world({ expense: { [`new|${PIZZA}`]: raw(4000, "Pizza") }, answer: { [ASK]: answer({ thread_id: "q1", relevance: 0.9, yes_no: false }) } });
    gateSays(w, { [PIZZA]: ["expense", 1], [ASK]: ["answer", 0.85] });
    await w.say("Joe", PIZZA);
    const m = await w.say("Kian", ASK);
    expect(repliesTo(w, m.message_id)).toEqual([]);
    expect(w.said("clarifying_question")).toEqual([]);
  });

  it("an unsure 'answer' with nothing to answer gets no money-brain question", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    const t = chattyAgent(w);
    gateSays(w, { "got pizza, $40": ["expense", 1], fr: ["answer", 0.54], "its on the fridge": ["answer", 0.54] });
    await w.say("Joe", "got pizza, $40");
    const a = await w.say("Kian", "fr");
    const b = await w.say("Priya", "its on the fridge");
    expect(repliesTo(w, a.message_id)).toEqual([]);
    expect(repliesTo(w, b.message_id)).toEqual([]);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("a question between friends about the bill gets no breakdown", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    const q = "wait was the calamari part of the apps or the entrees";
    gateSays(w, { "got pizza, $40": ["expense", 1], [q]: ["breakdown_request", 0.93] });
    await w.say("Joe", "got pizza, $40");
    const m = await w.say("Priya", q);
    expect(repliesTo(w, m.message_id)).toEqual([]);
  });

  it('never logs a split where only the payer owes ("venmo me 45 whenever")', async () => {
    const text = "legend ty priya, venmo me 45 whenever";
    const w = world({ expense: { [`new|${text}`]: raw(4500, "Bill", { fixed: [{ name: "me", amount_cents: 4500, item: null, only: false }] }) } });
    gateSays(w, { [text]: ["expense", 0.87] });
    const m = await w.say("Joe", text);
    expect(w.db.expenses()).toEqual([]);
    expect(repliesTo(w, m.message_id)).toEqual([]);
  });
});

describe("correcting an expense Tab is still asking about", () => {
  it("takes the new amount now, and keeps it when the question is answered", async () => {
    const TACOS = "dinner at that taco truck was $55 total";
    const FIX = "wait the tacos were actually 62 not 55";
    const w = world({
      expense: {
        [`new|${TACOS}`]: raw(5500, "Taco truck dinner", { payer: "unknown" }),
        [`new|${TACOS}\n${FIX}\nyes`]: raw(6200, "Taco truck dinner"),
      },
      correction: {},
    });
    gateSays(w, { [TACOS]: ["expense", 0.9], [FIX]: ["correction", 0.99] });
    const tacos = await w.say("Priya", TACOS);
    const id = `exp_${tacos.message_id}`;
    expect(w.said("clarifying_question").at(-1)).toBe("who paid for the taco truck dinner?");
    w.ctx.extract.correction = async () => ({ result: { target_expense_id: undefined, new_amount_cents: 6200, new_description: undefined, unclear: false }, problems: [] });
    await w.say("Priya", FIX);
    expect(w.db.expense(id)).toMatchObject({ status: "needs_info", total_cents: 6200 });
    // Her answer re-reads the whole thing, correction included.
    gateSays(w, { yes: ["answer", 0.9] });
    w.ctx.extract.expense = async (input, mode) => {
      const key = `${mode}|${input.message.text}`;
      if (key !== `new|${TACOS}\n${FIX}\nyes`) throw new Error(`unexpected ${JSON.stringify(key)}`);
      return { result: { is_expense: true, amount_cents: 6200, description: "Taco truck dinner", payer: { kind: "sender" }, participants: { kind: "everyone" }, exclusions: [], fixed: [], missing: [] }, problems: [] };
    };
    await w.say("Priya", "yes");
    expect(w.db.expense(id)).toMatchObject({ status: "proposed", total_cents: 6200, payer_phone: "+15555550104" });
  });
});
