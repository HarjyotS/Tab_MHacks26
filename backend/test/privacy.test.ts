import { describe, expect, it, vi } from "vitest";
import { stubClassifier, withPrefilter, type ClassifyInput } from "@tab/gate";
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
    const chatter = ["lol", "who's home tonight", "omw", "did anyone see my charger", "the game starts at 7", "lmaooo", "ok", "anyone want to watch a movie", "happy birthday priya!!", "5 more minutes"];
    for (const [i, text] of chatter.entries()) await w.say((["Kian", "Priya", "Jake"] as const)[i % 3], text);
    await w.say("Joe", "got groceries, $63");

    expect(calls).toHaveLength(1);
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
    w.ctx.memory.pending.set(GROUP, { kind: "confirm", then: "expense", source, asked_at: w.ctx.now() });
    await w.say("Priya", "the second one");
    expect(seen.at(-1)).toMatchObject({ tab_question_open: true, message: { text: "the second one" } });
    expect(logged.at(-1)).toMatchObject({ prefiltered: false });
  });
});
