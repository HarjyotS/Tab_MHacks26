import { describe, expect, it } from "vitest";
import type { Intent } from "@tab/gate";
import { stubClassifier } from "@tab/gate";
import { askFallback, checkReply, type Facts } from "../src/brain/ask.js";
import { addInvite } from "../src/brain/threads.js";
import type { ReceiptRead } from "../src/extraction/receipt.js";
import { bannedPhraseIn, MARKDOWN } from "../src/copy/voice.js";
import { createLookup } from "../src/brain/lookup.js";
import { applyStyle, DEFAULT_STYLE } from "../src/copy/style.js";
import { type Chat, namesFor, styleFor } from "../src/brain/context.js";
import { GROUP, PEOPLE, toolClient, world, type AgentStep } from "./support/harness.js";
import { seedHistory } from "./support/seed.js";

function setup() {
  const w = world({});
  seedHistory(w.db);
  const clock = { now: 0 };
  const logs: Record<string, unknown>[] = [];
  w.ctx.log = (event, fields) => void (event === "ask" && logs.push(fields));
  const agent = (steps: AgentStep[], extra: { budgetMs?: number; maxRounds?: number } = {}) => {
    const t = toolClient(steps, clock);
    w.ctx.ask = { client: t.client, model: "m", clock: () => clock.now, ...extra };
    return t;
  };
  return { w, agent, logs, clock };
}

// What Tab sends after `say` applies the group's style (lowercase, member
// names kept), the same as every template.
const styled = (w: ReturnType<typeof world>, text: string, chat: Chat = { group_id: GROUP }) =>
  applyStyle(text, styleFor(w.ctx, chat), namesFor(w.ctx, chat));

const toolText = (t: ReturnType<typeof toolClient>, i: number) =>
  t.requests[i]!.messages.filter((m) => m.role === "tool").map((m) => String(m.content)).join("\n");

