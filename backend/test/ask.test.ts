import { describe, expect, it } from "vitest";
import { checkReply, type Facts } from "../src/brain/ask.js";
import { createLookup } from "../src/brain/lookup.js";
import { DEFAULT_STYLE } from "../src/copy/style.js";
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

  it("rejects counts and dates that aren't in tool results, and spelled-out numbers", () => {
    expect(check("That was 9 days ago.")).toBe("number");
    expect(check("Split three ways.")).toBe("spelled_number");
  });

  it("rejects banned phrases, markdown, refs, too many lines, and emoji in a chat that doesn't use them", () => {
    expect(check("Kian and Priya still haven't paid.")).toBe("banned_phrase");
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

  it("only allows a link a tool returned", () => {
    expect(check("It's all at https://evil.example/x")).toBe("url");
    const withLink = { ...facts, outputs: [...facts.outputs, '{"links":[{"url":"https://tab-ledger.vercel.app/g/a_b-C"}]}'] };
    expect(checkReply("It's all at https://tab-ledger.vercel.app/g/a_b-C", withLink)).toBeNull();
  });
});

describe("the money brain answers from the database", () => {
  it("what was on the bistro receipt? lists items and prices from the stored receipt", async () => {
    const { w, agent, logs } = setup();
    const reply = "The Bistro, $47.07 total:\nBurger Deluxe $14.99 (Kian)\nCaesar Salad $9.99 (you)\n2 soft drinks $5.98 (you and Jake)\nCheesecake $7.99, shared\nPlus $3.12 tax and $5.00 tip.";
    const t = agent([{ call: [{ name: "find_expenses", args: { query: "bistro" } }] }, { call: [{ name: "expense_detail", args: { ref: "e1" } }] }, { reply }]);
    const ask = await w.say("Priya", "what was on the bistro receipt?");
    expect(w.said("balance_reply")).toEqual([reply]);
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
    expect(w.said("balance_reply")).toEqual([reply]);
  });

  it("why do i owe joe 14 uses only Joe's expenses, and goes out as a breakdown", async () => {
    const { w, agent } = setup();
    const reply = "Pizza $12.00 and The Bistro $8.07, minus the $6.00 Uber Joe owes you.\nSo $14.07.";
    const t = agent([{ call: [{ name: "why_owe", args: { from: "me", to: "joe" } }] }, { reply }]);
    await w.say("Jake", "why do i owe joe 14");
    expect(toolText(t, 1)).not.toMatch(/Groceries|Kian|Priya/);
    expect(w.said("breakdown_reply")).toEqual([reply]);
  });

  it("who still hasn't paid? retries a banned phrase once, then sends the fixed answer", async () => {
    const { w, agent, logs } = setup();
    const good = "Kian ($15.00) and Priya ($14.00) haven't tapped 👍 on The Bistro yet.\nJake's $8.07 is on its way.";
    const t = agent([{ call: [{ name: "settle_status" }] }, { reply: "Kian and Priya still haven't paid." }, { reply: good }]);
    await w.say("Joe", "who still hasn't paid?");
    expect(w.said("balance_reply")).toEqual([good]);
    const feedback = t.requests[2]!.messages.at(-1)!;
    expect(feedback).toMatchObject({ role: "tool", content: expect.stringMatching(/Don't say "still haven't"/) });
    expect(logs.map((l) => l.outcome)).toEqual(["rejected", "sent"]);
  });

  it("an amount the tools never returned is rejected, retried, then falls back to a fixed line", async () => {
    const { w, agent, logs } = setup();
    agent([{ call: [{ name: "totals", args: { query: "food" } }] }, { reply: "About $160.00 on food." }, { reply: "Roughly $150.00." }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")).toEqual(["Couldn't pin that one down."]);
    expect(logs.map((l) => [l.outcome, l.rejected])).toEqual([["rejected", "amount"], ["rejected", "amount"]]);
  });

  it("the fixed line carries the ledger link when there is one", async () => {
    const { w, agent } = setup();
    w.ctx.ledger = { baseUrl: "https://tab-ledger.vercel.app", key: "k".repeat(32) };
    agent([{ fail: "500" }]);
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")[0]).toMatch(/^Couldn't pin that one down\. Everything's on the ledger: https:\/\/tab-ledger\.vercel\.app\/g\//);
  });

  it("what do i owe: the agent answers, and the template answers when it fails or is slow", async () => {
    const { w, agent } = setup();
    agent([{ call: [{ name: "balances", args: { person: "me" } }] }, { reply: "You owe Joe $26.00 and Jake $6.00." }]);
    await w.say("Priya", "what do i owe");
    expect(w.said("balance_reply")).toEqual(["You owe Joe $26.00 and Jake $6.00."]);

    const slow = setup();
    slow.agent([{ call: [{ name: "balances", args: { person: "me" } }], advance: 26_000 }, { reply: "too late" }]);
    await slow.w.say("Priya", "what do i owe");
    expect(slow.w.said("balance_reply")).toEqual(["You owe Joe $26.00 and Jake $6.00."]); // the template
    expect(slow.logs).toEqual([expect.objectContaining({ outcome: "timeout" })]);
  });

  it("with no agent configured, questions get the templates", async () => {
    const { w } = setup();
    await w.say("Priya", "what do i owe");
    await w.say("Kian", "how much did we spend on food?");
    expect(w.said("balance_reply")).toEqual(["You owe Joe $26.00 and Jake $6.00.", "Couldn't pin that one down."]);
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
    expect(w.db.outbox().find((o) => o.purpose === "balance_reply")).toMatchObject({ kind: "dm", to_phone: PEOPLE.Priya, text: "No sushi on your tab." });
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
    expect(w.said("balance_reply")).toEqual(["Even, split 4 ways: $12.00 each."]);
  });

  it("why? after an answer explains it, through the agent", async () => {
    const { w, agent } = setup();
    agent([{ call: [{ name: "balances", args: { person: "me" } }] }, { reply: "You owe Joe $26.00 and Jake $6.00." }]);
    await w.say("Priya", "what do i owe");
    const t = agent([{ call: [{ name: "why_owe", args: { from: "me", to: "joe" } }] }, { reply: "The Bistro $14.00 and Pizza $12.00." }]);
    await w.say("Priya", "why");
    expect(String(t.requests[0]!.messages[1]!.content)).toMatch(/This follows Tab's last answer/);
    expect(w.said("breakdown_reply")).toEqual(["The Bistro $14.00 and Pizza $12.00."]);
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
