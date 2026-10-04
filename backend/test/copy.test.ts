import { describe, expect, it } from "vitest";
import type { OutboxPurpose } from "../src/db/types.js";
import { money } from "../src/copy/format.js";
import { applyStyle, detectStyle } from "../src/copy/style.js";
import { compose, fitsGroupLimit } from "../src/copy/compose.js";
import { rejectWit, witAllowed, type WitContext } from "../src/copy/wit.js";
import { bannedPhraseIn, MARKDOWN } from "../src/copy/voice.js";
import * as T from "../src/copy/templates.js";

const joe = { phone: "+15555550101", name: "Joe" };
const jake = { phone: "+15555550105", name: "Jake" };
const priya = { phone: "+15555550104", name: "Priya" };
const unnamed = { phone: "+15555550199" };
const items = [
  { position: 1, description: "Cuban burger", amount_cents: 1500 },
  { position: 2, description: "Fries", amount_cents: 800 },
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
      text: T.breakdownReply({
        lines: [
          {
            description: "Frita Batidos",
            amount_cents: 3825,
            why: "the ribeye, part of the fries, plus tax and tip",
          },
        ],
      }),
      amounts: [3825],
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
      "Groceries, $63.00. Split 4 ways, that's $15.75 each.",
    );
  });

  it("lists people by name, or by last four digits until they're named", () => {
    const text = T.settleRequest({ seed: "x", description: "Pizza", owed: [{ payee: joe, shares: [{ person: unnamed, amount_cents: 960 }] }] });
    expect(text).toContain("…0199 $9.60");
  });

  it("says the settlement receipt is simulated, as SPEC 7.6 requires", () => {
    expect(T.paymentConfirmation({ paid: [{ payee: joe, amount_cents: 3825 }, { payee: priya, amount_cents: 1200 }], label: "Vegas Trip", allSquare: true })).toBe(
      "Simulated settlement complete: you paid Joe $38.25 and Priya $12.00 for Vegas Trip. All square.",
    );
  });

  it("asks exactly one question per extraction problem", () => {
    const people = [joe, { phone: "+15555550106", name: "John" }];
    expect(
      T.clarifyingQuestion(
        { kind: "missing_amount" },
        { description: "Uber", people },
      ),
    ).toBe("How much was the Uber?");
    expect(
      T.clarifyingQuestion(
        {
          kind: "missing_item_price",
          phone: "+15555550106",
          item: "Diet Coke",
        },
        { people },
      ),
    ).toBe("How much was John's Diet Coke?");
    // Quantifiers drop and a plural takes "were" (Harjyot's playground on #35).
    const item = (i: string) => T.clarifyingQuestion({ kind: "missing_item_price", phone: "+15555550106", item: i }, { people });
    expect(item("both drinks")).toBe("How much were John's drinks?");
    expect(item("2 soft drinks")).toBe("How much were John's 2 soft drinks?");
    expect(item("fries")).toBe("How much were John's fries?");
    expect(item("a glass of wine")).toBe("How much was John's glass of wine?");
    expect(
      T.clarifyingQuestion(
        { kind: "large_amount", amount_cents: 120000 },
        { description: "Rent", people },
      ),
    ).toBe("That's $1,200.00 for the Rent. Is that right?");
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
  it("goes lowercase when the group texts in lowercase", () => {
    expect(
      detectStyle(["got groceries", "lol ok", "who's home", "Nice"]).lowercase,
    ).toBe(true);
    expect(detectStyle(["Got groceries", "Who's home?", "ok"]).lowercase).toBe(
      false,
    );
  });

  it("uses emoji only once the group has", () => {
    expect(detectStyle(["got groceries", "ok"]).emoji).toBe(false);
    expect(detectStyle(["got groceries 🛒", "ok"]).emoji).toBe(true);
  });

  it("drops trailing periods when the group doesn't use them, but never inside amounts", () => {
    expect(
      detectStyle(["what do i owe", "got pizza, $48", "ok cool"]).periods,
    ).toBe(false);
    expect(detectStyle(["What do I owe.", "Got pizza.", "Ok."]).periods).toBe(
      true,
    );
    const casual = { lowercase: true, emoji: false, periods: false };
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
