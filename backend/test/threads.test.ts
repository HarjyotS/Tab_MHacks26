// Tab's open questions (threads.ts) and how each message is routed through
// them (process.ts answerThreads): the playground failures from the session
// that asked for this, as tests.
import { describe, expect, it, vi } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { processMessage } from "../src/brain/process.js";
import { openThreads } from "../src/brain/threads.js";
import type { Message } from "../src/store/types.js";
import { answer, GROUP, PEOPLE, world, type Script } from "./support/harness.js";

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

// Jev's verdicts for messages the keyword stub can't read.
function gateSays(w: ReturnType<typeof world>, verdicts: Record<string, [Intent, number]>) {
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : stubClassifier(input);
  };
}

// Counts resolver calls, so tests can show when Grok is (not) asked.
function spyAnswers(w: ReturnType<typeof world>) {
  const real = w.ctx.extract.answer;
  const calls: string[] = [];
  w.ctx.extract.answer = (input, threads) => {
    calls.push(input.message.text ?? "");
    return real(input, threads);
  };
  return calls;
}

// A message in a group other than the harness's own.
async function sayIn(w: ReturnType<typeof world>, group_id: string, phone: string, text: string, extra: Partial<Message> = {}) {
  w.advance(1000);
  const m = w.db.ingest({ sender_phone: phone, group_id, text, ...extra });
  await processMessage(w.ctx, m);
  w.db.deliver();
  return w.db.msgs.get(m.message_id)!;
}

// A new two-person group that has just been asked the settle-mode question.
async function onboarded(w: ReturnType<typeof world>) {
  w.db.addGroup("trip", [{ phone: PEOPLE.Joe }, { phone: PEOPLE.Kian }], "pending");
  await w.wait(1000);
  await sayIn(w, "trip", PEOPLE.Joe, "joe");
  await sayIn(w, "trip", PEOPLE.Kian, "kian");
  expect(w.db.out.has("settle_mode:trip")).toBe(true);
}

const settleModeReply = (w: ReturnType<typeof world>) => w.db.out.get("settle_mode_set:trip")?.text;

const uber: Script["expense"] = {
  "new|venmo me for the uber": raw(null, "Uber"),
  "new|venmo me for the uber\n22": raw(2200, "Uber"),
  "new|venmo me for the pizza": raw(null, "Pizza"),
};

