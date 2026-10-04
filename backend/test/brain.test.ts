import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubClassifier } from "@tab/gate";
import { timing } from "../src/config.js";
import { Memory, type BrainCtx } from "../src/brain/context.js";
import { processMessage, tick } from "../src/brain/process.js";
import { extractExpense } from "../src/extraction/expense.js";
import type { ChatClient } from "../src/grok/structured.js";
import type { Message } from "../src/store/types.js";
import { MemoryDb } from "./support/memory-db.js";

const JOE = "+15555550101";
const KIAN = "+15555550102";
const PRIYA = "+15555550104";
const JAKE = "+15555550105";
const G = "house";

const base = {
  is_expense: true,
  amount_cents: null,
  description: null,
  amount_is_per_person: false,
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
};

// What scripted "Grok" returns for each message (mode + text). The real
// validation in extractExpense still runs on it.
const GROK: Record<string, object> = {
  "new|got pizza, $40": { ...base, amount_cents: 4000, description: "Pizza" },
  "new|got groceries, $63": {
    ...base,
    amount_cents: 6300,
    description: "Groceries",
  },
  "adjustment|not even, jake only had a $3 diet coke": {
    ...base,
    payer: "unknown",
    fixed: [{ name: "jake", amount_cents: 300, item: "diet coke" }],
  },
  "new|venmo me for the uber": { ...base, description: "Uber" },
  "new|venmo me for the uber\n22": {
    ...base,
    amount_cents: 2200,
    description: "Uber",
  },
  "new|pizza was $48 lol": {
    ...base,
    amount_cents: 4800,
    description: "Pizza",
    payer: "unknown",
  },
  "new|pizza was $48 lol\njoe did": {
    ...base,
    amount_cents: 4800,
    description: "Pizza",
    payer: "named",
    payer_name: "joe",
  },
};

function fakeGrok(key: string): ChatClient {
  const out = GROK[key];
  if (!out)
    throw new Error(`no scripted Grok output for ${JSON.stringify(key)}`);
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(out) } }],
  });
  return { chat: { completions: { create } } } as unknown as ChatClient;
}

let now: Date;
let db: MemoryDb;
let ctx: BrainCtx;
const log: string[] = [];

beforeEach(() => {
  now = new Date("2026-10-03T22:00:00Z");
  db = new MemoryDb(() => now);
  db.addGroup(G, [
    { phone: JOE, name: "Joe" },
    { phone: KIAN, name: "Kian" },
    { phone: PRIYA, name: "Priya" },
    { phone: JAKE, name: "Jake" },
  ]);
  log.length = 0;
  ctx = {
    store: db,
    db: db.reducers(),
    now: () => now,
    classify: stubClassifier,
    extract: {
      expense: (input, mode) =>
        extractExpense(
          fakeGrok(`${mode}|${input.message.text}`),
          "m",
          input,
          mode,
        ),
      receipt: () => Promise.reject(new Error("no receipts in these tests")),
      claim: () => Promise.reject(new Error("no claims in these tests")),
      correction: () => Promise.reject(new Error("no corrections in these tests")),
      answer: () => Promise.reject(new Error("no free-form answers in these tests")),
    },
    timing: timing({ DEMO_MODE: "true" }),
    memory: new Memory(),
    log: (event, fields) => log.push(`${event} ${JSON.stringify(fields)}`),
  };
});

const advance = (ms: number) => (now = new Date(now.getTime() + ms));
async function send(
  sender_phone: string,
  text: string,
  extra: Partial<Message> = {},
) {
  advance(1000);
  const m = db.ingest({ sender_phone, group_id: G, text, ...extra });
  await processMessage(ctx, m);
  return db.msgs.get(m.message_id)!;
}
async function react(
  sender_phone: string,
  purposeId: string,
  reaction: Message["reaction"] = "like",
) {
  db.deliver();
  const target = db.out.get(purposeId)!;
  return send(sender_phone, "", {
    kind: "reaction",
    reaction,
    reply_to_id: target.sent_photon_id,
  });
}
const said = (purpose: string) =>
  db
    .outbox()
    .filter((o) => o.purpose === purpose && o.status !== "cancelled")
    .map((o) => o.text);
