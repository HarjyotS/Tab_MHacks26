// When nobody answers Tab (ghosting): one more ask the next morning, then
// the expense is dropped, and a settle-up says what's still open.
import { describe, expect, it } from "vitest";
import { timing } from "../src/config.js";
import { reaskAt } from "../src/brain/ghosting.js";
import { GROUP, world } from "./support/harness.js";

const raw = (cents: number | null, description: string | null) => ({
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

const script = {
  expense: {
    "new|venmo me for the uber": raw(null, "Uber"),
    "new|venmo me for the uber\n22": raw(2200, "Uber"),
    "new|got pizza, $40": raw(4000, "Pizza"),
  },
};

const HOUR = 3_600_000;

// Real timing (quiet hours on), starting 6pm in Detroit.
function live() {
  const w = world(script, new Date("2026-10-03T22:00:00Z"));
  w.ctx.timing = timing({});
  return w;
}

describe("ghosted questions", () => {
  it("asks once more the next morning, and the answer still works", async () => {
    const w = live();
    const ride = await w.say("Kian", "venmo me for the uber");
    const id = `exp_${ride.message_id}`;
    expect(w.said("clarifying_question")).toEqual(["how much was the uber?"]);
    await w.wait(3 * HOUR); // the question expired at 2h; 9pm now
    expect(w.said("clarifying_question")).toHaveLength(1);
    await w.wait(12 * HOUR); // 9am: still quiet
    expect(w.said("clarifying_question")).toHaveLength(1);
    await w.wait(HOUR); // 10am the next morning
    expect(w.said("clarifying_question").at(-1)).toBe("still need this one for the tab: how much was the uber?\nif nobody knows i'll drop it in a couple days");
    expect(w.db.out.get(`reask:${id}`)).toMatchObject({ kind: "group_message", target_message_id: ride.message_id });
    await w.wait(HOUR);
    expect(w.said("clarifying_question")).toHaveLength(2); // once

    await w.say("Kian", "22");
    expect(w.db.expense(id)).toMatchObject({ status: "proposed", total_cents: 2200 });
  });

  it("drops it quietly after three days with no answer", async () => {
    const w = live();
    const ride = await w.say("Kian", "venmo me for the uber");
    const id = `exp_${ride.message_id}`;
    for (let i = 0; i < 11; i++) await w.wait(6 * HOUR); // 66h
    await w.wait(4 * HOUR); // 70h
    expect(w.db.expense(id)!.status).toBe("needs_info");
    await w.wait(3 * HOUR); // 73h
    expect(w.db.expense(id)!.status).toBe("void");
    expect(w.said("clarifying_question")).toHaveLength(2); // the first ask and the re-ask, nothing more
  });

  it("settle-up lists what isn't locked in yet", async () => {
    const w = world(script);
    await w.say("Kian", "venmo me for the uber");
    await w.say("Joe", "got pizza, $40");
    await w.wait(31_000);
    await w.say("Priya", "let's settle up");
    expect(w.said("settle_request").at(-1)).toMatch(/\nnot in this yet: uber \(how much\?\)$/);
  });

  it("the re-ask waits for the morning in the group's timezone", () => {
    const w = live();
    const at = (iso: string) => ({ created_at: new Date(iso) }) as Parameters<typeof reaskAt>[1];
    // 6pm Detroit → 10am the next day; 1am → 10am that morning.
    expect(reaskAt(w.ctx, at("2026-10-03T22:00:00Z"), "America/Detroit").toISOString()).toBe("2026-10-04T14:00:00.000Z");
    expect(reaskAt(w.ctx, at("2026-10-04T05:00:00Z"), "America/Detroit").toISOString()).toBe("2026-10-04T14:00:00.000Z");
    expect(GROUP).toBe("house");
  });
});
