// History answers (§7.8 History): what someone paid, what it was for, and
// when, in DMs and in the group, so a balance or "why?" with nothing open
// never dead-ends. Harjyot's playground: "it cant answer questions from dms".
import { describe, expect, it } from "vitest";
import { stubClassifier, type ClassifyResult } from "@tab/gate";
import { asksWhatFor, relativeDay } from "../src/brain/history.js";
import { processMessage } from "../src/brain/process.js";
import type { Message } from "../src/store/types.js";
import { GROUP, PEOPLE, toolClient, world } from "./support/harness.js";
import { seedHistory } from "./support/seed.js";

const SAM = "+15555550110";
const APT = "apt";

const raw = (cents: number, description: string) => ({
  is_expense: true, amount_cents: cents, amount_is_per_person: false, description, payer: "sender", payer_name: null,
  participants: "everyone", participant_names: [], exclusion_names: [], fixed: [],
});

// The gate's live verdicts from the playground, by message text.
function gateSays(w: ReturnType<typeof world>, verdicts: Record<string, ClassifyResult>) {
  w.ctx.classify = async (input) => verdicts[input.message.text ?? ""] ?? stubClassifier(input);
}

// Sam and Priya's apartment: Priya got tp, Sam paid her back his $5.00 with
// a 👍 on the settle request, and got the payment DM.
async function samPaidPriya() {
  const w = world({ expense: { "new|got tp, $10": raw(1000, "tp") } });
  w.db.addGroup(APT, [{ phone: SAM, name: "Sam" }, { phone: PEOPLE.Priya, name: "Priya" }]);
  const send = async (from: string, text: string, extra: Partial<Message> = {}) => {
    w.advance(1000);
    const m = w.db.ingest({ sender_phone: from, text, ...extra });
    await processMessage(w.ctx, m);
    w.db.deliver();
    return m;
  };
  await send(PEOPLE.Priya, "got tp, $10", { group_id: APT });
  await w.wait(31_000); // locks in
  await send(PEOPLE.Priya, "settle up", { group_id: APT });
  const request = w.db.outbox().find((o) => o.purpose === "settle_request")!;
  expect(request.text).toMatch(/owed to Priya for tp:\nSam \$5\.00/);
  await send(SAM, "", { group_id: APT, kind: "reaction", reaction: "like", reply_to_id: request.sent_photon_id });
  w.db.completeTransfers();
  await w.wait(1000);
  const receipt = w.db.outbox().find((o) => o.purpose === "payment_receipt")!;
  expect(receipt).toMatchObject({ kind: "dm", to_phone: SAM, text: "done, you paid Priya $5.00 for tp (simulated, no real money moved)\nyou're all square" });
  const dm = (text: string, extra: Partial<Message> = {}) => send(SAM, text, extra);
  const replyTo = (m: Message) => w.db.outbox().find((o) => o.target_message_id === m.message_id && o.kind !== "reaction");
  return { w, dm, replyTo, receipt };
}

