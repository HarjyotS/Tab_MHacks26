// Agreeing with a split proposal (Harjyot's playground): Priya logged "got
// tp for 20 bucks", her 👍 on the proposal did nothing, her "yeah" got "ok
// what was uneven?", and "split 4 ways" got the same question again.
import { describe, expect, it } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { processMessage } from "../src/brain/process.js";
import { openThreads } from "../src/brain/threads.js";
import type { Message } from "../src/store/types.js";
import type { ChatClient } from "../src/grok/structured.js";
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

function gateSays(w: ReturnType<typeof world>, verdicts: Record<string, [Intent, number]>) {
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : stubClassifier(input);
  };
}

const TP = "got tp for 20 bucks";

// The house (Joe, Kian, Priya, Jake) with Priya's tp proposed 4 ways.
async function tp(script: Script = {}, verdicts: Record<string, [Intent, number]> = {}) {
  const w = world({ ...script, expense: { [`new|${TP}`]: raw(2000, "tp"), ...script.expense } });
  gateSays(w, verdicts);
  const source = await w.say("Priya", TP);
  const id = `exp_${source.message_id}`;
  expect(w.said("split_proposal")[0]).toMatch(/^tp \$20\.00 split 4 ways, so \$5\.00 each\n/);
  const share = (who: keyof typeof PEOPLE) => w.db.shares(id).find((s) => s.phone === PEOPLE[who])!;
  const liked = (m: Message) => w.db.out.has(`tapback:${m.message_id}:like`);
  const puzzled = (m: Message) => w.db.out.has(`tapback:${m.message_id}:question`);
  return { w, id, share, liked, puzzled };
}

describe("the payer's 👍 on the proposal", () => {
  it("counts as the payer's own agreement, and leaves everyone else their window (P4)", async () => {
    const { w, id, share } = await tp();
    await w.react("Priya", `split_proposal:${id}`);
    expect(share("Priya").responded).toBe(true);
    expect(w.db.expense(id)!.status).toBe("proposed");
    expect(w.said("settle_request")).toEqual([]);
    expect(w.db.transfers()).toEqual([]); // never pays (P7)
  });

  it("still marks someone else's 👍 as theirs only, until everyone has", async () => {
    const { w, id, share } = await tp();
    await w.react("Kian", `split_proposal:${id}`);
    expect(share("Kian").responded).toBe(true);
    expect(w.db.expense(id)!.status).toBe("proposed");
    await w.react("Joe", `split_proposal:${id}`);
    await w.react("Jake", `split_proposal:${id}`);
    expect(w.db.expense(id)!.status).toBe("finalized");
  });

  it("still lets someone object after the payer's 👍, with no reopen needed", async () => {
    const { w, id, share } = await tp({ expense: { "adjustment|jake wasnt there": adjust({ exclusion_names: ["jake"] }) } });
    await w.react("Priya", `split_proposal:${id}`);
    await w.say("Kian", "jake wasnt there");
    expect(w.db.expense(id)!.status).toBe("proposed");
    expect(share("Jake").status).toBe("opted_out");
  });
});

