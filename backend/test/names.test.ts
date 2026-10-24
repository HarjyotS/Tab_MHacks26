import { describe, expect, it } from "vitest";
import { stubClassifier } from "@tab/gate";
import { processMessage, tick } from "../src/brain/process.js";
import { GROUP, PEOPLE, world } from "./support/harness.js";

// Vegas chat, live: two members never said their names, so "dhanush" (one
// of them) looked like someone outside the group, every time.
const DHANUSH = "+16692612230";

const raw = {
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: null,
  payer: "unknown",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
};
const owes = { ...raw, fixed: [{ name: "dhanush", amount_cents: 1000, item: null }] };
const script = {
  expense: {
    "new|got pizza, $48": { ...raw, payer: "sender", amount_cents: 4800, description: "Pizza" },
    "adjustment|dhanush actually owes 10": owes,
    "adjustment|dhanush actually owes 10\n": owes,
  },
};

function withDhanush(w: ReturnType<typeof world>) {
  w.db.mems.set(`${GROUP}:${DHANUSH}`, { member_id: `${GROUP}:${DHANUSH}`, group_id: GROUP, phone: DHANUSH, joined_at: w.ctx.now() });
  w.ctx.classify = async (input) =>
    input.message.text?.includes("owes") ? { intent: "split_adjustment", confidence: 0.64 } : stubClassifier(input);
}

describe("names Tab doesn't know yet", () => {
  it("asks anyone for the last 4 digits, then names that member and goes on", async () => {
    const w = world(script);
    withDhanush(w);
    await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "dhanush actually owes 10");
    expect(w.said("clarifying_question")).toEqual(["wait who's dhanush? if it's …2230 just reply 2230"]);

    await w.say("Kian", "2230");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("Dhanush");
    const pizza = w.db.expenses().find((e) => e.description === "Pizza")!;
    // The adjustment that waited on the name went on: Tab confirms or applies it.
    const asked = w.said("clarifying_question");
    const share = w.db.shares(pizza.expense_id).find((s) => s.phone === DHANUSH);
    expect(asked.length > 1 || share?.fixed_cents === 1000).toBe(true);
    expect(asked.some((q) => q.includes("who's dhanush"))).toBe(true);
    expect(asked.filter((q) => q.includes("who's dhanush"))).toHaveLength(1);
  });

  it("lists every unnamed member's last 4 when there are several", async () => {
    const w = world(script);
    withDhanush(w);
    w.db.mems.set(`${GROUP}:+14083103927`, { member_id: `${GROUP}:+14083103927`, group_id: GROUP, phone: "+14083103927", joined_at: w.ctx.now() });
    await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "dhanush actually owes 10");
    expect(w.said("clarifying_question")).toEqual(["wait who's dhanush? reply w their last 4: 2230 or 3927"]);
    await w.say("Priya", "its 2230");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("Dhanush");
    expect(w.db.members(GROUP).find((m) => m.phone === "+14083103927")?.name).toBeUndefined();
  });

  it("doesn't take digits that match nobody, or more than one member", async () => {
    const w = world(script);
    withDhanush(w);
    await w.say("Joe", "got pizza, $48");
    await w.say("Kian", "dhanush actually owes 10");
    await w.say("Kian", "9999");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBeUndefined();
  });

  it("asks unnamed members for their names again once the group is talking", async () => {
    const w = world({});
    withDhanush(w);
    w.db.out.set(`name_prompt:${GROUP}`, {
      action_id: `name_prompt:${GROUP}`, kind: "group_message", group_id: GROUP, text: "what should i call everyone?",
      purpose: "name_prompt", send_after: w.ctx.now(), status: "sent", created_at: w.ctx.now(),
    });
    const reasks = () => w.db.outbox().filter((o) => o.action_id.startsWith(`name_reask:${GROUP}:`));

    w.advance(5 * 60_000);
    w.db.ingest({ sender_phone: PEOPLE.Joe, group_id: GROUP, text: "lol" });
    await tick(w.ctx);
    expect(reasks()).toHaveLength(0); // too soon after the first prompt

    w.advance(30 * 60_000);
    await tick(w.ctx);
    expect(reasks()).toHaveLength(0); // nobody's talking

    w.db.ingest({ sender_phone: PEOPLE.Joe, group_id: GROUP, text: "who's coming tonight" });
    await tick(w.ctx);
    expect(reasks().map((o) => o.text)).toEqual(["…2230 what's your name? reply w your first name so i stop calling you by your number"]);
    await tick(w.ctx);
    expect(reasks()).toHaveLength(1);

    // Their answer names them.
    await processMessage(w.ctx, w.db.ingest({ sender_phone: DHANUSH, group_id: GROUP, text: "dhanush" }));
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("Dhanush");
  });
});

