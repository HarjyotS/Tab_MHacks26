// Fractional shares (§7.5) and never asking the same question twice in a
// row. Harjyot's playground: after "alex wasnt there", "priyas fatass had
// half of the pizza" got "how much was Priya's half of the pizza?", and
// every answer got the same question again.
import { describe, expect, it } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { processMessage } from "../src/brain/process.js";
import { openThreads } from "../src/brain/threads.js";
import { fractionIn } from "../src/brain/expense.js";
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
const adjust = (over: object) => raw(null, null, { payer: "unknown", ...over });
const had = (name: string, item: string) => ({ name, amount_cents: null, item, only: false });

const SAM = "+15555550111";
const ALEX = "+15555550112";
const JORDAN = "+15555550113";
const PRIYA = PEOPLE.Priya;

const PIZZA = "got pizza for everyone, $48";
const ALEX_OUT = "alex wasnt there";
const HALF = "priyas fatass had half of the pizza";
const RESTATED = "well i got one pizza and she had half and me and jordan had the other half";

// Sam, Priya, Alex and Jordan; Sam's $48 split 3 ways once Alex is out.
async function crew(script: Script, verdicts: Record<string, [Intent, number]> = {}, first = PIZZA, description = "Pizza") {
  const w = world({
    ...script,
    expense: {
      [`new|${first}`]: raw(4800, description),
      [`adjustment|${ALEX_OUT}`]: adjust({ exclusion_names: ["alex"] }),
      ...script.expense,
    },
  });
  w.db.addGroup("crew", [
    { phone: SAM, name: "Sam" },
    { phone: PRIYA, name: "Priya" },
    { phone: ALEX, name: "Alex" },
    { phone: JORDAN, name: "Jordan" },
  ]);
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : stubClassifier(input);
  };
  const say = async (phone: string, text: string) => {
    w.advance(1000);
    const m = w.db.ingest({ sender_phone: phone, group_id: "crew", text });
    await processMessage(w.ctx, m);
    w.db.deliver();
    return w.db.msgs.get(m.message_id)!;
  };
  const source = await say(SAM, first);
  const id = `exp_${source.message_id}`;
  await say(SAM, ALEX_OUT);
  expect(w.said("split_proposal").at(-1)).toMatch(/\$48\.00 split 3 ways, so \$16\.00 each$/);
  const shares = () => Object.fromEntries(w.db.shares(id).map((s) => [s.phone, s.status === "opted_out" ? "out" : s.amount_cents]));
  const asked = () => w.db.outbox().filter((o) => o.purpose === "clarifying_question" && o.expense_id === id).map((o) => o.text!);
  return { w, say, id, shares, asked };
}

describe("fractions of the expense are shares, computed in code", () => {
  it('splits "priyas fatass had half of the pizza" as Priya $24, Sam and Jordan $12, without asking', async () => {
    const { w, say, id, shares, asked } = await crew(
      { expense: { [`adjustment|${HALF}`]: adjust({ fixed: [had("priya", "half of the pizza")] }) } },
      { [HALF]: ["split_adjustment", 0.96] },
    );
    await say(SAM, HALF);
    expect(shares()).toEqual({ [SAM]: 1200, [PRIYA]: 2400, [ALEX]: "out", [JORDAN]: 1200 });
    expect(w.db.expense(id)!.split_mode).toBe("custom");
    expect(asked()).toEqual([]);
    expect(w.said("split_proposal").at(-1)).toMatch(/: pizza \$48\.00: Sam \$12\.00, Priya \$24\.00, Jordan \$12\.00$/);
  });

  it("asks nothing when the next message only says the same split again", async () => {
    const { say, shares, asked } = await crew(
      {
        expense: {
          [`adjustment|${HALF}`]: adjust({ fixed: [had("priya", "half of the pizza")] }),
          [`adjustment|${RESTATED}`]: adjust({
            fixed: [had("priya", "half"), had("me", "the other half"), had("jordan", "the other half")],
          }),
        },
        answer: { [RESTATED]: answer({ thread_id: "q1", relevance: 0.8 }) },
      },
      { [HALF]: ["split_adjustment", 0.96], [RESTATED]: ["answer", 0.74] },
    );
    await say(SAM, HALF);
    await say(SAM, RESTATED);
    expect(shares()).toEqual({ [SAM]: 1200, [PRIYA]: 2400, [ALEX]: "out", [JORDAN]: 1200 });
    expect(asked()).toEqual([]);
  });

  it('gives "the other half" to exactly the people who had it', async () => {
    // Before Alex is counted out: Alex had none of it either.
    const text = "priya had half and jordan had the other half";
    const { say, shares } = await crew(
      { expense: { [`adjustment|${text}`]: adjust({ fixed: [had("priya", "half"), had("jordan", "the other half")] }) } },
      { [text]: ["split_adjustment", 0.9] },
    );
    await say(SAM, text);
    expect(shares()).toEqual({ [SAM]: "out", [PRIYA]: 2400, [ALEX]: "out", [JORDAN]: 2400 });
  });

  it.each([
    ["a third", 1600, 1600],
    ["two thirds", 3200, 800],
    ["75%", 3600, 600],
    ["the pizza", 4800, 0], // the item is the expense itself: all of it
  ])('prices "priya had %s" from the total', async (part, priya, others) => {
    const text = `priya had ${part}`;
    const { say, shares, asked } = await crew(
      { expense: { [`adjustment|${text}`]: adjust({ fixed: [had("priya", part)] }) } },
      { [text]: ["split_adjustment", 0.9] },
    );
    await say(SAM, text);
    expect(shares()).toEqual({ [SAM]: others, [PRIYA]: priya, [ALEX]: "out", [JORDAN]: others });
    expect(asked()).toEqual([]);
  });

  it("still asks the price of something that isn't the expense", async () => {
    const text = "priya had half of the fries";
    const { say, asked } = await crew(
      { expense: { [`adjustment|${text}`]: adjust({ fixed: [had("priya", "half of the fries")] }) } },
      { [text]: ["split_adjustment", 0.9] },
      "got dinner for everyone, $48",
      "Dinner",
    );
    await say(SAM, text);
    expect(asked()).toEqual(["how much were Priya's half of the fries?"]); // the template's plural
  });

  it("reads fractions in code", () => {
    expect(fractionIn("half of the pizza")).toEqual({ num: 1, den: 2 });
    expect(fractionIn("a third of it")).toEqual({ num: 1, den: 3 });
    expect(fractionIn("two thirds")).toEqual({ num: 2, den: 3 });
    expect(fractionIn("three quarters")).toEqual({ num: 3, den: 4 });
    expect(fractionIn("50%")).toEqual({ num: 50, den: 100 });
    expect(fractionIn("1/3")).toEqual({ num: 1, den: 3 });
    expect(fractionIn("the other half")).toBe("rest");
    expect(fractionIn("split the rest")).toBe("rest");
    expect(fractionIn("10/3")).toBeUndefined();
    expect(fractionIn("got pizza")).toBeUndefined();
  });
});

