import { describe, expect, it } from "vitest";
import type { OutboxPurpose } from "../src/db/types.js";
import { money } from "../src/copy/format.js";
import { applyStyle, deco, DEFAULT_STYLE, detectStyle } from "../src/copy/style.js";
import { compose, fitsGroupLimit } from "../src/copy/compose.js";
import { rejectWit, witAllowed, type WitContext } from "../src/copy/wit.js";
import { BANNED_PHRASES, bannedPhraseIn, MARKDOWN } from "../src/copy/voice.js";
import * as T from "../src/copy/templates.js";
import type { Problem } from "../src/extraction/types.js";

const joe = { phone: "+15555550101", name: "Joe" };
const jake = { phone: "+15555550105", name: "Jake" };
const priya = { phone: "+15555550104", name: "Priya" };
const unnamed = { phone: "+15555550199" };
const items = [
  { position: 1, description: "Cuban burger", amount_cents: 1500 },
  { position: 2, description: "Fries", amount_cents: 800 },
];

// One question per extraction problem, with the amounts each may show.
const QUESTIONS: [Problem, number[]][] = [
  [{ kind: "missing_amount" }, []],
  [{ kind: "ungrounded_amount", amount_cents: 999 }, []],
  [{ kind: "missing_payer" }, []],
  [{ kind: "missing_item_price", phone: "+15555550101", item: "Diet Coke" }, []],
  [{ kind: "unknown_name", name: "Mike" }, []],
  [{ kind: "large_amount", amount_cents: 124000 }, [124000]],
  [{ kind: "invalid_amount", amount_cents: -500 }, []],
];