const expenseId = (m: Message) => `exp_${m.message_id}`;

describe("text expense (SPEC 7.3)", () => {
  it("logs it with a 👍 and posts SPEC's proposal copy", async () => {
    const m = await send(JOE, "got groceries, $63");
    expect(m).toMatchObject({ status: "done", intent: "expense" });
    const e = db.expense(expenseId(m))!;
    expect(e).toMatchObject({
      status: "proposed",
      total_cents: 6300,
      payer_phone: JOE,
      description: "Groceries",
    });
    expect(db.shares(e.expense_id).map((s) => s.amount_cents)).toEqual([
      1575, 1575, 1575, 1575,
    ]);
    expect(db.out.get(`tapback:${m.message_id}:like`)).toMatchObject({
      kind: "reaction",
      target_message_id: m.message_id,
    });
    const [first, ask] = said("split_proposal")[0]!.split("\n");
    expect(first).toBe("groceries $63.00 split 4 ways, so $15.75 each");
    expect([
      "lmk if it wasn't even or someone skipped",
      "shout if it wasn't even or someone wasn't there",
      "not even, or someone sat it out? just say",
    ]).toContain(ask);
  });

  it("does nothing twice when the same message is processed again", async () => {
    const m = await send(JOE, "got groceries, $63");
    await processMessage(ctx, m);
    expect(db.expenses()).toHaveLength(1);
    expect(said("split_proposal")).toHaveLength(1);
  });
});

describe("reminder and lock-in in DEMO_MODE (M2)", () => {
  it("reminds once before the deadline, then locks in and asks to settle", async () => {
    await ctx.db.set_settle_mode({ group_id: G, settle_mode: "per_expense" });
    const m = await send(JOE, "got groceries, $63");
    advance(15_000);
    await tick(ctx);
    expect(said("objection_reminder")).toEqual([]);

    advance(6_000); // 10s left of the 30s demo window
    await tick(ctx);
    await tick(ctx);
    expect(said("objection_reminder")).toHaveLength(1);
    expect(said("objection_reminder")[0]).toBe("anything else?");

    advance(10_000);
    await tick(ctx);
    const e = db.expense(expenseId(m))!;
    expect(e.status).toBe("finalized");
    expect(db.shares(e.expense_id).every((s) => s.status === "locked")).toBe(
      true,
    );
    expect(said("settle_request")[0]).toContain(
      "cool, here's what's owed to Joe for groceries:\nKian $15.75, Priya $15.75, Jake $15.75\n",
    );
  });

  it("locks in as soon as every participant 👍s the proposal", async () => {
    const m = await send(JOE, "got groceries, $63");
    const proposal = `split_proposal:${expenseId(m)}`;
    await react(KIAN, proposal);
    await react(PRIYA, proposal);
    expect(db.expense(expenseId(m))!.status).toBe("proposed");
    await react(JAKE, proposal);
    expect(db.expense(expenseId(m))!.status).toBe("finalized");
  });
});

describe("settling, per-expense mode (SPEC 7.6)", () => {
  async function finalized() {
    await ctx.db.set_settle_mode({ group_id: G, settle_mode: "per_expense" });
    const m = await send(JOE, "got groceries, $63");
    advance(31_000);
    await tick(ctx);
    return expenseId(m);
  }

  it("a 👍 on the settle request pays only the reactor's share, then one DM confirms it", async () => {
    const id = await finalized();
    await react(KIAN, `settle_request:${id}`);
    expect(db.transfers()).toHaveLength(1);
    expect(db.transfers()[0]).toMatchObject({ from_phone: KIAN, to_phone: JOE, amount_cents: 1575, status: "pending" });
    expect(db.shares(id).find((s) => s.phone === PRIYA)!.status).toBe("locked");
    db.completeTransfers();
    await tick(ctx);
    expect(db.outbox().find((o) => o.purpose === "payment_receipt")).toMatchObject({
      kind: "dm",
      to_phone: KIAN,
      text: "done, you paid Joe $15.75 for groceries (simulated, no real money moved)\nyou're all square",
    });
  });

  it("ignores the payer's own 👍", async () => {
    const id = await finalized();
    await react(JOE, `settle_request:${id}`);
    expect(db.transfers()).toHaveLength(0);
  });

  it("never pays on a typed yes, and points to the 👍 once (P7)", async () => {
    await finalized();
    await send(KIAN, "yes");
    await send(KIAN, "yes");
    expect(db.transfers()).toHaveLength(0);
    expect(said("clarifying_question")).toEqual(["just tap 👍 on the settle msg to pay your part"]);
  });
});