describe('"how much was …?" answered with a fraction', () => {
  // On "Dominos", "half of the pizza" isn't clearly the whole expense, so
  // Tab asks the transcript's question; the answer is read from the total.
  const DOMINOS = "got dominos for everyone, $48";
  const QUESTION = "how much was Priya's half of the pizza?";

  it.each([
    ["half of the cost", 2400],
    ["half", 2400],
    ["50%", 2400],
    ["a third of it", 1600],
  ])('takes "%s" against the 48 dollar total', async (reply, priya) => {
    const { say, shares, asked } = await crew(
      {
        expense: {
          [`adjustment|${HALF}`]: adjust({ fixed: [had("priya", "half of the pizza")] }),
          [`adjustment|${HALF}\n${reply}`]: adjust({ fixed: [had("priya", "half of the pizza")] }),
        },
      },
      { [HALF]: ["split_adjustment", 0.96], [reply]: ["answer", 0.98] },
      DOMINOS,
      "Dominos",
    );
    await say(SAM, HALF);
    expect(asked()).toEqual([QUESTION]);
    await say(SAM, reply);
    const rest = (4800 - priya) / 2;
    expect(shares()).toEqual({ [SAM]: rest, [PRIYA]: priya, [ALEX]: "out", [JORDAN]: rest });
    expect(asked()).toEqual([QUESTION]);
  });

  it("takes it even when the re-read drops who it was about", async () => {
    const reply = "half of the cost";
    const { say, shares } = await crew(
      {
        expense: {
          [`adjustment|${HALF}`]: adjust({ fixed: [had("priya", "half of the pizza")] }),
          [`adjustment|${HALF}\n${reply}`]: adjust({}),
        },
      },
      { [HALF]: ["split_adjustment", 0.96], [reply]: ["answer", 0.98] },
      DOMINOS,
      "Dominos",
    );
    await say(SAM, HALF);
    await say(SAM, reply);
    expect(shares()).toEqual({ [SAM]: 1200, [PRIYA]: 2400, [ALEX]: "out", [JORDAN]: 1200 });
  });
});

describe("never the same question twice in a row", () => {
  const FRIES = "jake had the fries";
  const script: Script = {
    expense: {
      "new|got dinner, $60": raw(6000, "Dinner"),
      [`adjustment|${FRIES}`]: adjust({ fixed: [had("jake", "the fries")] }),
      [`adjustment|${FRIES}\n${FRIES}`]: adjust({ fixed: [had("jake", "the fries")] }),
      [`adjustment|${FRIES}\n5`]: adjust({ fixed: [{ name: "jake", amount_cents: 500, item: "the fries", only: false }] }),
    },
  };

  it("rephrases once with an example, then stops asking, and still takes the answer", async () => {
    const w = world(script);
    w.ctx.classify = async (input) =>
      input.message.text === FRIES ? { intent: "split_adjustment", confidence: 0.9 } : stubClassifier(input);
    const dinner = await w.say("Joe", "got dinner, $60");
    const id = `exp_${dinner.message_id}`;
    for (let i = 0; i < 4; i++) await w.say("Kian", FRIES);
    const asked = w.db.outbox().filter((o) => o.purpose === "clarifying_question" && o.expense_id === id).map((o) => o.text!);
    expect(asked).toEqual(["how much were Jake's fries?", "how much should Jake pay? like $15.00"]);
    for (let i = 1; i < asked.length; i++) expect(asked[i]).not.toBe(asked[i - 1]);
    // The question is still open: an amount answers it.
    expect(openThreads(w.ctx, { group_id: GROUP }).some((t) => t.data.kind === "adjustment")).toBe(true);
    await w.say("Kian", "5");
    expect(w.db.shares(id).find((s) => s.phone === PEOPLE.Jake)!.amount_cents).toBe(500);
  });
});