describe("agreeing in text is never an objection", () => {
  it('takes Priya\'s "yeah" as looks-right: a 👍, no "ok what was uneven?"', async () => {
    const { w, id, share, liked, puzzled } = await tp(
      { answer: { yeah: answer({ thread_id: "q1", relevance: 0.9, yes_no: "yes" }) } },
      { yeah: ["answer", 0.9] },
    );
    const yeah = await w.say("Priya", "yeah");
    expect(liked(yeah)).toBe(true);
    expect(puzzled(yeah)).toBe(false);
    expect(w.said("clarifying_question")).toEqual([]);
    expect(share("Priya").responded).toBe(true);
    expect(w.db.expense(id)!.status).toBe("proposed"); // only the payer's 👍 locks it in
    expect(yeah.intent).toBe("answer"); // kept as an answer (§19)
  });

  it('then takes "split 4 ways" the same way, still without a question', async () => {
    const { w, liked } = await tp(
      {
        answer: {
          yeah: answer({ thread_id: "q1", relevance: 0.9, yes_no: "yes" }),
          "split 4 ways": answer({ thread_id: "q1", relevance: 0.97, restated: "Priya says to split it 4 ways." }),
        },
      },
      { yeah: ["answer", 0.9], "split 4 ways": ["answer", 0.97] },
    );
    await w.say("Priya", "yeah");
    const ways = await w.say("Priya", "split 4 ways");
    expect(liked(ways)).toBe(true);
    expect(w.said("clarifying_question")).toEqual([]);
  });

  it.each(["yep", "ok", "k", "cool", "bet", "sounds good", "looks right", "perfect", "all good", "that's right", "even split", "split 4 ways", "👍"])(
    'counts "%s" from someone on the split as their 👍',
    async (text) => {
      // Grok reads no yes or no from most of these: code decides.
      const { w, share, liked } = await tp({ answer: { [text]: answer({ thread_id: "q1", relevance: 0.8 }) } }, { [text]: ["answer", 0.8] });
      const reply = await w.say("Kian", text);
      expect(liked(reply)).toBe(true);
      expect(share("Kian").responded).toBe(true);
      expect(w.said("clarifying_question")).toEqual([]);
    },
  );

  it.each(["update it", "wait is that with tax?"])('doesn\'t count "%s" as agreement', async (text) => {
    const { w, share, liked } = await tp(
      { expense: { [`adjustment|${text}`]: adjust({}) }, answer: { [text]: answer({ thread_id: "q1", relevance: 0.8 }) } },
      { [text]: ["answer", 0.8] },
    );
    const reply = await w.say("Kian", text);
    expect(liked(reply)).toBe(false);
    expect(share("Kian").responded).toBe(false);
  });

  it("locks it in once everyone on the split has agreed", async () => {
    const { w, id } = await tp({ answer: { "sounds good": answer({ thread_id: "q1", relevance: 0.8, yes_no: "yes" }) } }, { "sounds good": ["answer", 0.8] });
    for (const who of ["Joe", "Kian", "Jake"] as const) await w.say(who, "sounds good");
    expect(w.db.expense(id)!.status).toBe("finalized");
  });

  it("still applies a change that comes with a yes or a no, whatever Grok read", async () => {
    const text = "no, jake only had a $3 coke";
    const { w, share } = await tp(
      {
        expense: { [`adjustment|${text}`]: adjust({ fixed: [{ name: "jake", amount_cents: 300, item: "coke", only: true }] }) },
        answer: { [text]: answer({ thread_id: "q1", relevance: 0.9, yes_no: "no" }) },
      },
      { [text]: ["answer", 0.9] },
    );
    await w.say("Kian", text);
    expect(share("Jake").amount_cents).toBe(300);
    expect(share("Kian").responded).toBe(false);
  });
});

describe('"ok what was uneven?" is asked once', () => {
  const notEven = { "adjustment|not even": adjust({}) };

  it('takes "split 4 ways" as even after all: a 👍, and the question is closed', async () => {
    const { w, liked } = await tp(
      {
        expense: notEven,
        answer: { "split 4 ways": answer({ thread_id: "q1", relevance: 0.97, restated: "Priya says to split it 4 ways." }) },
      },
      { "split 4 ways": ["answer", 0.97] },
    );
    await w.say("Kian", "not even");
    expect(w.said("clarifying_question")).toEqual(["ok what was uneven?"]);
    const ways = await w.say("Priya", "split 4 ways");
    expect(liked(ways)).toBe(true);
    expect(w.said("clarifying_question")).toEqual(["ok what was uneven?"]);
    expect(openThreads(w.ctx, { group_id: GROUP }).map((t) => t.data.kind)).toEqual(["split_open"]);
  });

  it.each(["nvm", "never mind", "it was even", "no it's fine", "actually it's fine", "all good"])('takes "%s" the same way', async (text) => {
    const { w, liked } = await tp(
      { expense: notEven, answer: { [text]: answer({ thread_id: "q1", relevance: 0.9 }) } },
      { [text]: ["answer", 0.9] },
    );
    await w.say("Kian", "not even");
    const reply = await w.say("Kian", text);
    expect(liked(reply)).toBe(true);
    expect(w.said("clarifying_question")).toEqual(["ok what was uneven?"]);
  });

  it("keeps the split instead of asking again when the answer still has nothing specific", async () => {
    const text = "it just wasn't";
    const { w, id, share, liked } = await tp({ expense: { ...notEven, [`adjustment|${text}`]: adjust({}) } }, { [text]: ["split_adjustment", 0.9] });
    await w.say("Kian", "not even");
    const reply = await w.say("Kian", text);
    expect(w.said("clarifying_question")).toEqual(["ok what was uneven?"]);
    expect(liked(reply)).toBe(true);
    expect(share("Kian").responded).toBe(false); // kept, not agreed
    expect(w.db.expense(id)!.status).toBe("proposed");
    expect(openThreads(w.ctx, { group_id: GROUP }).some((t) => t.data.kind === "adjust_open")).toBe(false);
  });
});