describe("settling, ledger mode (SPEC 7.6, default)", () => {
  it("asks nobody to pay until someone says let's settle up, then one 👍 pays everything they owe", async () => {
    const groceries = await send(JOE, "got groceries, $63");
    const pizza = await send(PRIYA, "got pizza, $40");
    advance(31_000);
    await tick(ctx);
    expect(db.expense(expenseId(groceries))!.status).toBe("finalized");
    expect(said("settle_request")).toEqual([]);

    const settle = await send(KIAN, "let's settle up");
    // Tab texts in lowercase by default; the tap line varies.
    const [head, joe, priya] = said("settle_request")[0]!.split("\n");
    expect([head, joe, priya]).toEqual([
      "cool, here's what's owed:",
      "owed to Joe: Kian $15.75, Priya $15.75, Jake $15.75",
      "owed to Priya: Joe $10.00, Kian $10.00, Jake $10.00",
    ]);
    const request = `settle_request:${G}:${settle.message_id}`;
    expect(db.expense(expenseId(pizza))!.settle_message_id).toBe(request);

    await react(KIAN, request);
    expect(db.transfers().map((t) => [t.to_phone, t.amount_cents])).toEqual([[JOE, 1575], [PRIYA, 1000]]);
    for (const who of [PRIYA, JAKE, JOE]) await react(who, request);
    db.completeTransfers();
    await tick(ctx);
    expect(said("payment_receipt")).toContain("done, you paid Joe $15.75 and Priya $10.00 (simulated, no real money moved)\nyou're all square");
    expect(said("all_square")).toHaveLength(1);
    expect(["and that's everyone square", "everyone's square, nice"]).toContain(said("all_square")[0]);
  });

  it("locks in a split still open for changes when someone asks to settle now", async () => {
    const groceries = await send(JOE, "got groceries, $63");
    expect(db.expense(expenseId(groceries))!.status).toBe("proposed");
    const settle = await send(KIAN, "let's settle up");
    expect(db.expense(expenseId(groceries))!.status).toBe("finalized");
    expect(said("balance_reply")).toEqual([]);
    expect(said("settle_request")).toHaveLength(1);
    expect(db.expense(expenseId(groceries))!.settle_message_id).toBe(`settle_request:${G}:${settle.message_id}`);
  });

  it("posts one request, not two, in per-expense mode", async () => {
    await ctx.db.set_settle_mode({ group_id: G, settle_mode: "per_expense" });
    await send(JOE, "got groceries, $63");
    await send(KIAN, "let's settle up");
    expect(said("settle_request")).toHaveLength(1);
  });

  it("says there's nothing to settle when nobody owes anything", async () => {
    await send(KIAN, "let's settle up");
    expect(said("balance_reply")).toEqual(["nothing to settle, everyone's even"]);
  });
});

