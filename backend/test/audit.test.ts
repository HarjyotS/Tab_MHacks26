import { describe, expect, it } from "vitest";
import { stubClassifier } from "@tab/gate";
import { PEOPLE, world } from "./support/harness.js";

// Joe's audit of #49–#59 (merged unreviewed): each case reproduced on main.
const raw = (cents: number | null, description: string | null, payer = "sender") => ({
  is_expense: true, amount_cents: cents, amount_is_per_person: false, description,
  payer, payer_name: null, participants: "everyone", participant_names: [], exclusion_names: [], fixed: [],
});

describe("corrections that could mean two expenses (#50)", () => {
  const script = {
    expense: { "new|uber was $24": raw(2400, "Uber"), "new|uber home was $30": raw(3000, "Uber home") },
    correction: { "actually the uber was $28 not $24": { target_expense_id: null, new_amount_cents: 2800, new_description: null, unclear: false } },
  };
  // The gate is sure: "uber…" are new expenses, "actually…" a correction.
  const sure = (w: ReturnType<typeof world>) =>
    (w.ctx.classify = async (input) =>
      input.message.text?.startsWith("actually")
        ? { intent: "correction", confidence: 0.95 }
        : input.message.text?.startsWith("uber")
          ? { intent: "expense", confidence: 0.95 }
          : stubClassifier(input));

  it("picks the one whose old amount the message names", async () => {
    const w = world(script);
    sure(w);
    const uber = await w.say("Joe", "uber was $24");
    const home = await w.say("Joe", "uber home was $30");
    await w.say("Joe", "actually the uber was $28 not $24");
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(2800);
    expect(w.db.expense(`exp_${home.message_id}`)!.total_cents).toBe(3000);
  });

  it("asks which when nothing tells them apart", async () => {
    const w = world({ ...script, correction: { "actually the uber was $28": script.correction["actually the uber was $28 not $24"] } });
    sure(w);
    const uber = await w.say("Joe", "uber was $24");
    const home = await w.say("Joe", "uber home was $30");
    await w.say("Joe", "actually the uber was $28");
    expect(w.said("clarifying_question").at(-1)).toBe("which one? reply to the expense you mean");
    expect(w.db.expense(`exp_${uber.message_id}`)!.total_cents).toBe(2400);
    expect(w.db.expense(`exp_${home.message_id}`)!.total_cents).toBe(3000);
  });
});

describe("a yes that also means \"I paid\" (#57)", () => {
  it("asks both at once, so the yes covers who paid", async () => {
    const w = world({ expense: { "new|ice cream was 50": raw(5000, "ice cream", "unknown") } });
    w.ctx.classify = async (input) => (input.message.text === "ice cream was 50" ? { intent: "expense", confidence: 0.8 } : stubClassifier(input));
    await w.say("Kian", "ice cream was 50");
    expect(w.said("clarifying_question")).toEqual(["you got that? want me to split it?"]);
    await w.say("Kian", "yes");
    expect(w.db.expenses()[0]).toMatchObject({ payer_phone: PEOPLE.Kian, status: "proposed" });
  });
});

describe("an amount right after your own photo (#63)", () => {
  it("is chatter after a selfie, and the selfie's description never reaches Grok", async () => {
    // No scripted expense extraction: reaching Grok would throw.
    const w = world({
      describe: { selfie: { kind: "photo", description: "Kian and Jake at the beach", transcription: "", money_related: false } },
    });
    await w.photo("Kian", "selfie");
    const m = await w.say("Kian", "20");
    expect(m.status).toBe("done");
    expect(w.db.expenses()).toEqual([]);
  });
});
