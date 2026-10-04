import { describe, expect, it, vi } from "vitest";
import { stubClassifier, withPrefilter, type ClassifyInput } from "@tab/gate";
import { addThread } from "../src/brain/threads.js";
import { GROUP, world } from "./support/harness.js";

const raw = { is_expense: true, amount_cents: 6300, amount_is_per_person: false, description: "Groceries", payer: "sender", payer_name: null, participants: "everyone", participant_names: [], exclusion_names: [], fixed: [] };

// Harjyot's review on #14: only money-related messages ever reach Grok (§19, §16.3).
describe("privacy", () => {
  it("sends one Grok call for ten chatty messages and one expense, with no chatter in its context", async () => {
    const w = world({ expense: { "new|got groceries, $63": raw } });
    const calls: { text: string; context: string[] }[] = [];
    const real = w.ctx.extract.expense;
    w.ctx.extract.expense = (input, mode) => {
      calls.push({ text: input.message.text ?? "", context: input.context.map((c) => c.text ?? "") });
      return real(input, mode);
    };
    // The answer resolver never runs while Tab has no open question.
    const answers: string[] = [];
    w.ctx.extract.answer = (input) => (answers.push(input.message.text ?? ""), Promise.reject(new Error("no open question")));
    const chatter = ["lol", "who's home tonight", "omw", "did anyone see my charger", "the game starts at 7", "lmaooo", "ok", "anyone want to watch a movie", "happy birthday priya!!", "5 more minutes"];
    for (const [i, text] of chatter.entries()) await w.say((["Kian", "Priya", "Jake"] as const)[i % 3], text);
    await w.say("Joe", "got groceries, $63");

    expect(calls).toHaveLength(1);
    expect(answers).toEqual([]);
    expect(calls[0]!.text).toBe("got groceries, $63");
    expect(calls[0]!.context.filter((t) => chatter.includes(t))).toEqual([]);
    expect(w.said("clarifying_question")).toEqual([]);
    // §19: the module clears the text of everything reported as ignore.
    const stored = [...w.db.msgs.values()].filter((m) => m.sender_phone !== "+15555550101").map((m) => m.text);
    expect(stored.every((t) => t === undefined)).toBe(true); // and Tab stayed quiet through the chatter (P1)
  });

  it("keeps chatter away from the paid classifier, logs the skip, and still passes answers to Tab's open question", async () => {
    const w = world({});
    const seen: ClassifyInput[] = [];
    w.ctx.classify = withPrefilter(vi.fn(async (input: ClassifyInput) => (seen.push(input), stubClassifier(input))));
    const logged: Record<string, unknown>[] = [];
    w.ctx.log = (event, fields) => void (event === "classified" && logged.push(fields));

    await w.say("Kian", "who's driving");
    expect(seen).toHaveLength(0);
    expect(logged.at(-1)).toMatchObject({ intent: "ignore", decision: "ignore", prefiltered: true });

    // Tab asked Joe something; a bystander's "the second one" has no money words but must still be judged.
    const source = await w.say("Joe", "got groceries, $63");
    addThread(w.ctx, { group_id: GROUP }, {
      id: `clarify:${source.message_id}`,
      text: "Want me to split that?",
      who: "asker",
      asker: source.sender_phone,
      data: { kind: "confirm", then: "expense", source, asked_at: w.ctx.now() },
    });
    await w.say("Priya", "the second one");
    expect(seen.at(-1)).toMatchObject({ tab_question_open: true, message: { text: "the second one" } });
    expect(logged.at(-1)).toMatchObject({ prefiltered: false });
  });
});

describe("what never reaches Grok (Joe's review of #35)", () => {
  const pizza = {
    "new|got pizza, $40": {
      is_expense: true, amount_cents: 4000, amount_is_per_person: false, description: "Pizza",
      payer: "sender", payer_name: null, participants: "everyone", participant_names: [],
      exclusion_names: [], fixed: [],
    },
  };

  it("keeps \"just me and priya…\" chatter out of the extractor while a split is open", async () => {
    // No scripted extraction for this text: reaching Grok would throw.
    const w = world({ expense: pizza });
    await w.say("Joe", "got pizza, $40");
    const chat = "just me and priya are going to the movies later lol";
    const base = w.ctx.classify;
    w.ctx.classify = async (input) =>
      input.message.text === chat ? { intent: "ignore", confidence: 0.45 } : base(input);
    const m = await w.say("Kian", chat);
    expect(m).toMatchObject({ status: "done", intent: "ignore", text: undefined });
    expect(w.said("clarifying_question")).toEqual([]);
  });

  it("asks about an unsure photo instead of sending it to the receipt read", async () => {
    // No scripted receipt: reaching the receipt read would throw. (The
    // description before the gate is the user-authorized exception, §7.4;
    // with none scripted here the photo just goes undescribed.)
    const w = world({});
    w.ctx.classify = async () => ({ intent: "receipt", confidence: 0.6 });
    const m = await w.photo("Kian", "maybe-a-receipt");
    expect(m.status).toBe("done");
    expect(w.db.expenses()).toEqual([]);
    // Never quiet on money talk: one short question, the read only on yes.
    expect(w.said("clarifying_question").map((q) => q.toLowerCase())).toEqual(["want me to split this?"]);
  });
});