describe("checkReply (P6 and §9.3 on the agent's words)", () => {
  const w = world({});
  seedHistory(w.db);
  const l = createLookup(w.ctx, { groups: [GROUP], asker: PEOPLE.Priya });
  const facts: Facts = {
    outputs: [JSON.stringify(l.expenseDetail("e1")), JSON.stringify(l.totals({ query: "food" }))],
    question: "what was on the bistro receipt?",
    members: ["Joe", "Kian", "Priya", "Jake"],
    outsiders: ["Sam"],
    style: DEFAULT_STYLE,
  };
  const check = (text: string) => checkReply(text, facts)?.code ?? null;

  it("accepts amounts, counts, and names straight from tool results", () => {
    expect(check("The Bistro was $47.07, with $3.12 tax and $5.00 tip.\nKian had the Burger Deluxe ($14.99).")).toBeNull();
    expect(check("$158.07 on food across 3 expenses.")).toBeNull();
    expect(check("You had the caesar salad, $16 with tax")).toBe("amount");
  });

  it("normalizes amounts before comparing: $5 is $5.00", () => {
    expect(check("Tip was $5.")).toBeNull();
    expect(check("Tip was $5.50.")).toBe("amount");
  });

  it("rejects an amount the tools never returned, even a correct-looking sum", () => {
    // $14.99 + $9.99 = $24.98, but Grok doesn't get to add.
    expect(check("Burger and salad came to $24.98.")).toBe("amount");
  });

  it("never counts numbers someone typed: quoted chat in tool results, or the question", () => {
    const quoted = { ...facts, outputs: [...facts.outputs, JSON.stringify(l.searchMessages({ query: "tacos" })), JSON.stringify(l.expenseDetail("e2"))], question: "why do i owe jake 12" };
    expect(JSON.stringify(quoted.outputs)).toMatch(/tacos 36/);
    expect(checkReply("Priya spent 36 on tacos.", quoted)?.code).toBe("number");
    expect(checkReply("You owe Jake 12.", quoted)?.code).toBe("number");
    expect(checkReply("Pizza was $48.", quoted)).toBeNull(); // the computed total, not the typed "$48"
  });

  it("rejects counts and dates that aren't in tool results, and spelled-out numbers", () => {
    expect(check("That was 9 days ago.")).toBe("number");
    expect(check("Split three ways.")).toBe("spelled_number");
  });

  it("rejects banned phrases, markdown, refs, too many lines, and emoji in a chat that doesn't use them", () => {
    expect(check("Kian and Priya still haven't paid.")).toBe("banned_phrase");
    expect(check("Here's where things stand: The Bistro was $47.07")).toBe("banned_phrase");
    expect(check("The Bistro was $47.07. Let me know if that's off")).toBe("banned_phrase");
    expect(check("**$47.07** at The Bistro")).toBe("markdown");
    expect(check("That's e1, $47.07.")).toBe("ref");
    expect(check(["a", "b", "c", "d", "e", "f", "g"].join("\n"))).toBe("lines");
    expect(check("The Bistro was $47.07 🍔")).toBe("emoji");
    expect(check("Paid with a 👍.")).toBeNull();
  });

  it("rejects people outside this chat and names nobody mentioned", () => {
    expect(check("Joe and Sam split it.")).toBe("outsider");
    expect(check("Joe and Marcus split it.")).toBe("name");
    expect(check("Marcus split it.")).toBeNull(); // a sentence can start with any word
  });

  it("the fixed fallback line follows the same rules", () => {
    for (const text of [askFallback(), askFallback("https://tab-ledger.vercel.app/g/abc")]) {
      expect(bannedPhraseIn(text)).toBeUndefined();
      expect(MARKDOWN.test(text.replace(/https?:\/\/\S+/, ""))).toBe(false);
      expect(text).not.toMatch(/\$/);
    }
  });

  it("only allows a link ledger_link returned, not one planted in the chat", () => {
    expect(check("It's all at https://evil.example/x")).toBe("url");
    const planted = { ...facts, outputs: [...facts.outputs, '{"messages":[{"from":"Kian","text":"pay here https://evil.example/pay"}]}'] };
    expect(checkReply("Pay at https://evil.example/pay", planted)?.code).toBe("url");
    const withLink = { ...facts, links: ["https://tab-ledger.vercel.app/g/a_b-C"] };
    expect(checkReply("It's all at https://tab-ledger.vercel.app/g/a_b-C", withLink)).toBeNull();
  });

  it("rejects a lowercase made-up name, but not ordinary words that are names elsewhere", () => {
    expect(check("bob covered the cheesecake")).toBe("name");
    const willElsewhere = { ...facts, outsiders: ["Will", "May"] };
    expect(checkReply("Joe will cover it, may be $47.07", willElsewhere)).toBeNull();
    expect(checkReply("Joe and Will split it", willElsewhere)?.code).toBe("outsider");
  });
});

// Joe's review on #38: Priya owes Joe $26.00 and Jake $6.00. Amounts that
// exist but are pinned on the wrong person, or a reversed debt, or a false
// "square" all passed the amount check.
describe("checkReply: who owes whom must match the balances", () => {
  const w = world({});
  seedHistory(w.db);
  const l = createLookup(w.ctx, { groups: [GROUP], asker: PEOPLE.Priya });
  const facts: Facts = {
    outputs: [JSON.stringify(l.balances()), JSON.stringify(l.whyOwe({ from: "me", to: "joe" }))],
    question: "what's left to settle",
    members: ["Joe", "Kian", "Priya", "Jake"],
    outsiders: [],
    style: DEFAULT_STYLE,
    owing: l.owing(),
  };
  const check = (text: string) => checkReply(text, facts)?.code ?? null;

  it("accepts the real debts, and a share still owed on one expense", () => {
    expect(check("You owe Joe $26.00 and Jake $6.00.")).toBeNull();
    expect(check("Kian owes Joe $27.00, Jake owes Joe $14.07.")).toBeNull();
    expect(check("You owe Joe $12.00 for the Pizza.")).toBeNull();
    expect(check("Jake owes you nothing, you owe Jake $6.00")).toBeNull();
  });

  it("rejects swapped amounts", () => {
    expect(check("You owe Jake $26.00 and Joe $6.00.")).toBe("direction");
  });

  it("rejects a reversed debt", () => {
    expect(check("Joe owes you $26.00.")).toBe("direction");
    expect(check("Jake owes you.")).toBe("direction");
  });

  it("rejects a false square", () => {
    expect(check("You're all square.")).toBe("direction");
    expect(check("Everyone's square.")).toBe("direction");
    expect(check("Priya is square.")).toBe("direction");
  });
});

