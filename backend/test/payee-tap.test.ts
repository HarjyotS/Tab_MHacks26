// Joe's review on #47: Priya, the payee on a settle request, tapped 👍 five
// times and Tab said nothing. Her 👍 still pays nothing (P7), but Tab says
// so once.
import { describe, expect, it } from "vitest";
import * as T from "../src/copy/templates.js";
import { GROUP, PEOPLE, world } from "./support/harness.js";

const raw = (cents: number, description: string) => ({
  is_expense: true,
  amount_cents: cents,
  amount_is_per_person: false,
  description,
  payer: "sender",
  payer_name: null,
  participants: "everyone",
  participant_names: [],
  exclusion_names: [],
  fixed: [],
});

describe("the payee's 👍 on a settle request", () => {
  async function requested() {
    const w = world({ expense: { "new|got pizza, $40": raw(4000, "Pizza") } });
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000); // locked in
    const settle = await w.say("Kian", "let's settle up");
    const request = `settle_request:${GROUP}:${settle.message_id}`;
    const replies = () => w.db.outbox().filter((o) => o.action_id.startsWith("payee_tap:"));
    return { w, request, replies };
  }

  it("gets one quiet reply naming who still owes them, and nothing on later taps", async () => {
    const { w, request, replies } = await requested();
    await w.react("Joe", request);
    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toMatchObject({ kind: "dm", to_phone: PEOPLE.Joe, text: "you're the one getting paid, just waiting on Kian, Priya, and Jake" });
    await w.react("Joe", request);
    await w.react("Joe", request);
    expect(replies()).toHaveLength(1);
    expect(w.db.transfers()).toEqual([]); // never pays (P7)
    expect(w.db.shares(w.db.expenses()[0]!.expense_id).filter((s) => s.status === "locked")).toHaveLength(4);
  });

  it("leaves everyone else's 👍 paying exactly as before", async () => {
    const { w, request, replies } = await requested();
    await w.react("Kian", request);
    expect(w.db.transfers().map((t) => t.from_phone)).toEqual([PEOPLE.Kian]);
    expect(replies()).toEqual([]);
    await w.react("Joe", request);
    expect(replies()[0]!.text).toBe("you're the one getting paid, just waiting on Priya and Jake");
  });

  it("says everyone's paid when nobody still owes", () => {
    expect(T.payeeTapped([])).toBe("everyone's already paid you");
  });
});
