// The money brain (#38) answering history questions (§7.8 History): the
// history and payments lookups, every number checked in code, and a DM that
// sees only the sender's own money (§19).
import { describe, expect, it } from "vitest";
import { stubClassifier, type ClassifyResult } from "@tab/gate";
import { checkReply, type Facts } from "../src/brain/ask.js";
import { createLookup, scopeOf } from "../src/brain/lookup.js";
import { processMessage } from "../src/brain/process.js";
import { applyStyle, DEFAULT_STYLE } from "../src/copy/style.js";
import { namesFor, styleFor } from "../src/brain/context.js";
import { GROUP, PEOPLE, toolClient, world, type AgentStep } from "./support/harness.js";
import { seedHistory } from "./support/seed.js";

// The gate's verdicts, by message text.
function gateSays(w: ReturnType<typeof world>, verdicts: Record<string, ClassifyResult>) {
  w.ctx.classify = async (input) => verdicts[input.message.text ?? ""] ?? stubClassifier(input);
}

function brain(steps: AgentStep[]) {
  const w = world({});
  seedHistory(w.db);
  const clock = { now: 0 };
  const t = toolClient(steps, clock);
  w.ctx.ask = { client: t.client, model: "m", clock: () => clock.now };
  const rejected: unknown[] = [];
  w.ctx.log = (event, fields) => void (event === "ask" && fields.rejected && rejected.push(fields.rejected));
  const toolText = (i: number) => t.requests[i]!.messages.filter((x) => x.role === "tool").map((x) => String(x.content)).join("\n");
  const styled = (text: string, chat: { group_id?: string; dm_phone?: string } = { group_id: GROUP }) =>
    applyStyle(text, styleFor(w.ctx, chat), namesFor(w.ctx, chat));
  return { w, t, toolText, styled, rejected };
}

describe("open-ended history questions go to the money brain", () => {
  it("\"when did kian pay jake back?\" in the group: history with dates, every number checked", async () => {
    const reply = "Kian paid Jake $6.00 for the Uber to the airport on Wed, Sep 30.";
    const { w, t, toolText, styled } = brain([{ call: [{ name: "history", args: { person: "kian", with: "jake", kind: "payments" } }] }, { reply }]);
    gateSays(w, { "when did kian pay jake back?": { intent: "money_question", confidence: 0.9 } });
    await w.say("Joe", "when did kian pay jake back?");
    expect(t.requests[0]!.tools).toContain("history");
    expect(toolText(1)).toMatch(/"type":"payment","when":"wed","date":"Wed, Sep 30","from":"Kian","to":"Jake","amount":"\$6\.00","for":"Uber to the airport"/);
    expect(w.said("balance_reply")).toEqual([styled(reply)]);
  });

  it("a made-up date or amount in a history answer is rejected", async () => {
    const { w, rejected } = brain([
      { call: [{ name: "history", args: { person: "kian", kind: "payments" } }] },
      { reply: "Kian paid Jake back on Oct 2." },
      { reply: "Kian paid Jake $7.00." },
    ]);
    gateSays(w, { "when did kian pay jake back?": { intent: "money_question", confidence: 0.9 } });
    await w.say("Joe", "when did kian pay jake back?");
    expect(rejected).toEqual(["number", "amount"]);
    expect(w.said("balance_reply")).toEqual(["couldn't pin that one down"]);
  });
});