describe("the money brain answers from the database", () => {
  it("what was on the bistro receipt? lists items and prices from the stored receipt", async () => {
    const { w, agent, logs } = setup();
    const reply = "The Bistro, $47.07 total:\nBurger Deluxe $14.99 (Kian)\nCaesar Salad $9.99 (you)\n2 soft drinks $5.98 (you and Jake)\nCheesecake $7.99, shared\nPlus $3.12 tax and $5.00 tip.";
    const t = agent([{ call: [{ name: "find_expenses", args: { query: "bistro" } }] }, { call: [{ name: "expense_detail", args: { ref: "e1" } }] }, { reply }]);
    const ask = await w.say("Priya", "what was on the bistro receipt?");
    expect(w.said("balance_reply")).toEqual([styled(w, reply)]);
    expect(w.db.outbox().find((o) => o.purpose === "balance_reply")!.target_message_id).toBe(ask.message_id);
    expect(toolText(t, 2)).toMatch(/CHEESECAKE/);
    expect(logs).toEqual([expect.objectContaining({ kind: "money_question", outcome: "sent", tools: ["find_expenses", "expense_detail"] })]);
    expect(ask.text).toBe("what was on the bistro receipt?"); // kept: it's about money
  });

  it("how much did we spend on food? gives the code-computed total", async () => {
    const { w, agent } = setup();
    const reply = "$158.07 on food across 3 expenses: The Bistro, Pizza, and Groceries.";
    const t = agent([{ call: [{ name: "totals", args: { query: "food" } }] }, { reply }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(toolText(t, 1)).toMatch(/"total_spent":"\$158\.07"/);
    expect(w.said("balance_reply")).toEqual([styled(w, reply)]);
  });

  it("balances, breakdowns, and why? stay deterministic templates: the agent never sees them", async () => {
    const { w, agent } = setup();
    const t = agent([]);
    await w.say("Priya", "what do i owe");
    expect(w.said("balance_reply")).toEqual([styled(w, "You owe Joe $26.00 and Jake $6.00.")]);
    await w.say("Priya", "why");
    await w.say("Jake", "why do i owe joe 14");
    expect(w.said("breakdown_reply")).toHaveLength(2);
    expect(w.said("breakdown_reply")[0]).toMatch(/pizza \$12\.00: split 4 ways\nthe bistro \$14\.00/i);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("a money question whose answer gets a debt backwards is rejected, retried, then the fixed line", async () => {
    const { w, agent, logs } = setup();
    agent([
      { call: [{ name: "balances" }] },
      { reply: "Joe owes you $26.00." },
      { reply: "You owe Jake $26.00 and Joe $6.00." },
    ]);
    await w.say("Priya", "how much do joe and jake get from me?");
    expect(w.said("balance_reply")).toEqual(["couldn't pin that one down"]);
    expect(logs.map((l) => l.rejected)).toEqual(["direction", "direction"]);
  });

  it("who still hasn't paid? retries a banned phrase once, then sends the fixed answer", async () => {
    const { w, agent, logs } = setup();
    const good = "Kian ($15.00) and Priya ($14.00) haven't tapped 👍 on The Bistro yet.\nJake's $8.07 is on its way.";
    const t = agent([{ call: [{ name: "settle_status" }] }, { reply: "Kian and Priya still haven't paid." }, { reply: good }]);
    await w.say("Joe", "who still hasn't paid?");
    expect(w.said("balance_reply")).toEqual([styled(w, good)]);
    const feedback = t.requests[2]!.messages.at(-1)!;
    expect(feedback).toMatchObject({ role: "tool", content: expect.stringMatching(/Don't say "still haven't"/) });
    expect(logs.map((l) => l.outcome)).toEqual(["rejected", "sent"]);
  });

  it("an amount the tools never returned is rejected, retried, then falls back to a fixed line", async () => {
    const { w, agent, logs } = setup();
    agent([{ call: [{ name: "totals", args: { query: "food" } }] }, { reply: "About $160.00 on food." }, { reply: "Roughly $150.00." }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")).toEqual(["couldn't pin that one down"]);
    expect(logs.map((l) => [l.outcome, l.rejected])).toEqual([["rejected", "amount"], ["rejected", "amount"]]);
  });

  it("the fixed line carries the ledger link when there is one", async () => {
    const { w, agent } = setup();
    w.ctx.ledger = { baseUrl: "https://tab-ledger.vercel.app", key: "k".repeat(32) };
    agent([{ fail: "500" }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")[0]).toMatch(/^couldn't pin that one down\. it's all on the ledger: https:\/\/tab-ledger\.vercel\.app\/g\//);
  });

  it("a slow answer times out after 15 seconds and the fixed line goes out", async () => {
    const slow = setup();
    slow.agent([{ call: [{ name: "totals", args: { query: "food" } }], advance: 16_000 }, { reply: "too late" }]);
    await slow.w.say("Kian", "how much did we spend on food?");
    expect(slow.w.said("balance_reply")).toEqual(["couldn't pin that one down"]);
    expect(slow.logs).toEqual([expect.objectContaining({ outcome: "timeout" })]);
  });

  it("with no agent configured, questions get the templates", async () => {
    const { w } = setup();
    await w.say("Priya", "what do i owe");
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")).toEqual([styled(w, "You owe Joe $26.00 and Jake $6.00."), "couldn't pin that one down"]);
  });

  it("respects the round budget: after 5 tool rounds it must reply", async () => {
    const { w, agent } = setup();
    const t = agent([...Array.from({ length: 5 }, () => ({ call: [{ name: "settle_status" }] })), { reply: "Kian ($15.00) and Priya ($14.00) haven't tapped 👍 yet." }]);
    await w.say("Joe", "who still hasn't paid?");
    expect(t.requests).toHaveLength(6);
    expect(t.requests[5]!.tools).toEqual(["reply"]);
    expect(w.said("balance_reply")).toHaveLength(1);
  });

  it("a DM only sees the sender's groups", async () => {
    const { w, agent } = setup();
    const t = agent([{ call: [{ name: "find_expenses", args: { query: "sushi" } }] }, { reply: "No sushi on your tab." }]);
    await w.dm("Priya", "how much was the sushi?");
    expect(toolText(t, 1)).toMatch(/"count":0/);
    expect(w.db.outbox().find((o) => o.purpose === "balance_reply")).toMatchObject({ kind: "dm", to_phone: PEOPLE.Priya, text: styled(w, "No sushi on your tab.", { dm_phone: PEOPLE.Priya }) });
  });

  it("an inline reply to Tab's message about an expense hands that expense to the agent", async () => {
    const { w, agent } = setup();
    w.db.out.set("proposal:pizza", {
      action_id: "proposal:pizza", kind: "group_message", group_id: GROUP, text: "Pizza, $48.00. $12.00 each.", expense_id: "pizza",
      purpose: "split_proposal", send_after: new Date(0), status: "sent", sent_photon_id: "imsg-pizza", created_at: new Date(0),
    });
    const t = agent([{ reply: "Even, split 4 ways: $12.00 each." }]);
    await w.say("Kian", "how was this split?", { reply_to_id: "imsg-pizza" });
    const user = String(t.requests[0]!.messages[1]!.content);
    expect(user).toMatch(/<expense_they_replied_to>[\s\S]*"description":"Pizza"/);
    expect(user).toMatch(/<replying_to_tab>"Pizza, \$48\.00/);
    expect(w.said("balance_reply")).toEqual([styled(w, "Even, split 4 ways: $12.00 each.")]);
  });

  it("matches the group's style after checking", async () => {
    const { w, agent } = setup();
    for (const text of ["lol", "omw", "ok cool"]) await w.say("Kian", text);
    agent([{ call: [{ name: "totals", args: { query: "food" } }] }, { reply: "$158.07 on food." }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")).toEqual(["$158.07 on food"]);
  });

  it("never shows phone numbers to Grok, in the prompt or any tool result", async () => {
    const { w, agent } = setup();
    const t = agent([{ call: [{ name: "balances" }, { name: "settle_status" }, { name: "find_expenses" }, { name: "payments" }] }, { reply: "Everyone's on it." }]);
    await w.say("Joe", "what's left to settle?");
    expect(JSON.stringify(t.requests)).not.toMatch(/555555\d{4}/);
  });
});

// Harjyot: "it just gives up". A money-ish message that got no reply and
// changed nothing goes to the money brain, which answers or asks once.
describe("last resort: never silent on a money-ish message", () => {
  function unsure(intent: Intent, confidence: number) {
    const s = setup();
    const fallbacks: Record<string, unknown>[] = [];
    const log = s.w.ctx.log;
    s.w.ctx.log = (event, fields) => {
      if (event === "fallback_ask") fallbacks.push(fields);
      log(event, fields);
    };
    s.w.ctx.classify = async () => ({ intent, confidence });
    return { ...s, fallbacks };
  }

  it("a half-sure claim gets one specific question built from the receipt", async () => {
    const { w, agent, fallbacks } = unsure("claim", 0.5);
    const question = "want me to put both soft drinks on you and the Cheesecake on Jake, rest split?";
    const t = agent([{ call: [{ name: "expense_detail", args: { ref: "e1" } }] }, { reply: question }]);
    await w.say("Priya", "i got both drinks and jake got the cheesecake");
    expect(w.said("clarifying_question")).toEqual([styled(w, question)]);
    expect(fallbacks).toEqual([expect.objectContaining({ reason: "unsure_claim" })]);
    expect(String(t.requests[0]!.messages[1]!.content)).toMatch(/Tab wasn't sure what this message wants/);
  });

  // The groceries proposal's standing "anything uneven?" (#35 threads).
  const groceriesOpen = (w: ReturnType<typeof world>) =>
    addInvite(w.ctx, { group_id: GROUP }, { id: "split_proposal:groceries", text: "Groceries, $63.00. $15.75 each. Anything uneven?", kind: "split_open", expense_id: "groceries" });

  it("a half-sure adjustment below the clarify bar gets a reply while a split is open", async () => {
    const { w, agent, fallbacks } = unsure("split_adjustment", 0.46);
    groceriesOpen(w);
    agent([{ reply: "update the Groceries how? who's in or out?" }]);
    await w.say("Kian", "update it");
    expect(w.said("clarifying_question")).toEqual([styled(w, "update the Groceries how? who's in or out?")]);
    expect(fallbacks).toEqual([expect.objectContaining({ reason: "unsure_split_adjustment" })]);
  });

  it("a stray guess while a split is open gets a reply, with the open split and Tab's question handed over", async () => {
    const { w, agent, fallbacks } = unsure("name_reply", 0.41);
    groceriesOpen(w);
    const t = agent([{ reply: "same split as before on the Groceries, so $15.75 each?" }]);
    await w.say("Kian", "same as before i guess");
    expect(w.said("clarifying_question")).toEqual([styled(w, "same split as before on the Groceries, so $15.75 each?")]);
    expect(fallbacks).toEqual([expect.objectContaining({ reason: "open_question" })]);
    const user = String(t.requests[0]!.messages[1]!.content);
    expect(user).toMatch(/<expense_they_replied_to>[\s\S]*"description":"Groceries"/);
    expect(user).toMatch(/<tab_open_questions[^>]*>\n- "Groceries, \$63\.00/);
  });

  it("a guess below the clarify bar with nothing open never reaches Grok, and its text is cleared (§19)", async () => {
    const { w, agent } = unsure("split_adjustment", 0.46);
    const t = agent([]);
    const m = await w.say("Kian", "update it");
    expect(t.create).not.toHaveBeenCalled();
    expect(m.text).toBeUndefined();
  });

  it("a handler that throws still gets a reply", async () => {
    const { w, agent } = unsure("split_adjustment", 0.95);
    agent([{ reply: "which split, the Groceries?" }]);
    const m = await w.say("Kian", "update it"); // no scripted extraction: the handler throws
    expect(w.said("clarifying_question")).toEqual([styled(w, "which split, the Groceries?")]);
    expect(m.status).toBe("error");
  });

  it("stays quiet for chatter, and for a non-money guess with nothing open", async () => {
    const chatter = unsure("ignore", 0.9);
    const t1 = chatter.agent([]);
    await chatter.w.say("Kian", "lol");
    expect(t1.create).not.toHaveBeenCalled();

    const w = world({});
    const t2 = toolClient([]);
    w.ctx.ask = { client: t2.client, model: "m" };
    w.ctx.classify = async () => ({ intent: "name_reply", confidence: 0.41 });
    await w.say("Kian", "just me and priya");
    expect(t2.create).not.toHaveBeenCalled();
  });

  it("doesn't double-reply when something else already answered", async () => {
    const { w, agent } = unsure("expense", 0.6);
    const t = agent([]);
    await w.say("Kian", "dinner 40"); // the clarify band asks "Want me to split that?"
    expect(w.said("clarifying_question")).toEqual([styled(w, "Want me to split that?")]);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("never claims to have changed anything; after a retry it stays quiet rather than guess, and keeps no text", async () => {
    const { w, agent, logs } = unsure("split_adjustment", 0.46); // below the bar: kept only if answered
    groceriesOpen(w);
    agent([{ reply: "done, updated the split" }, { reply: "ok I put the drinks on you" }]);
    const m = await w.say("Priya", "i got both drinks");
    expect(w.said("clarifying_question")).toEqual([]);
    expect(logs.map((l) => l.rejected)).toEqual(["claims_action", "claims_action"]);
    expect(m.text).toBeUndefined(); // not kept: Tab never answered it
  });
});

// A fresh even-split receipt, so a claim has something to change.
const BISTRO: ReceiptRead = {
  receipt: {
    is_receipt: true,
    merchant: "THE BISTRO",
    items: [
      { description: "BURGER DELUXE", quantity: 1, amount_cents: 1499 },
      { description: "CAESAR SALAD", quantity: 1, amount_cents: 999 },
      { description: "2 x SOFT DRINK @ $2.99", quantity: 1, amount_cents: 598 },
      { description: "CHEESECAKE", quantity: 1, amount_cents: 799 },
    ],
    subtotal_cents: 3895,
    tax_cents: 312,
    tip_cents: 500,
    total_cents: 4707,
  },
  tip_line_blank: false,
  math_problem: null,
  currency: "USD",
};
const DRINKS = "i got both drinks and jake got the cheesecake";
const adjustment = {
  is_expense: true, amount_cents: null, amount_is_per_person: false, description: null, payer: "unknown", payer_name: null,
  participants: "everyone", participant_names: [], exclusion_names: [],
  fixed: [{ name: "me", amount_cents: null, item: "both drinks" }, { name: "jake", amount_cents: null, item: "cheesecake" }],
};

async function freshReceipt(verdict: [Intent, number]) {
  const w = world({ receipt: { bistro: BISTRO }, expense: { [`adjustment|${DRINKS}`]: adjustment } });
  const clock = { now: 0 };
  await w.photo("Joe", "bistro");
  const e = w.db.expenses().find((x) => x.description.toLowerCase().includes("bistro"))!;
  w.ctx.classify = async (input) => (input.message.text === DRINKS ? { intent: verdict[0], confidence: verdict[1] } : stubClassifier(input));
  const agent = (steps: AgentStep[]) => {
    const t = toolClient(steps, clock);
    w.ctx.ask = { client: t.client, model: "m", clock: () => clock.now };
    return t;
  };
  const share = (who: keyof typeof PEOPLE) => w.db.shares(e.expense_id).find((s) => s.phone === PEOPLE[who])!;
  return { w, e, agent, share };
}

describe("last resort and the rest of the brain", () => {
  it("a yes to the agent's \"want me to…?\" runs the original message through the real handler", async () => {
    const { w, agent, share } = await freshReceipt(["claim", 0.45]); // below the clarify bar
    const question = "want me to put both drinks on you and the Cheesecake on Jake, rest split?";
    const t = agent([{ reply: question }]);
    await w.say("Priya", DRINKS);
    expect(w.said("clarifying_question").at(-1)).toBe(styled(w, question));
    expect(share("Priya").fixed_cents).toBeUndefined(); // the agent changed nothing
    await w.say("Priya", "yeah");
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(share("Priya").fixed_cents).toBe(598);
    expect(share("Jake").fixed_cents).toBe(799);
  });

  it("when #35's own fallback already asked, the last resort stays out: exactly one reply", async () => {
    const { w, agent } = await freshReceipt(["claim", 0.5]); // clarify band: #35 confirms the change
    const t = agent([{ reply: "want me to put both drinks on you?" }]);
    const m = await w.say("Priya", DRINKS);
    const replies = w.db.outbox().filter((o) => o.target_message_id === m.message_id && o.kind !== "reaction");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toMatch(/change the split/i);
    expect(t.create).not.toHaveBeenCalled();
  });
});
