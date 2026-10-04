import { describe, expect, it } from "vitest";
import type { ClassifyInput } from "@tab/gate";
import { decide } from "../src/gate/decide.js";
import { MEMBERS, PHONES } from "../scripts/extraction-cases.js";

const base: ClassifyInput = {
  members: MEMBERS,
  context: [],
  open_items: [],
  message: {
    sender_phone: PHONES.Kian,
    is_dm: false,
    kind: "text",
    text: "yes",
  },
};
const settle: ClassifyInput = {
  ...base,
  open_items: [
    {
      expense_id: "e1",
      description: "Frita Batidos",
      expense_status: "finalized",
      my_share_status: "locked",
    },
  ],
};
const approval = { intent: "approval" as const, confidence: 0.99 };

describe("decide", () => {
  it("acts on a confident approval when the sender has a settle request", () => {
    expect(decide(approval, settle)).toBe("act");
  });

  it("ignores a confident approval when nothing is waiting to be approved", () => {
    expect(decide(approval, base)).toBe("ignore");
  });

  it("treats a text approval like any other intent, since it only points to the 👍 (SPEC #15)", () => {
    expect(decide({ ...approval, confidence: 0.87 }, settle)).toBe("act");
  });

  it("applies the 0.85 act and 0.50 clarify thresholds to other intents", () => {
    expect(decide({ intent: "expense", confidence: 0.9 }, base)).toBe("act");
    expect(decide({ intent: "expense", confidence: 0.6 }, base)).toBe(
      "clarify",
    );
    expect(decide({ intent: "expense", confidence: 0.3 }, base)).toBe("ignore");
  });

  it("gives an inline reply to Tab more weight", () => {
    const toTab: ClassifyInput = {
      ...base,
      message: { ...base.message, reply_to_id: "tab-1", reply_to_tab: "I keep track of shared costs" },
    };
    expect(decide({ intent: "help", confidence: 0.7 }, toTab)).toBe("act");
    expect(decide({ intent: "breakdown_request", confidence: 0.43 }, toTab)).toBe("clarify");
    expect(decide({ intent: "help", confidence: 0.2 }, toTab)).toBe("ignore");
    // Money-changing intents still need 0.85 to act; below that Tab asks.
    expect(decide({ intent: "split_adjustment", confidence: 0.62 }, toTab)).toBe("clarify");
    expect(decide({ intent: "expense", confidence: 0.9 }, toTab)).toBe("act");
    expect(decide({ intent: "ignore", confidence: 0.9 }, toTab)).toBe("ignore");
    expect(decide({ intent: "approval", confidence: 0.7 }, { ...toTab, open_items: [] })).toBe("ignore");
  });

  it("never acts on ignore, whatever the confidence", () => {
    expect(decide({ intent: "ignore", confidence: 1 }, base)).toBe("ignore");
  });
});