describe("several open questions at once", () => {
  it("keeps the settle question open while an expense question is asked, and takes a ledger answer to it", async () => {
    // Playground: "nah we are just keeping a ledger…" was missed once another
    // question had replaced the settle-mode one.
    const w = world({ expense: uber });
    await onboarded(w);
    const ride = await sayIn(w, "trip", PEOPLE.Joe, "venmo me for the uber");
    expect(w.db.outbox().map((o) => o.text)).toContain("how much was the uber?");
    await sayIn(w, "trip", PEOPLE.Kian, "nah we are just keeping a ledger for the long run and we will settle it every month");
    expect(settleModeReply(w)).toBe('got it, i\'ll keep a running tab. say "settle up" whenever');
    expect(w.db.settleMode("trip")).toBe("ledger");
    await sayIn(w, "trip", PEOPLE.Joe, "22");
    expect(w.db.expense(`exp_${ride.message_id}`)).toMatchObject({ status: "proposed", total_cents: 2200 });
  });

  it("answers two questions out of order", async () => {
    const w = world({
      expense: {
        ...uber,
        "new|pizza was $48 lol": raw(4800, "Pizza", { payer: "unknown" }),
      },
      // The gate passed Priya's pizza while "How much was the Uber?" is open
      // to anyone, so Grok is asked: it's no answer to it.
      answer: { "pizza was $48 lol": answer({ relevance: 0.02, also_new: true, also_intent: "expense" }) },
    });
    const ride = await w.say("Kian", "venmo me for the uber");
    const pizza = await w.say("Priya", "pizza was $48 lol");
    expect(w.said("clarifying_question").map((q) => q.toLowerCase())).toEqual(["how much was the uber?", "want me to split that?"]);
    await w.say("Kian", "22"); // the older question, after a newer one was asked
    expect(w.db.expense(`exp_${ride.message_id}`)).toMatchObject({ status: "proposed", total_cents: 2200 });
    await w.say("Priya", "yes");
    expect(w.said("clarifying_question").at(-1)!.toLowerCase()).toBe("who paid for the pizza?");
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("needs_info");
  });

  it("lets an inline reply pick the right one of two questions", async () => {
    // Kian's second expense is first tried as his answer to the first
    // question (as before threads); it doesn't help, so it's logged on its own.
    const w = world({ expense: { ...uber, "new|venmo me for the uber\nvenmo me for the pizza": raw(null, "Uber") } });
    const ride = await w.say("Kian", "venmo me for the uber");
    const pizza = await w.say("Kian", "venmo me for the pizza");
    const question = w.db.out.get(`clarify:${ride.message_id}`)!;
    await w.say("Kian", "22", { reply_to_id: question.sent_photon_id }); // the older one
    expect(w.db.expense(`exp_${ride.message_id}`)).toMatchObject({ status: "proposed", total_cents: 2200 });
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("needs_info");
  });

  it("forgets a question after PENDING_QUESTION_TTL", async () => {
    const w = world({ expense: uber });
    const calls = spyAnswers(w);
    const ride = await w.say("Kian", "venmo me for the uber");
    w.advance(w.ctx.timing.durations.PENDING_QUESTION_TTL + 1000);
    await w.say("Kian", "22");
    expect(w.db.expense(`exp_${ride.message_id}`)!.status).toBe("needs_info");
    expect(openThreads(w.ctx, { group_id: GROUP })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("free-form answers (Grok resolves them)", () => {
  it('takes "priya and jordan didnt go it was just me and alex" as a change to the open split', async () => {
    const JORDAN = "+15555550106";
    const ALEX = "+15555550107";
    const text = "priya and jordan didnt go it was just me and alex";
    const w = world({
      expense: {
        "new|got dinner, $80": raw(8000, "Dinner"),
        [`adjustment|${text}`]: raw(null, null, { payer: "unknown", exclusion_names: ["priya", "jordan"] }),
      },
      answer: { [text]: answer({ thread_id: "q1", relevance: 0.92, restated: "Priya and Jordan did not go; it was just Joe and Alex." }) },
    });
    w.db.addGroup("crew", [
      { phone: PEOPLE.Joe, name: "Joe" },
      { phone: PEOPLE.Priya, name: "Priya" },
      { phone: JORDAN, name: "Jordan" },
      { phone: ALEX, name: "Alex" },
    ]);
    gateSays(w, { [text]: ["answer", 0.9] });
    const dinner = await sayIn(w, "crew", PEOPLE.Joe, "got dinner, $80");
    const reply = await sayIn(w, "crew", PEOPLE.Joe, text);
    const shares = Object.fromEntries(w.db.shares(`exp_${dinner.message_id}`).map((s) => [s.phone, [s.status, s.amount_cents]]));
    expect(shares).toEqual({
      [PEOPLE.Joe]: ["proposed", 4000],
      [PEOPLE.Priya]: ["opted_out", 0],
      [JORDAN]: ["opted_out", 0],
      [ALEX]: ["proposed", 4000],
    });
    // Kept as an answer to Tab, so it stays in later context (§19).
    expect(reply).toMatchObject({ intent: "answer", text });
  });

  it('answers "how do we settle the bil or see the ledger?" sent as a reply to Tab\'s question, and keeps the question open', async () => {
    const text = "how do we settle the bil or see the ledger?";
    const w = world({});
    const calls = spyAnswers(w);
    await onboarded(w);
    gateSays(w, { [text]: ["help", 0.7] }); // Jev's live verdict on the reply
    const question = w.db.out.get("settle_mode:trip")!;
    const asked = await sayIn(w, "trip", PEOPLE.Kian, text, { reply_to_id: question.sent_photon_id });
    // It mentions the ledger, so the ledger handler (#32) answers it.
    expect(w.db.out.has(`ledger_link:${asked.message_id}`)).toBe(true);
    expect(calls).toEqual([]); // a question of their own is never read as an answer
    expect(settleModeReply(w)).toBeUndefined();
    await sayIn(w, "trip", PEOPLE.Kian, "each");
    expect(w.db.settleMode("trip")).toBe("per_expense");
  });

  it('applies the answer in "yep, and I also got gas $30" and logs the gas as a new expense', async () => {
    const text = "yep, and I also got gas $30";
    const w = world({
      expense: {
        "new|pizza was $48 lol": raw(4800, "Pizza", { payer: "unknown" }),
        [`new|${text}`]: raw(3000, "Gas"),
      },
      answer: { [text]: answer({ thread_id: "q1", relevance: 0.95, yes_no: "yes", also_new: true, also_intent: "expense" }) },
    });
    gateSays(w, { [text]: ["answer", 0.9] });
    const pizza = await w.say("Priya", "pizza was $48 lol");
    expect(w.said("clarifying_question")).toEqual(["Want me to split that?"]);
    const both = await w.say("Priya", text);
    expect(w.said("clarifying_question").at(-1)).toBe("Who paid for the Pizza?");
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("needs_info");
    expect(w.db.expense(`exp_${both.message_id}`)).toMatchObject({ status: "proposed", total_cents: 3000, payer_phone: PEOPLE.Priya, description: "Gas" });
  });

  it("logs a bystander's own expense as a new one, not as the answer", async () => {
    const text = "uber was $30, I paid";
    const w = world({
      expense: {
        "new|pizza was $48 lol": raw(4800, "Pizza", { payer: "unknown" }),
        [`new|${text}`]: raw(3000, "Uber"),
      },
      answer: { [text]: answer({ relevance: 0.05, also_new: true, also_intent: "expense" }) },
    });
    gateSays(w, { [text]: ["expense", 0.92] });
    const calls = spyAnswers(w);
    const pizza = await w.say("Priya", "pizza was $48 lol");
    await w.say("Priya", "yes");
    const ride = await w.say("Joe", text);
    expect(calls).toEqual([text]);
    expect(w.db.expense(`exp_${pizza.message_id}`)).toMatchObject({ status: "needs_info", payer_phone: undefined });
    expect(w.db.expense(`exp_${ride.message_id}`)).toMatchObject({ status: "proposed", payer_phone: PEOPLE.Joe, total_cents: 3000 });
  });

  it('counts "looks good" to "Anything uneven?" as that person\'s 👍, locking it in once everyone has', async () => {
    const text = "looks good to me";
    const w = world({
      expense: { "new|got pizza, $40": raw(4000, "Pizza") },
      answer: { [text]: answer({ thread_id: "q1", relevance: 0.9, yes_no: "no" }) },
    });
    gateSays(w, { [text]: ["answer", 0.8] });
    const pizza = await w.say("Joe", "got pizza, $40");
    await w.say("Kian", text);
    await w.say("Priya", text);
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("proposed");
    await w.say("Jake", text);
    expect(w.db.expense(`exp_${pizza.message_id}`)!.status).toBe("finalized");
    expect(w.db.transfers()).toEqual([]); // locking in never pays (P7)
  });
});

describe("who may answer", () => {
  it("refuses a non-asker's yes to a large-amount confirmation, without asking Grok", async () => {
    const w = world({ expense: { "new|paid 1200 for the airbnb": raw(120000, "Airbnb") } });
    const calls = spyAnswers(w);
    const airbnb = await w.say("Joe", "paid 1200 for the airbnb");
    const id = `exp_${airbnb.message_id}`;
    expect(w.db.expense(id)!.status).toBe("needs_info");
    const bystander = await w.say("Kian", "yes");
    expect(w.db.expense(id)!.status).toBe("needs_info");
    expect(bystander).toMatchObject({ intent: "ignore", text: undefined }); // not an answer: text cleared (§19)
    await w.say("Joe", "yes");
    expect(w.db.expense(id)!.status).toBe("proposed");
    expect(calls).toEqual([]);
  });

  it("never sends a bystander's message the gate ignored to Grok while a question is open", async () => {
    const w = world({ expense: { "new|pizza was $48 lol": raw(4800, "Pizza", { payer: "unknown" }) } });
    const calls = spyAnswers(w);
    await w.say("Priya", "pizza was $48 lol");
    await w.say("Priya", "yes");
    await w.say("Kian", "lol who cares");
    await w.say("Jake", "omw");
    expect(calls).toEqual([]);
  });

  it("only takes a dispute amount from the person who disputed", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    const settle = await w.say("Kian", "let's settle up");
    await w.react("Kian", `settle_request:${GROUP}:${settle.message_id}`, "dislike");
    const kian = () => w.db.shares(w.db.expenses()[0]!.expense_id).find((s) => s.phone === PEOPLE.Kian)!;
    expect(kian().status).toBe("disputed");
    // The question went to Kian by DM; nobody else answers it there.
    await w.dm("Priya", "5");
    expect(kian()).toMatchObject({ status: "disputed", amount_cents: 1000 });
    await w.dm("Kian", "5");
    expect(kian()).toMatchObject({ status: "locked", amount_cents: 500 });
  });
});
