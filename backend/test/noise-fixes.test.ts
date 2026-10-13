// Fixes from the noise eval (fixtures/noise, scripts/noise-eval.ts): an open
// question no longer swallows a new expense, half-sure guesses and settle-up
// talk stay quiet, and a correction must match the expense it changes.
import { describe, expect, it } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { toolClient, world, type Script } from "./support/harness.js";

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