describe("adjustments (SPEC 7.5)", () => {
  it("pins what someone had and splits the rest evenly", async () => {
    const m = await send(JOE, "got groceries, $63");
    await send(KIAN, "not even, jake only had a $3 diet coke");
    const shares = Object.fromEntries(
      db.shares(expenseId(m)).map((s) => [s.phone, s.amount_cents]),
    );
    expect(shares).toEqual({
      [JOE]: 2000,
      [KIAN]: 2000,
      [PRIYA]: 2000,
      [JAKE]: 300,
    });
    expect(db.expense(expenseId(m))!.split_mode).toBe("custom");
    expect(said("split_proposal")[1]).toMatch(
      /^(ok redid it|fixed it): groceries \$63\.00: Joe \$20\.00, Kian \$20\.00, Priya \$20\.00, Jake \$3\.00$/,
    );
  });

  it('keeps "jake had a $3 diet coke" (no "only") a pin on a text expense: there are no items to own', async () => {
    GROK["adjustment|not even, jake had a $3 diet coke"] = {
      ...base,
      payer: "unknown",
      fixed: [{ name: "jake", amount_cents: 300, item: "diet coke", only: false }],
    };
    const m = await send(JOE, "got groceries, $63");
    await send(KIAN, "not even, jake had a $3 diet coke");
    expect(db.expense(expenseId(m))!.split_mode).toBe("custom");
    expect(db.shares(expenseId(m)).find((s) => s.phone === JAKE)!.amount_cents).toBe(300);
  });
});

describe("Tab's questions (SPEC 7.3 step 2)", () => {
  it("asks for a missing amount, then uses the answer", async () => {
    await send(KIAN, "venmo me for the uber");
    expect(said("clarifying_question")).toEqual(["how much was the uber?"]);
    // A $0 needs_info row holds the place while Tab asks (Kian's #16).
    expect(db.expenses()[0]).toMatchObject({ status: "needs_info", total_cents: 0 });
    await send(KIAN, "22");
    expect(db.expenses()[0]).toMatchObject({
      total_cents: 2200,
      payer_phone: KIAN,
      status: "proposed",
    });
  });

  it("asks who paid, and takes the answer from the person it asked", async () => {
    await send(PRIYA, "pizza was $48 lol");
    expect(said("clarifying_question")).toEqual(["want me to split that?"]); // the stub is unsure (0.6)
    await send(PRIYA, "yes");
    expect(said("clarifying_question")[1]).toBe("who paid for the pizza?");
    expect(db.expenses()[0]).toMatchObject({
      status: "needs_info",
      total_cents: 4800,
    });
    await send(KIAN, "lol who cares"); // a bystander: never sent to Grok
    expect(db.expenses()[0]).toMatchObject({ status: "needs_info" });
    await send(PRIYA, "joe did");
    expect(db.expenses()[0]).toMatchObject({
      status: "proposed",
      payer_phone: JOE,
    });
  });
});

describe("onboarding (SPEC 7.2)", () => {
  it("asks once about settling after names are in, and \"each\" switches to per-expense (SPEC #15)", async () => {
    db.addGroup("trip", [{ phone: JOE }, { phone: KIAN }], "pending");
    await tick(ctx);
    advance(1000);
    await processMessage(ctx, db.ingest({ sender_phone: JOE, group_id: "trip", text: "joe" }));
    advance(1000);
    await processMessage(ctx, db.ingest({ sender_phone: KIAN, group_id: "trip", text: "kian" }));
    expect(db.outbox().filter((o) => o.action_id === "settle_mode:trip").map((o) => o.text)).toHaveLength(1);
    expect(db.settings.has("trip")).toBe(false);
    expect(db.settleMode("trip")).toBe("ledger"); // ledger by default
    advance(1000);
    await processMessage(ctx, db.ingest({ sender_phone: KIAN, group_id: "trip", text: "each" }));
    expect(db.settleMode("trip")).toBe("per_expense");
  });

  it("introduces Tab once and names people as they answer", async () => {
    db.addGroup("new", [{ phone: JOE }, { phone: KIAN }], "pending");
    await tick(ctx);
    await tick(ctx);
    expect(
      db
        .outbox()
        .filter(
          (o) => o.group_id === "new" && o.purpose === "onboarding_intro",
        ),
    ).toHaveLength(2); // intro + contact card
    expect(db.outbox().filter((o) => o.purpose === "name_prompt")).toHaveLength(
      1,
    );
    advance(1000);
    await processMessage(
      ctx,
      db.ingest({ sender_phone: JOE, group_id: "new", text: "joe" }),
    );
    expect(db.members("new").find((m) => m.phone === JOE)!.name).toBe("Joe");
  });
});