describe("the playground DM, after Sam paid Priya for tp", () => {
  it("answers both halves of \"how much do i owe and what was it for\", then \"what was it for\"", async () => {
    const { w, dm, replyTo } = await samPaidPriya();
    gateSays(w, {
      "how much do i owe and what was it for": { intent: "balance_query", confidence: 0.93 },
      "what was it for": { intent: "breakdown_request", confidence: 0.97 },
    });
    const both = await dm("how much do i owe and what was it for");
    expect(replyTo(both)).toMatchObject({ kind: "dm", to_phone: SAM, text: "you're square with everyone\nthat was tp, you paid Priya $5.00 today" });
    const what = await dm("what was it for");
    expect(replyTo(what)).toMatchObject({ kind: "dm", to_phone: SAM, text: "that was tp, you paid Priya $5.00 today\nyou're all square now" });
    expect(replyTo(what)!.text).not.toMatch(/nothing open/);
    expect(what.text).toBe("what was it for"); // kept: it's about money (§19)
  });

  it("\"what was it for\" right after the payment DM, however the gate reads it", async () => {
    for (const verdict of [
      { intent: "breakdown_request", confidence: 0.97 },
      { intent: "money_question", confidence: 0.9 },
      { intent: "balance_query", confidence: 0.9 },
    ] as const) {
      const { w, dm, replyTo } = await samPaidPriya();
      const t = toolClient([]); // the money brain is never needed
      w.ctx.ask = { client: t.client, model: "m" };
      gateSays(w, { "what was it for": verdict });
      const m = await dm("what was it for");
      expect(replyTo(m)!.text, verdict.intent).toMatch(/^(you're square with everyone\n)?that was tp, you paid Priya \$5\.00 today/);
      expect(t.create).not.toHaveBeenCalled();
    }
  });

  it("\"what was the $5 for\" by DM, with nothing open, is answered from history", async () => {
    const { w, dm, replyTo } = await samPaidPriya();
    gateSays(w, { "what was the $5 for": { intent: "breakdown_request", confidence: 0.95 } });
    const m = await dm("what was the $5 for");
    expect(replyTo(m)!.text).toBe("that was tp, you paid Priya $5.00 today\nyou're all square now");
  });

  it("an inline reply to the payment DM points at that payment", async () => {
    const { w, dm, replyTo, receipt } = await samPaidPriya();
    gateSays(w, { "wait what was this for": { intent: "money_question", confidence: 0.9 } });
    const m = await dm("wait what was this for", { reply_to_id: receipt.sent_photon_id });
    expect(replyTo(m)!.text).toBe("that was tp, you paid Priya $5.00 today\nyou're all square now");
  });

  it("a balance with nothing open shows the last payment, and \"why?\" says what it was", async () => {
    const { dm, replyTo } = await samPaidPriya();
    const owe = await dm("what do i owe");
    expect(replyTo(owe)!.text).toBe("you're square with everyone\nlast one: you paid Priya $5.00 for tp today");
    const why = await dm("why");
    expect(replyTo(why)!.text).toBe("that was tp, you paid Priya $5.00 today\nyou're all square now");
  });

  it("Priya, who got the money, sees it from her side", async () => {
    const { w } = await samPaidPriya();
    w.advance(1000);
    const m = w.db.ingest({ sender_phone: PEOPLE.Priya, text: "what do i owe" });
    await processMessage(w.ctx, m);
    // Priya is in the house too, where she owes Joe nothing yet: square.
    expect(w.db.outbox().find((o) => o.target_message_id === m.message_id)!.text).toBe("you're square with everyone\nlast one: Sam paid you $5.00 for tp today");
  });
});

describe("combined questions", () => {
  it("\"how much do i owe and what for\" gives the balance and the short why together", async () => {
    const w = world({});
    seedHistory(w.db);
    gateSays(w, { "how much do i owe and what was it for": { intent: "balance_query", confidence: 0.93 } });
    const m = await w.say("Priya", "how much do i owe and what was it for");
    const reply = w.db.outbox().find((o) => o.target_message_id === m.message_id)!;
    expect(reply.text!.split("\n")).toEqual([
      "you owe Joe $26.00 and Jake $6.00",
      "not locked in yet: groceries: $15.75 to Kian",
      "Priya owes Joe $26.00: the bistro $14.00, pizza $12.00",
      "uber to the airport $6.00: split 4 ways",
    ]);
  });
});

describe("\"that\" in the group", () => {
  it("after a settle request, \"what was that for?\" is about that expense, from the records", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    await w.ctx.db.set_settle_mode({ group_id: GROUP, settle_mode: "per_expense" });
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    expect(w.said("settle_request")).toHaveLength(1);
    const t = toolClient([]);
    w.ctx.ask = { client: t.client, model: "m" };
    gateSays(w, { "what was that for?": { intent: "money_question", confidence: 0.9 } });
    const m = await w.say("Kian", "what was that for?");
    expect(w.db.outbox().find((o) => o.target_message_id === m.message_id && o.kind !== "reaction")).toMatchObject({
      kind: "group_message",
      text: "that was pizza, Joe paid $40.00 today\nyour part was $10.00 (split 4 ways), not settled yet",
    });
    expect(t.create).not.toHaveBeenCalled();
  });

  it("\"when was that?\" goes to the money brain with that expense handed over", async () => {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    await w.say("Joe", "got pizza, $40");
    gateSays(w, { "when was that?": { intent: "money_question", confidence: 0.9 } });
    const t = toolClient([{ reply: "Joe got the Pizza today." }]);
    w.ctx.ask = { client: t.client, model: "m" };
    await w.say("Kian", "when was that?");
    expect(String(t.requests[0]!.messages[1]!.content)).toMatch(/<expense_they_replied_to>[\s\S]*"description":"Pizza"/);
  });
});

// The money brain (#38) with history in its lookups.
describe("privacy: a DM answers only about the sender's own money", () => {
  it("\"who owes what\" by DM is just the sender's balance, never the whole group's", async () => {
    const w = world({});
    seedHistory(w.db);
    gateSays(w, { "who owes what": { intent: "balance_query", confidence: 0.95 } });
    await w.say("Priya", "who owes what");
    expect(w.said("balance_reply").at(-1)).toMatch(/Kian owes Joe \$27\.00/); // the group sees the group
    const m = await w.dm("Priya", "who owes what");
    expect(w.db.outbox().find((o) => o.target_message_id === m.message_id)!.text).toBe("you owe Joe $26.00 and Jake $6.00\nnot locked in yet: groceries: $15.75 to Kian");
  });

  it("a DM breakdown of two other people shows only the sender's balance with each", async () => {
    const w = world({});
    seedHistory(w.db);
    const m = await w.dm("Priya", "@tab breakdown kian jake");
    const text = w.db.outbox().find((o) => o.target_message_id === m.message_id)!.text!;
    expect(text).toMatch(/Priya owes Jake \$6\.00/);
    expect(text).not.toMatch(/Kian owes|Jake owes Joe/);
  });

  it("\"what was it for\" in a DM never resolves to someone else's payment", async () => {
    const { w } = await samPaidPriya();
    // Joe DMs right after Sam's receipt went out to Sam: nothing of Joe's.
    gateSays(w, { "what was it for": { intent: "breakdown_request", confidence: 0.97 } });
    w.advance(1000);
    const m = w.db.ingest({ sender_phone: PEOPLE.Joe, text: "what was it for" });
    await processMessage(w.ctx, m);
    const text = w.db.outbox().find((o) => o.target_message_id === m.message_id)!.text!;
    expect(text).not.toMatch(/tp|Sam|Priya \$5\.00/);
  });
});

describe("reading the question", () => {
  it.each([
    "what was it for", "how much do i owe and what was it for", "what's that from", "whats that",
    "for what?", "what for", "what did i pay priya for", "what was that payment for",
  ])("%j asks what something was", (text) => expect(asksWhatFor(text)).toBe(true));

  // An amount keeps #46's pointer to "@tab breakdown": it may be someone else's balance.
  it.each(["what did we spend on food", "what was on the bistro receipt?", "what do i owe", "who paid for the uber?", "how much was the sushi", "what's the $90.70 from?"])(
    "%j doesn't",
    (text) => expect(asksWhatFor(text)).toBe(false),
  );

  it("says days the way a friend would, in the group's time zone", () => {
    const now = new Date("2026-10-04T02:00:00Z"); // Sat Oct 3, 10pm in Detroit
    expect(relativeDay(new Date("2026-10-03T15:00:00Z"), now)).toBe("today");
    expect(relativeDay(new Date("2026-10-02T15:00:00Z"), now)).toBe("yesterday");
    expect(relativeDay(new Date("2026-09-28T15:00:00Z"), now)).toBe("mon");
    expect(relativeDay(new Date("2026-09-20T15:00:00Z"), now)).toBe("sep 20");
  });
});