// Every template, rendered with many seeds so every variant is covered.
// The amounts listed are the only ones the message may contain (P6).
function renders(seed: string): {
  purpose: OutboxPurpose;
  group: boolean;
  text: string;
  amounts: number[];
}[] {
  const even = [
    { person: joe, amount_cents: 1575 },
    { person: jake, amount_cents: 1575 },
  ];
  const uneven = [
    { person: joe, amount_cents: 3334 },
    { person: jake, amount_cents: 3333 },
    { person: unnamed, amount_cents: 3333 },
  ];
  return [
    {
      purpose: "onboarding_intro",
      group: true,
      text: T.onboardingIntro(seed),
      amounts: [4000],
    },
    {
      purpose: "name_prompt",
      group: true,
      text: T.namePrompt(seed),
      amounts: [],
    },
    {
      purpose: "split_proposal",
      group: true,
      text: T.splitProposal({
        seed,
        description: "Groceries",
        total_cents: 3150,
        shares: even,
      }),
      amounts: [3150, 1575],
    },
    {
      purpose: "split_proposal",
      group: true,
      text: T.splitProposal({
        seed,
        description: "Dinner",
        total_cents: 10000,
        shares: uneven,
        updated: true,
      }),
      amounts: [10000, 3334, 3333],
    },
    {
      purpose: "objection_reminder",
      group: true,
      text: T.objectionReminder(),
      amounts: [],
    },
    {
      purpose: "item_list",
      group: true,
      text: T.itemList({ merchant: "Frita Batidos", total_cents: 2300, items }),
      amounts: [2300, 1500, 800],
    },
    {
      purpose: "claim_followup",
      group: true,
      text: T.claimNudge({
        seed,
        person: jake,
        merchant: "Frita Batidos",
        step: 1,
      }),
      amounts: [],
    },
    {
      purpose: "claim_followup",
      group: true,
      text: T.claimNudge({
        seed,
        person: jake,
        merchant: "Frita Batidos",
        step: 2,
      }),
      amounts: [],
    },
    {
      purpose: "claim_followup",
      group: true,
      text: T.claimLastCall({
        person: jake,
        merchant: "Frita Batidos",
        amount_cents: 2475,
        when: "in 4 hours",
      }),
      amounts: [2475],
    },
    {
      purpose: "settle_request",
      group: true,
      text: T.settleRequest({
        seed,
        description: "Frita Batidos",
        owed: [{ payee: joe, shares: [{ person: jake, amount_cents: 3825 }, { person: priya, amount_cents: 2550 }] }],
      }),
      amounts: [3825, 2550],
    },
    {
      purpose: "settle_request",
      group: true,
      text: T.settleRequest({
        seed,
        owed: [
          { payee: joe, shares: [{ person: jake, amount_cents: 3825 }] },
          { payee: priya, shares: [{ person: jake, amount_cents: 1200 }] },
        ],
      }),
      amounts: [3825, 1200],
    },
    {
      purpose: "approval_followup",
      group: true,
      text: T.approvalFollowup({
        seed,
        person: jake,
        owed: [{ payee: joe, amount_cents: 3825 }, { payee: priya, amount_cents: 1200 }],
        step: 1,
      }),
      amounts: [3825, 1200],
    },
    {
      purpose: "payment_receipt",
      group: false,
      text: T.paymentConfirmation({ paid: [{ payee: joe, amount_cents: 3825 }, { payee: priya, amount_cents: 1200 }], label: "Vegas Trip", allSquare: true }),
      amounts: [3825, 1200],
    },
    {
      purpose: "all_square",
      group: true,
      text: T.allSquare({ seed, description: "Frita Batidos" }),
      amounts: [],
    },
    {
      purpose: "dispute_followup",
      group: true,
      text: T.disputeFollowup({
        seed,
        description: "Frita Batidos",
        amount_cents: 3825,
      }),
      amounts: [3825],
    },
    {
      purpose: "balance_reply",
      group: true,
      text: T.balanceReply({
        debts: [{ from: jake, to: joe, amount_cents: 3825 }],
      }),
      amounts: [3825],
    },
    {
      purpose: "breakdown_reply",
      group: true,
      text: T.breakdownCommandReply({
        subject: "Jake",
        pairs: [
          {
            debtor: "Jake",
            creditor: "Joe",
            net_cents: 2825,
            events: [
              { signed_cents: 3825, description: "Frita Batidos", payer: "Joe", debtor: "Jake", total_cents: 10200, when: "Oct 3, 7:42 PM", source: "receipt photo", why: "ribeye + tax + tip" },
              { signed_cents: -1000, description: "Pizza", payer: "Jake", debtor: "Joe", total_cents: 4000, when: "Oct 3, 9:10 PM", source: '"got pizza, $40"', why: "split 4 ways" },
            ],
          },
        ],
        max_pairs: 4,
        max_lines: 12,
      }).text,
      amounts: [2825, 3825, 10200, 1000, 4000],
    },
    {
      purpose: "other",
      group: true,
      text: T.breakdownHint(),
      amounts: [],
    },
    {
      purpose: "balance_reply",
      group: true,
      text: T.personalBalanceReply({
        owes: [{ from: priya, to: joe, amount_cents: 3825 }],
        owed: [],
      }),
      amounts: [3825],
    },
    {
      purpose: "help_reply",
      group: true,
      text: T.helpReply(seed),
      amounts: [6300],
    },
    { purpose: "all_square", group: true, text: T.allSquare({ seed }), amounts: [] },
    { purpose: "settle_request", group: true, text: T.settleRequest({ seed, owed: [{ payee: joe, shares: [{ person: jake, amount_cents: 3825 }] }] }), amounts: [3825] },
    { purpose: "approval_followup", group: true, text: T.approvalFollowup({ seed, person: jake, owed: [{ payee: joe, amount_cents: 3825 }], step: 2 }), amounts: [3825] },
    { purpose: "approval_followup", group: true, text: T.approvalFollowup({ seed, person: jake, owed: [{ payee: joe, amount_cents: 3825 }], step: 3 }), amounts: [3825] },
    { purpose: "dispute_followup", group: true, text: T.disputeFollowup({ seed, amount_cents: 3825 }), amounts: [3825] },
    { purpose: "dispute_followup", group: false, text: T.disputeResolved({ description: "Pizza", amount_cents: 400, requested: true }), amounts: [400] },
    { purpose: "clarifying_question", group: true, text: T.disputeTooMuch({ description: "Pizza", max_cents: 2000 }), amounts: [2000] },
    { purpose: "clarifying_question", group: true, text: T.whichDispute([{ description: "Pizza", amount_cents: 1000 }, { description: "Groceries", amount_cents: 1500 }]), amounts: [1000, 1500] },
    { purpose: "clarifying_question", group: true, text: T.whichList(["Pizza", "Groceries"]), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.whichItems(seed), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.whatsOff(seed), amounts: [] },
    { purpose: "clarifying_question", group: false, text: T.postInGroup(seed), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.tapToPay(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.settleModeQuestion(), amounts: [] },
    { purpose: "other", group: true, text: T.settleModeSet("ledger"), amounts: [] },
    { purpose: "other", group: true, text: T.settleModeSet("per_expense"), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.cantChangePaid("Pizza"), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.receiptTotalFixed("Frita Batidos"), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.receiptTotalCheck(10200), amounts: [10200] },
    { purpose: "clarifying_question", group: true, text: T.whatWasTotal(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.clearerPhoto(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.whatTip(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmExpense(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.whatsUneven(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.pinnedOverTotal({ total_cents: 4800, name: "Jake" }), amounts: [4800] },
    { purpose: "clarifying_question", group: true, text: T.reopenToChange("Pizza"), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmSplitChange({ description: "Pizza" }), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmSplitChange({ description: "Pizza", only: ["you", "Priya"] }), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmSplitChange({ description: "Pizza", without: ["Jake"] }), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.notLockedYet([{ description: "Frita Batidos", total_cents: 10200 }]), amounts: [10200] },
    { purpose: "clarifying_question", group: true, text: T.answerFollowup(T.whatTip(), false), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.answerFollowup("how much were Alex's drinks?", true), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmCorrection(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmDispute(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.confirmSettleUp(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.whichToCorrect(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.correctionUnclear("Pizza"), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.totalUnderPinned(500), amounts: [500] },
    { purpose: "clarifying_question", group: true, text: T.duplicateReceiptQuestion(), amounts: [] },
    { purpose: "clarifying_question", group: true, text: T.foreignCurrencyQuestion(), amounts: [] },
    ...QUESTIONS.map(([problem, amounts]) => ({
      purpose: "clarifying_question" as const,
      group: true,
      text: T.clarifyingQuestion(problem, { description: "Uber", people: [joe] }),
      amounts,
    })),
    ...QUESTIONS.flatMap(([problem]) => {
      const text = T.rephraseQuestion(problem, { description: "Uber", people: [joe], example_cents: 1600 });
      return text ? [{ purpose: "clarifying_question" as const, group: true, text, amounts: [1600] }] : [];
    }),
    { purpose: "other", group: false, text: T.payeeTapped([jake, priya]), amounts: [] },
    { purpose: "other", group: false, text: T.payeeTapped([]), amounts: [] },
    { purpose: "balance_reply", group: true, text: T.nothingToSettle(), amounts: [] },
    { purpose: "balance_reply", group: true, text: T.notLockedYet([{ description: "Pizza", total_cents: 4800 }]), amounts: [4800] },
    { purpose: "balance_reply", group: true, text: T.balanceReply({ debts: [] }), amounts: [] },
    {
      purpose: "balance_reply",
      group: true,
      text: T.balanceReply({
        debts: [
          { from: jake, to: joe, amount_cents: 3825 },
          { from: priya, to: joe, amount_cents: 1200 },
          { from: unnamed, to: joe, amount_cents: 500 },
        ],
      }),
      amounts: [3825, 1200, 500],
    },
    { purpose: "balance_reply", group: true, text: T.personalBalanceReply({ owes: [], owed: [] }), amounts: [] },
    { purpose: "balance_reply", group: true, text: T.personalBalanceReply({ owes: [], owed: [{ from: jake, to: priya, amount_cents: 500 }] }), amounts: [500] },
    { purpose: "breakdown_reply", group: true, text: T.breakdownCommandReply({ subject: "Jake", pairs: [], max_pairs: 4, max_lines: 12 }).text, amounts: [] },
    { purpose: "other", group: false, text: T.ledgerLink([{ url: "https://tab.tech/g/AbC123" }]), amounts: [] },
    { purpose: "other", group: false, text: T.noLedger(), amounts: [] },
  ];
}

const SEEDS = ["e1", "e2", "e3", "expense-frita", "abc", "zz", "q9", "m-42"];
const all = SEEDS.flatMap(renders);

describe("templates", () => {
  it("keep group messages within SPEC's line limits", () => {
    for (const r of all.filter((x) => x.group))
      expect(fitsGroupLimit(r.purpose, r.text), r.text).toBe(true);
  });

  it("never use markdown, which iMessage shows as raw symbols", () => {
    for (const r of all) expect(MARKDOWN.test(r.text), r.text).toBe(false);
  });

  it("never use chatbot or guilt-trip phrases", () => {
    for (const r of all) expect(bannedPhraseIn(r.text), r.text).toBeUndefined();
  });

  it("only contain dollar amounts that were passed in (P6)", () => {
    for (const r of all) {
      const shown = r.text.match(/\$[\d,]+\.\d{2}/g) ?? [];
      const allowed = new Set([...r.amounts.map(money), "$0.00"]);
      for (const s of shown)
        expect(allowed.has(s), `${s} in: ${r.text}`).toBe(true);
    }
  });

  it("pick the same variant for the same seed", () => {
    expect(T.namePrompt("e1")).toBe(T.namePrompt("e1"));
    expect(
      new Set(SEEDS.map((s) => T.allSquare({ seed: s, description: "Pizza" })))
        .size,
    ).toBeGreaterThan(1);
  });

  it("matches SPEC's example copy for an even split", () => {
    const shares = [joe, jake, priya, unnamed].map((person) => ({
      person,
      amount_cents: 1575,
    }));
    const text = T.splitProposal({
      seed: "x",
      description: "Groceries",
      total_cents: 6300,
      shares,
    });
    expect(text.split("\n")[0]).toBe(
      "Groceries $63.00 split 4 ways, so $15.75 each",
    );
  });

  it("lists people by name, or by last four digits until they're named", () => {
    const text = T.settleRequest({ seed: "x", description: "Pizza", owed: [{ payee: joe, shares: [{ person: unnamed, amount_cents: 960 }] }] });
    expect(text).toContain("…0199 $9.60");
  });

  it("says the settlement receipt is simulated, as SPEC 7.6 requires", () => {
    expect(T.paymentConfirmation({ paid: [{ payee: joe, amount_cents: 3825 }, { payee: priya, amount_cents: 1200 }], label: "Vegas Trip", allSquare: true })).toBe(
      "done, you paid Joe $38.25 and Priya $12.00 for Vegas Trip through capital one nessie (sandbox, no real money moved)\nyou're all square",
    );
  });

  it("asks exactly one question per extraction problem", () => {
    const people = [joe, { phone: "+15555550106", name: "John" }];
    expect(
      T.clarifyingQuestion(
        { kind: "missing_amount" },
        { description: "Uber", people },
      ),
    ).toBe("how much was the Uber?");
    expect(
      T.clarifyingQuestion(
        {
          kind: "missing_item_price",
          phone: "+15555550106",
          item: "Diet Coke",
        },
        { people },
      ),
    ).toBe("how much was John's Diet Coke?");
    // Quantifiers drop and a plural takes "were" (Harjyot's playground on #35).
    const item = (i: string) => T.clarifyingQuestion({ kind: "missing_item_price", phone: "+15555550106", item: i }, { people });
    expect(item("both drinks")).toBe("how much were John's drinks?");
    expect(item("2 soft drinks")).toBe("how much were John's 2 soft drinks?");
    expect(item("fries")).toBe("how much were John's fries?");
    expect(item("a glass of wine")).toBe("how much was John's glass of wine?");
    expect(
      T.clarifyingQuestion(
        { kind: "large_amount", amount_cents: 120000 },
        { description: "Rent", people },
      ),
    ).toBe("$1,200.00 for Rent? just making sure");
    for (const [problem] of QUESTIONS) {
      const q = T.clarifyingQuestion(problem, { description: "Uber", people });
      expect(q.match(/\?/g) ?? [], q).toHaveLength(1);
    }
  });

  it("never sounds like an assistant (the old bot copy is banned)", () => {
    for (const phrase of [
      "Here's where things stand:",
      "Updated: Pizza, $48.00.",
      "I keep track of shared costs in this chat.",
      "Tell me if it wasn't even or someone wasn't there.",
      "That's $1,200.00 for the Rent. Is that right?",
      "Post that in the group chat and I'll split it.",
      "Amounts need to be more than $0.00.",
      "Simulated settlement complete: you paid Joe $38.25.",
      "Nothing to settle. Everyone's square.",
      "Quick one: reply with your first name so I know who's who.",
    ])
      expect(bannedPhraseIn(phrase), phrase).toBeDefined();
    for (const p of BANNED_PHRASES) expect(p).toBe(p.toLowerCase());
    for (const r of all) expect(r.text, r.text).not.toMatch(/!/);
  });

  it("goes out lowercase with no trailing periods by default, URLs and amounts intact", () => {
    for (const r of all) {
      const out = compose({ purpose: r.purpose, text: r.text, in_group: r.group, style: DEFAULT_STYLE });
      const words = out.replace(/https?:\/\/\S+/g, "");
      expect(words, out).toBe(words.toLowerCase());
      expect(out, out).not.toMatch(/(?<!\.)\.(\n|$)/);
      for (const a of r.text.match(/\$[\d,]+\.\d{2}/g) ?? []) expect(out).toContain(a);
    }
    expect(
      compose({ purpose: "other", text: T.ledgerLink([{ url: "https://tab.tech/g/AbC123" }]), in_group: false, style: DEFAULT_STYLE }),
    ).toBe("here's the ledger: https://tab.tech/g/AbC123");
  });
});

describe("money", () => {
  it.each([
    [3825, "$38.25"],
    [5, "$0.05"],
    [100000000, "$1,000,000.00"],
    [0, "$0.00"],
  ])("formats %i cents as %s", (c, s) => {
    expect(money(c)).toBe(s);
  });
});

describe("group style", () => {
  it("is lowercase with no trailing periods however the group types", () => {
    for (const texts of [
      ["got groceries", "lol ok", "who's home", "Nice"],
      ["Got groceries.", "Who's home?", "Ok."],
      [],
    ]) {
      expect(detectStyle(texts).lowercase).toBe(true);
      expect(detectStyle(texts).periods).toBe(false);
    }
  });

  it("uses emoji only once the group has", () => {
    expect(detectStyle(["got groceries", "ok"]).emoji).toBe(false);
    expect(detectStyle(["got groceries 🛒", "ok"]).emoji).toBe(true);
  });

  it("shows Tab's decorative emoji only once the group has, and never touches people's own", () => {
    expect(applyStyle(`hey i'm tab ${deco("👋")}\nand that's everyone square ${deco("🎉")}`, DEFAULT_STYLE)).toBe(
      "hey i'm tab\nand that's everyone square",
    );
    expect(applyStyle("tap 👍 to pay", DEFAULT_STYLE)).toBe("tap 👍 to pay");
    expect(applyStyle(`everyone's square on 🍕 night ${deco("🎉")}`, DEFAULT_STYLE)).toBe("everyone's square on 🍕 night");
    const emoji = { ...DEFAULT_STYLE, emoji: true };
    expect(applyStyle(`everyone's square ${deco("🎉")}`, emoji)).toBe("everyone's square 🎉");
  });

  it("keeps member names the way they were saved, but not inside URLs or other words", () => {
    expect(applyStyle("DJ and McKenzie owe Joe $5.00. Joey too", DEFAULT_STYLE, ["DJ", "McKenzie", "Joe"])).toBe(
      "DJ and McKenzie owe Joe $5.00. joey too",
    );
    expect(applyStyle("Ledger: https://tab.tech/g/joeXYZ", DEFAULT_STYLE, ["Joe"])).toBe("ledger: https://tab.tech/g/joeXYZ");
  });

  it("drops trailing periods, but never inside amounts", () => {
    const casual = DEFAULT_STYLE;
    expect(applyStyle("You owe Joe $63.75.", casual)).toBe(
      "you owe joe $63.75",
    );
    expect(
      applyStyle("Kian $15.00, Priya $3.00.\nTap 👍 to pay.", casual),
    ).toBe("kian $15.00, priya $3.00\ntap 👍 to pay");
  });

  it("keeps ledger URLs intact when lowercasing", () => {
    const out = applyStyle("Full list: https://tab.tech/g/AbC123", {
      lowercase: true,
      emoji: false,
      periods: true,
    });
    expect(out).toBe("full list: https://tab.tech/g/AbC123");
  });
});

describe("compose", () => {
  const style = { lowercase: false, emoji: false, periods: true };

  it("adds a wit line when it fits", () => {
    const text = compose({
      purpose: "all_square",
      text: "Everyone's square on Pizza.",
      in_group: true,
      style,
      wit: "Friendship survives another day.",
    });
    expect(text).toBe(
      "Everyone's square on Pizza.\nFriendship survives another day.",
    );
  });

  it("drops the wit line rather than exceed the group line limit", () => {
    const three = "a\nb\nc";
    expect(
      compose({
        purpose: "all_square",
        text: three,
        in_group: true,
        style,
        wit: "extra",
      }),
    ).toBe(three);
  });
});

describe("wit line", () => {
  const ctx: WitContext = {
    purpose: "all_square",
    moment: "everyone finished paying for Frita Batidos",
    allowed_names: ["Joe"],
    all_member_names: ["Joe", "Jake", "Priya"],
    style: { lowercase: false, emoji: false, periods: true },
    previous_had_wit: false,
  };

  it("is only allowed on light moments and never twice in a row", () => {
    expect(witAllowed(ctx)).toBe(true);
    expect(witAllowed({ ...ctx, purpose: "settle_request" })).toBe(false);
    expect(witAllowed({ ...ctx, previous_had_wit: true })).toBe(false);
  });

  it.each([
    ["Friendship survives another day.", null],
    ["Joe, you legend.", null],
    ["That was $38 well spent.", "number"],
    ["Forty bucks well spent.", "number"],
    ["Jake finally paid.", "name"],
    ["Let me know if you need anything else.", "banned_phrase"],
    ["Nice 🎉", "emoji"],
    ["Who's buying next?", "question"],
    ["**Done.**", "markdown"],
    ["one line\ntwo lines", "multiline"],
  ])("judges %j as %s", (line, why) => {
    expect(rejectWit(line, ctx)).toBe(why);
  });
});
