import { describe, expect, it } from "vitest";
import { ledgerConfig } from "../src/config.js";
import { ledgerSecret } from "../src/brain/ledger.js";
import { PEOPLE, world } from "./support/harness.js";

const KEY = "k".repeat(32);
const withLedger = () => {
  const w = world({});
  w.ctx.ledger = { baseUrl: "https://tab.example", key: KEY };
  return w;
};
const secretSets = (w: ReturnType<typeof world>) => w.db.ledgerSecrets;

describe("@tab ledger (SPEC 12.3)", () => {
  it("posts the group's link and registers its secret with the module", async () => {
    const w = withLedger();
    await w.say("Kian", "@tab ledger");
    const url = `https://tab.example/g/${ledgerSecret(KEY, "house")}`;
    expect(w.db.outbox().find((o) => o.action_id.startsWith("ledger_link:"))!.text).toBe(`here's the ledger: ${url}`);
    expect(secretSets(w).get("house")).toBe(ledgerSecret(KEY, "house"));
  });

  it("keeps the link's case in a group that types in lowercase", async () => {
    const w = withLedger();
    for (const t of ["lol ok", "omw", "who's home", "same"]) await w.say("Priya", t);
    await w.say("Kian", "@tab ledger");
    const text = w.db.outbox().find((o) => o.action_id.startsWith("ledger_link:"))!.text!;
    expect(text).toContain(`/g/${ledgerSecret(KEY, "house")}`);
    expect(text.startsWith("here's")).toBe(true);
  });

  it("gives the same link every time, so links already posted keep working", async () => {
    expect(ledgerSecret(KEY, "house")).toBe(ledgerSecret(KEY, "house"));
    expect(ledgerSecret(KEY, "house")).not.toBe(ledgerSecret(KEY, "trip"));
    expect(ledgerSecret(KEY, "house").length).toBeGreaterThanOrEqual(24); // the module's minimum
  });

  it("sends one link per group by DM", async () => {
    const w = withLedger();
    w.db.addGroup("trip", [{ phone: PEOPLE.Kian, name: "Kian" }, { phone: PEOPLE.Joe, name: "Joe" }]);
    await w.dm("Kian", "ledger?");
    const reply = w.db.outbox().find((o) => o.action_id.startsWith("ledger_link:"))!;
    expect(reply).toMatchObject({ kind: "dm", to_phone: PEOPLE.Kian });
    expect(reply.text!.split("\n")).toHaveLength(3);
  });

  it("says it isn't set up when there's no ledger configured", async () => {
    const w = world({});
    await w.say("Kian", "@tab ledger");
    expect(w.db.outbox().find((o) => o.action_id.startsWith("ledger_link:"))!.text).toBe("the ledger site isn't set up yet");
  });

  it("ignores the word in passing chatter", async () => {
    const w = withLedger();
    await w.say("Kian", "my dad keeps a ledger for everything lol");
    expect(w.db.outbox().some((o) => o.action_id.startsWith("ledger_link:"))).toBe(false);
  });
});

describe("ledgerConfig", () => {
  it("is off when neither setting is present", () => {
    expect(ledgerConfig({})).toBeUndefined();
  });

  it("fails at startup on a half-configured or invalid setup", () => {
    expect(() => ledgerConfig({ LEDGER_LINK_KEY: KEY })).toThrow(/LEDGER_BASE_URL/);
    expect(() => ledgerConfig({ LEDGER_BASE_URL: "https://tab.example", LEDGER_LINK_KEY: "short" })).toThrow(/32/);
    expect(() => ledgerConfig({ LEDGER_BASE_URL: "not a url", LEDGER_LINK_KEY: KEY })).toThrow(/URL/);
  });

  it("drops a trailing slash", () => {
    expect(ledgerConfig({ LEDGER_BASE_URL: "https://tab.example/", LEDGER_LINK_KEY: KEY })!.baseUrl).toBe("https://tab.example");
  });
});