describe("privacy: a DM shows only the sender's own money", () => {
  // Joe and Kian's golf, which Priya wasn't part of, and Kian paying Joe back for it.
  function golf(w: ReturnType<typeof world>) {
    w.db.exps.set("golf", {
      expense_id: "golf", group_id: GROUP, payer_phone: PEOPLE.Joe, description: "Golf", source_message_id: "src-golf",
      split_mode: "even", status: "settled", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
      created_at: new Date("2026-10-01T18:00:00Z"),
    });
    for (const [phone, status] of [[PEOPLE.Joe, "paid"], [PEOPLE.Kian, "paid"]] as const)
      w.db.shrs.set(`golf:${phone}`, { share_id: `golf:${phone}`, expense_id: "golf", phone, role: phone === PEOPLE.Joe ? "payer" : "participant", status, amount_cents: 4500, responded: true, followup_count: 0 });
    w.db.trs.set("tr-kian-golf", {
      transfer_id: "tr-kian-golf", group_id: GROUP, expense_id: "golf", from_phone: PEOPLE.Kian, to_phone: PEOPLE.Joe, amount_cents: 4500,
      status: "done", approved_by_message_id: "react-golf", created_at: new Date("2026-10-02T18:00:00Z"), completed_at: new Date("2026-10-02T18:00:10Z"),
    });
  }

  it("the lookups never show Priya what she wasn't part of: other people's expenses, payments, or debts", async () => {
    const w = world({});
    seedHistory(w.db);
    golf(w);
    const dm = createLookup(w.ctx, scopeOf(w.ctx, w.db.ingest({ sender_phone: PEOPLE.Priya, text: "show my history" })));
    const outputs = [
      dm.history(), dm.history({ person: "kian" }), dm.payments(), dm.payments({ person: "kian" }), dm.balances(), dm.balances({ person: "kian" }),
      dm.findExpenses({}), dm.totals({}), dm.settleStatus(), dm.searchMessages({}), dm.expenseDetail("e3"),
    ].map((x) => JSON.stringify(x));
    for (const out of outputs) {
      expect(out).not.toMatch(/Golf|\$45\.00|\$90\.00/);
      expect(out).not.toMatch(/"from":"Kian","to":"(Jake|Joe)"/); // Kian's own payments
      expect(out).not.toMatch(/"from":"(Kian|Jake)","owes":"Joe"/); // other people's debts
      expect(out).not.toMatch(/"name":"Kian","amount":"\$15\.00"/); // Kian's unpaid bistro share
    }
    expect(dm.whyOwe({ from: "kian", to: "joe" })).toMatchObject({ error: expect.stringMatching(/DM/) });
    // The bistro was hers too: everyone's share shows, but only her own payment status.
    const bistro = dm.expenseDetail("e1") as { shares: Record<string, string>[] };
    expect(bistro.shares.find((x) => x.name === "Kian")).toEqual(expect.not.objectContaining({ status: expect.anything() }));
    expect(bistro.shares.find((x) => x.name === "Priya")).toMatchObject({ owes_payer: "$14.00", status: "owed, not paid yet" });
    expect(dm.balances()).toMatchObject({ debts: [{ from: "Priya", owes: "Joe", amount: "$26.00" }, { from: "Priya", owes: "Jake", amount: "$6.00" }] });
    // In the group, the same lookups see everything in it.
    const group = createLookup(w.ctx, { groups: [GROUP], asker: PEOPLE.Priya });
    expect(JSON.stringify(group.payments())).toMatch(/"from":"Kian","to":"Joe","amount":"\$45\.00"/);
  });

  it("Priya's DM history: her expenses and payments, newest first, with her part", () => {
    const w = world({});
    seedHistory(w.db);
    const dm = createLookup(w.ctx, scopeOf(w.ctx, w.db.ingest({ sender_phone: PEOPLE.Priya, text: "show my history" })));
    const h = dm.history() as { person: string; events: Record<string, string>[] };
    expect(h.person).toBe("Priya");
    expect(h.events.map((e) => e.description)).toEqual(["Groceries", "Uber to the airport", "Pizza", "The Bistro"]);
    expect(h.events[2]).toMatchObject({ type: "expense", date: "Mon, Sep 28", total: "$48.00", paid_by: "Joe", Priya_part: "$12.00", part_status: "owed, not paid yet" });
    // Jake's payment to Joe is his, not hers.
    expect(h.events.some((e) => e.type === "payment")).toBe(false);
  });

  it("the money brain in a DM: scoped lookups, and a reply about other people's debts is rejected", async () => {
    const good = "you owe Joe $26.00 and Jake $6.00, nothing paid back yet";
    const { w, toolText, styled, rejected } = brain([
      { call: [{ name: "history" }, { name: "balances" }, { name: "payments" }] },
      { reply: "Kian owes Joe $27.00 and you owe Joe $26.00" },
      { reply: good },
    ]);
    golf(w);
    gateSays(w, { "show my history": { intent: "money_question", confidence: 0.9 } });
    w.advance(1000);
    const m = w.db.ingest({ sender_phone: PEOPLE.Priya, text: "show my history" });
    await processMessage(w.ctx, m);
    expect(toolText(1)).not.toMatch(/Golf|"from":"Kian"/);
    expect(String((w.ctx.ask!.client as any).chat.completions.create.mock.calls[0][0].messages[1].content)).toMatch(/<chat>private DM between Tab and the sender, about their own money/);
    // Kian's $27.00 never reached the DM's tools, so it can't be stated.
    expect(rejected).toEqual(["amount"]);
    expect(w.db.outbox().find((o) => o.target_message_id === m.message_id)).toMatchObject({ kind: "dm", to_phone: PEOPLE.Priya, text: styled(good, { dm_phone: PEOPLE.Priya }) });
  });

  it("checks DM answers against the sender's own debts only", () => {
    const w = world({});
    seedHistory(w.db);
    const dm = createLookup(w.ctx, scopeOf(w.ctx, w.db.ingest({ sender_phone: PEOPLE.Priya, text: "?" })));
    const facts: Facts = {
      outputs: [JSON.stringify(dm.balances()), JSON.stringify(dm.history())],
      question: "show my history",
      members: ["Joe", "Kian", "Priya", "Jake"],
      outsiders: [],
      style: DEFAULT_STYLE,
      owing: dm.owing(),
    };
    const check = (text: string) => checkReply(text, facts)?.code ?? null;
    expect(check("You owe Joe $26.00 and Jake $6.00.")).toBeNull();
    expect(check("Kian owes Joe $26.00.")).toBe("direction"); // a real amount, someone else's debt
    expect(check("Everyone's square.")).toBe("direction");
    // Square herself, she still can't speak for the group.
    w.db.shrs.forEach((x) => x.phone === PEOPLE.Priya && x.status === "locked" && (x.status = "paid"));
    const square = createLookup(w.ctx, scopeOf(w.ctx, w.db.ingest({ sender_phone: PEOPLE.Priya, text: "?" })));
    const squareFacts = { ...facts, outputs: [JSON.stringify(square.balances())], owing: square.owing() };
    expect(checkReply("You're all square.", squareFacts)).toBeNull();
    expect(checkReply("Nobody owes anything.", squareFacts)?.code).toBe("dm_scope");
  });
});