describe("real changes still change the split", () => {
  const SAM = "+15555550111";
  const ALEX = "+15555550112";
  const JORDAN = "+15555550113";

  async function crew(text: string) {
    const w = world({
      expense: {
        "new|got pizza for everyone, $48": raw(4800, "Pizza"),
        [`adjustment|${text}`]: adjust({ exclusion_names: ["alex"] }),
      },
    });
    w.db.addGroup("crew", [
      { phone: SAM, name: "Sam" },
      { phone: PEOPLE.Priya, name: "Priya" },
      { phone: ALEX, name: "Alex" },
      { phone: JORDAN, name: "Jordan" },
    ]);
    const say = async (phone: string, t: string) => {
      w.advance(1000);
      const m = w.db.ingest({ sender_phone: phone, group_id: "crew", text: t });
      await processMessage(w.ctx, m);
      w.db.deliver();
      return w.db.msgs.get(m.message_id)!;
    };
    const pizza = await say(SAM, "got pizza for everyone, $48");
    return { w, say, id: `exp_${pizza.message_id}` };
  }

  it.each(["alex wasn't there", "yeah but alex wasn't there"])('"%s" opts Alex out and posts the redo', async (text) => {
    const { w, say, id } = await crew(text);
    await say(SAM, text);
    const shares = Object.fromEntries(w.db.shares(id).map((s) => [s.phone, [s.status, s.amount_cents]]));
    expect(shares).toEqual({
      [SAM]: ["proposed", 1600],
      [PEOPLE.Priya]: ["proposed", 1600],
      [ALEX]: ["opted_out", 0],
      [JORDAN]: ["proposed", 1600],
    });
    expect(w.said("split_proposal").at(-1)).toMatch(/pizza \$48\.00 split 3 ways, so \$16\.00 each$/);
  });
});

// Audit of #52: a "yeah" counts as agreeing to a split only when it's
// clearly about that split.
describe("a bare yeah is about the split only when it clearly is", () => {
  const offTopic = { answer: { yeah: answer({ thread_id: "q1", relevance: 0.1, yes_no: "yes" }) } };
  // The bare-yeah path sits in front of the money brain, so turn it on. The
  // agent itself is never needed here: if it's reached, it just fails.
  const withBrain = (w: ReturnType<typeof world>) => {
    const client = { chat: { completions: { create: () => Promise.reject(new Error("no agent in this test")) } } } as unknown as ChatClient;
    w.ctx.ask = { client, model: "m" };
  };

  it("still counts a yeah right after the proposal", async () => {
    const { w, share, liked } = await tp(offTopic, { yeah: ["answer", 0.5] });
    withBrain(w);
    const m = await w.say("Kian", "yeah");
    expect(liked(m)).toBe(true);
    expect(share("Kian").responded).toBe(true);
  });

  it("ignores a yeah that replies to someone else's question", async () => {
    const { w, id, share, liked } = await tp(offTopic, { yeah: ["answer", 0.5] });
    withBrain(w);
    w.advance(30 * 60_000);
    const movies = await w.say("Joe", "movies tonight still?");
    for (const who of ["Kian", "Jake"] as const) {
      const m = await w.say(who, "yeah", { reply_to_id: movies.message_id });
      expect(liked(m)).toBe(false);
      expect(share(who).responded).toBe(false);
    }
    expect(w.db.expense(id)!.status).toBe("proposed");
  });

  it("ignores a yeah after other chat has moved on", async () => {
    const { w, share, liked } = await tp(offTopic, { yeah: ["answer", 0.5] });
    withBrain(w);
    await w.say("Joe", "movies tonight still?");
    const m = await w.say("Kian", "yeah");
    expect(liked(m)).toBe(false);
    expect(share("Kian").responded).toBe(false);
  });
});
