import { describe, expect, it } from "vitest";
import { world } from "./support/harness.js";

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
    expect(w.said("clarifying_question")).toEqual([]); // and Tab stayed quiet through the chatter (P1)
  });
});