describe("thinking tapback", () => {
  it("puts 👀 on a message Tab will answer before working on the reply, once", async () => {
    const w = world(script);
    w.ctx.eyes = true;
    await w.say("Joe", "got pizza, $48");
    const mine = w.db.outbox().filter((o) => o.target_message_id && w.db.messages().some((m) => m.message_id === o.target_message_id && m.text === "got pizza, $48"));
    const eyes = mine.filter((o) => o.kind === "reaction" && o.reaction === "👀");
    expect(eyes).toHaveLength(1);
    const order = w.db.outbox().map((o) => o.action_id);
    const proposal = order.findIndex((id) => id.startsWith("split_proposal:"));
    expect(order.indexOf(eyes[0]!.action_id)).toBeLessThan(proposal);
  });

  // Vegas chat: "ok everyone paid" (unsure) and "its all been settled" (an
  // answer to nothing) each got a 👍, and nothing changed.
  it("puts nothing on a message Tab is only unsure about, or an answer to nothing open", async () => {
    const w = world(script);
    w.ctx.eyes = true;
    w.ctx.classify = async (input) =>
      input.message.text === "sent it to him" ? { intent: "payment_reported", confidence: 0.53 } : { intent: "answer", confidence: 0.9 };
    await w.say("Joe", "sent it to him");
    await w.say("Joe", "fr");
    expect(w.db.outbox().filter((o) => o.kind === "reaction")).toHaveLength(0);
  });

  it("stays quiet on chatter", async () => {
    const w = world(script);
    w.ctx.eyes = true;
    await w.say("Joe", "lol same");
    expect(w.db.outbox().filter((o) => o.kind === "reaction")).toHaveLength(0);
  });
});

describe("name replies the gate calls chatter", () => {
  function afterPrompt() {
    const w = world({});
    withDhanush(w);
    w.ctx.classify = async () => ({ intent: "ignore", confidence: 0.9 });
    w.db.out.set(`name_prompt:${GROUP}`, {
      action_id: `name_prompt:${GROUP}`, kind: "group_message", group_id: GROUP, text: "save my contact and reply w your first name",
      purpose: "name_prompt", send_after: w.ctx.now(), status: "sent", created_at: w.ctx.now(),
    });
    const liked = (text: string) => {
      const m = w.db.messages().find((x) => x.message_id && w.db.outbox().some((o) => o.target_message_id === x.message_id && o.reaction === "🫡") && (x.text ?? "").toLowerCase() === text.toLowerCase());
      return Boolean(m);
    };
    return { w, liked };
  }

  it("salutes someone Tab knows saying their name again", async () => {
    const { w } = afterPrompt();
    await w.say("Joe", "Joe");
    expect(w.db.outbox().filter((o) => o.kind === "reaction" && o.reaction === "🫡")).toHaveLength(1);
    expect(w.db.members(GROUP).find((m) => m.phone === PEOPLE.Joe)?.name).toBe("Joe");
  });

  it("names someone Tab didn't know from a bare first name, with a 🫡", async () => {
    const { w } = afterPrompt();
    await processMessage(w.ctx, w.db.ingest({ sender_phone: DHANUSH, group_id: GROUP, text: "dhanush" }));
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("Dhanush");
    expect(w.db.outbox().filter((o) => o.kind === "reaction" && o.reaction === "🫡")).toHaveLength(1);
  });

  it("leaves chatter, someone else's name, and late answers alone", async () => {
    const { w } = afterPrompt();
    await processMessage(w.ctx, w.db.ingest({ sender_phone: DHANUSH, group_id: GROUP, text: "lol" }));
    await w.say("Joe", "Priya"); // not Joe's own name: no rename by accident
    w.advance(45 * 60_000);
    await w.say("Kian", "Kian");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBeUndefined();
    expect(w.db.members(GROUP).find((m) => m.phone === PEOPLE.Joe)?.name).toBe("Joe");
    expect(w.db.outbox().filter((o) => o.kind === "reaction")).toHaveLength(0);
  });
});

describe("fixing someone's name", () => {
  it("renames a member when someone tells Tab, by name or last 4", async () => {
    const w = world({});
    withDhanush(w);
    w.db.mems.get(`${GROUP}:${DHANUSH}`)!.name = "Dhanush";
    await w.say("Joe", "tab change dhanush's contact to lil calc");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("lil calc");
    expect(w.said("other").at(-1)?.toLowerCase()).toBe("bet, dhanush is lil calc now");
    await w.say("Kian", "tab call 2230 Dhanush");
    expect(w.db.members(GROUP).find((m) => m.phone === DHANUSH)?.name).toBe("Dhanush");
    await w.say("Priya", "tab my name is Pri");
    expect(w.db.members(GROUP).find((m) => m.phone === PEOPLE.Priya)?.name).toBe("Pri");
  });

  it("asks who, for a name it doesn't have; leaves phone calls and chat alone", async () => {
    const w = world({});
    await w.say("Joe", "tab rename marco to big m");
    expect(w.said("clarifying_question").at(-1)).toBe("who's marco? say their name like i have it, or the last 4 of their number");
    await w.say("Joe", "tab call joe later");
    await w.say("Joe", "call priya tonight");
    expect(w.db.members(GROUP).find((m) => m.phone === PEOPLE.Joe)?.name).toBe("Joe");
    expect(w.db.members(GROUP).find((m) => m.phone === PEOPLE.Priya)?.name).toBe("Priya");
  });
});
