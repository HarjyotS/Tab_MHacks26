import { describe, expect, it } from "vitest";
import { normalizeText, processMessage } from "../src/brain/process.js";
import { parseName } from "../src/brain/talk.js";
import { world } from "./support/harness.js";

const raw = {
  is_expense: true,
  amount_cents: null,
  amount_is_per_person: false,
  description: null,
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
};

describe("what do i owe", () => {
  it("answers with just the amount, and explains only when asked why", async () => {
    const w = world({
      expense: {
        "new|got pizza for everyone, $48": {
          ...raw,
          amount_cents: 4800,
          description: "Pizza",
        },
        "adjustment|not even, jake only had a $3 diet coke": {
          ...raw,
          payer: "unknown",
          fixed: [{ name: "jake", amount_cents: 300, item: "diet coke" }],
        },
      },
    });
    await w.say("Joe", "got pizza for everyone, $48");
    await w.say("Kian", "not even, jake only had a $3 diet coke");
    await w.wait(41_000);
    await w.say("Priya", "what do i owe");
    expect(w.said("balance_reply")).toEqual(["you owe joe $15.00"]);
    await w.say("Priya", "why");
    expect(w.said("breakdown_reply")).toEqual([
      "pizza $15.00: split 3 ways after jake's $3.00",
    ]);
  });

  it("ignores a why that isn't about a balance", async () => {
    const w = world({});
    await w.say("Priya", "why");
    expect(w.said("breakdown_reply")).toEqual([]);
  });
});

describe("names from iPhones (Harjyot's live bug on #14)", () => {
  it.each([
    ["I\u2019m Tanuj", "Tanuj"],
    ["it\u2019s Priya", "Priya"],
    ["@tab I\u2019m Tanuj ", "Tanuj"],
    ["I'm Tanuj", "Tanuj"],
    ["joe", "Joe"],
  ])("parses %j as %s once curly quotes are normalized", (text, name) => {
    expect(parseName(normalizeText(text)!)).toBe(name);
  });

  it("saves a plain first name end to end after the name prompt", async () => {
    const w = world({});
    w.db.addGroup("new", [{ phone: "+15555550111" }, { phone: "+15555550112" }], "pending");
    await w.wait(1000); // onboarding: intro and name prompt go out
    w.advance(1000);
    await processMessage(w.ctx, w.db.ingest({ sender_phone: "+15555550111", group_id: "new", text: "tanuj" }));
    expect(w.db.members("new").find((x) => x.phone === "+15555550111")!.name).toBe("Tanuj");
  });
});
