// What the site promises (addtab.app FAQ and privacy page), checked end to
// end: STOP and START, "delete my data", payment links the payee confirms,
// and reminders that never go in front of the group.
import { describe, expect, it } from "vitest";
import { stubClassifier, type Intent } from "@tab/gate";
import { cashAppLink, parseHandle, venmoLink } from "../src/brain/payments.js";
import { GROUP, PEOPLE, world, type Name } from "./support/harness.js";

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

const script = {
  expense: {
    "new|got pizza, $40": raw(4000, "Pizza"),
    "new|got groceries, $60": raw(6000, "Groceries"),
  },
};

type W = ReturnType<typeof world>;

function gateSays(w: W, verdicts: Record<string, [Intent, number]>) {
  w.ctx.classify = async (input) => {
    const v = verdicts[input.message.text ?? ""];
    return v ? { intent: v[0], confidence: v[1] } : stubClassifier(input);
  };
}

const dmsTo = (w: W, who: Name) => w.db.outbox().filter((o) => o.kind === "dm" && o.to_phone === PEOPLE[who] && o.status !== "cancelled");
const share = (w: W, id: string, who: Name) => w.db.shares(id).find((s) => s.phone === PEOPLE[who])!;
const groupTexts = (w: W) => w.db.outbox().filter((o) => o.kind === "group_message" && o.status !== "cancelled").map((o) => o.text ?? "");

// Joe's pizza, locked in, then someone asks to settle up.
async function settled(w: W) {
  const pizza = await w.say("Joe", "got pizza, $40");
  await w.wait(31_000); // past the demo objection window
  const s = await w.say("Kian", "let's settle up");
  return { id: `exp_${pizza.message_id}`, request: `settle_request:${GROUP}:${s.message_id}` };
}

const linkFor = (w: W, debtor: Name, payee: Name, request: string) => w.db.out.get(`payment_link:${PEOPLE[debtor]}:${PEOPLE[payee]}:${request}`)!;

describe("STOP and START (§19)", () => {
  it("STOP by DM: one confirmation, then no DMs, no new splits, and Tab leaves their messages alone", async () => {
    const w = world(script);
    const stop = await w.dm("Priya", "STOP");
    expect(w.db.person(PEOPLE.Priya)?.opted_out).toBe(true);
    expect(dmsTo(w, "Priya").map((o) => o.purpose)).toEqual(["opt_out"]);
    expect(dmsTo(w, "Priya")[0]!.text).toMatch(/^got it, you're out\ni won't text you or add you to new splits/);
    expect(stop.text).toBeUndefined(); // a command, not kept

    const pizza = await w.say("Joe", "got pizza, $40");
    const shares = w.db.shares(`exp_${pizza.message_id}`);
    expect(shares.map((s) => s.phone).sort()).toEqual([PEOPLE.Joe, PEOPLE.Kian, PEOPLE.Jake].sort());
    expect(shares.reduce((n, s) => n + s.amount_cents, 0)).toBe(4000);

    const hers = await w.say("Priya", "got groceries, $60");
    expect(hers).toMatchObject({ intent: "ignore", text: undefined, status: "done" });
    expect(w.db.expenses()).toHaveLength(1);
    expect(w.db.outbox().filter((o) => o.target_message_id === hers.message_id)).toEqual([]);

    // The module refuses DMs to her, whatever asks for one.
    await w.ctx.db.enqueue_outbox({ action_id: "probe", kind: "dm", to_phone: PEOPLE.Priya, text: "hi", purpose: "other", send_after: w.ctx.now() });
    expect(w.db.out.has("probe")).toBe(false);

    await w.dm("Priya", "start");
    expect(w.db.person(PEOPLE.Priya)?.opted_out).toBe(false);
    expect(dmsTo(w, "Priya").at(-1)!.text).toBe("welcome back, you're in again");
  });

  it("a bare stop in the group is chatter; @tab stop counts and Tab answers there", async () => {
    const w = world(script);
    await w.say("Jake", "stop");
    expect(w.db.person(PEOPLE.Jake)).toBeUndefined();
    const m = await w.say("Jake", "@tab stop");
    expect(w.db.person(PEOPLE.Jake)?.opted_out).toBe(true);
    const reply = w.db.outbox().find((o) => o.target_message_id === m.message_id)!;
    expect(reply).toMatchObject({ kind: "group_message", purpose: "opt_out" });
    expect(reply.text!.split("\n")).toHaveLength(3); // the group limit
  });

  it("STOP as a reply to one of Tab's messages counts", async () => {
    const w = world(script);
    await w.say("Joe", "got pizza, $40");
    const proposal = w.db.outbox().find((o) => o.purpose === "split_proposal")!;
    await w.say("Kian", "stop", { reply_to_id: proposal.sent_photon_id });
    expect(w.db.person(PEOPLE.Kian)?.opted_out).toBe(true);
  });
});

describe('"delete my data" (§19)', () => {
  it("asks to confirm by DM, then removes them and keeps the group's amounts adding up", async () => {
    const w = world(script);
    const { id } = await settled(w);
    await w.dm("Kian", "delete my data");
    expect(dmsTo(w, "Kian").at(-1)!.text).toMatch(/reply delete to confirm$/);
    expect(w.db.members(GROUP).some((m) => m.phone === PEOPLE.Kian)).toBe(true); // nothing yet

    await w.dm("Kian", "DELETE");
    const shares = w.db.shares(id);
    expect(shares.some((s) => s.phone === PEOPLE.Kian)).toBe(false);
    expect(shares.filter((s) => s.phone.startsWith("forgotten:"))).toHaveLength(1);
    expect(shares.reduce((n, s) => n + s.amount_cents, 0)).toBe(4000);
    expect(w.db.members(GROUP).some((m) => m.phone === PEOPLE.Kian)).toBe(false);
    expect(w.db.messages().some((m) => m.sender_phone === PEOPLE.Kian)).toBe(false);
    expect(w.db.messages().filter((m) => m.sender_phone.startsWith("forgotten:")).every((m) => m.text === undefined)).toBe(true);
    // Only the opt-out stays, so Tab never texts the number again.
    expect(w.db.person(PEOPLE.Kian)).toEqual({ phone: PEOPLE.Kian, opted_out: true });
    expect(w.db.outbox().find((o) => o.action_id.startsWith("forgotten:"))).toMatchObject({ kind: "dm", to_phone: PEOPLE.Kian, purpose: "opt_out" });

    // The rest of the group still sees the amount, without a name.
    await w.say("Joe", "let's settle up");
    expect(w.said("settle_request").at(-1)).toContain("someone who left $10.00");
  });

  it("a DELETE nobody asked for does nothing", async () => {
    const w = world(script);
    await w.dm("Kian", "DELETE");
    expect(w.db.members(GROUP).some((m) => m.phone === PEOPLE.Kian)).toBe(true);
    expect(w.db.person(PEOPLE.Kian)).toBeUndefined();
  });
});

describe("payment links (§7.6): Tab never moves money", () => {
  it("texts each person their link, the payee confirms it arrived, then they're square", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    await w.ctx.db.set_payment_handle({ phone: PEOPLE.Joe, venmo: "joe-smith" });
    const { id, request } = await settled(w);
    expect(w.said("settle_request").at(-1)).toMatch(/\ni'll text each of you a link to pay|texting each of you a link to pay/);

    const link = linkFor(w, "Kian", "Joe", request);
    expect(link).toMatchObject({ kind: "dm", to_phone: PEOPLE.Kian, purpose: "payment_link" });
    expect(link.text).toBe("you owe Joe $10.00 for pizza\nvenmo: https://venmo.com/joe-smith?txn=pay&amount=10.00&note=Pizza\ntap 👍 here once it's sent");
    expect(dmsTo(w, "Joe")).toEqual([]); // the payee has a handle: nothing to ask

    await w.react("Kian", link.action_id);
    expect(share(w, id, "Kian").status).toBe("approved");
    expect(w.db.transfers()).toEqual([
      expect.objectContaining({ from_phone: PEOPLE.Kian, to_phone: PEOPLE.Joe, amount_cents: 1000, status: "reported", provider: "venmo" }),
    ]);
    expect(dmsTo(w, "Kian").at(-1)!.text).toBe("nice, checking with Joe that it came through");
    const check = dmsTo(w, "Joe").find((o) => o.purpose === "payment_check")!;
    expect(check.text).toBe("Kian says they sent you $10.00 for pizza\ntap 👍 if it came through, 👎 if it didn't");

    await w.react("Joe", check.action_id);
    expect(share(w, id, "Kian").status).toBe("paid");
    await w.wait(1000);
    expect(dmsTo(w, "Kian").at(-1)!.text).toBe("Joe got your $10.00 for pizza\nyou're all square");

    // Everyone else pays the same way; then the group hears it's done.
    for (const who of ["Priya", "Jake"] as const) {
      await w.react(who, linkFor(w, who, "Joe", request).action_id);
      await w.react("Joe", dmsTo(w, "Joe").filter((o) => o.purpose === "payment_check").at(-1)!.action_id);
    }
    await w.wait(1000);
    expect(w.db.expense(id)!.status).toBe("settled");
    expect(w.said("all_square")).toHaveLength(1);
  });

  it("asks the payee for their handle once, then sends the links that were waiting", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    const { request } = await settled(w);
    const prompts = dmsTo(w, "Joe").filter((o) => o.purpose === "handle_prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.text).toMatch(/what's your venmo or cash app\? like @your-name or \$yourname$/);
    expect(linkFor(w, "Kian", "Joe", request).text).toMatch(/^you owe Joe \$10\.00 for pizza\nasked Joe for their venmo/);

    await w.dm("Joe", "$joecash");
    expect(w.db.person(PEOPLE.Joe)).toMatchObject({ cashtag: "joecash" });
    const late = w.db.out.get(`payment_link:${PEOPLE.Kian}:${PEOPLE.Joe}:${request}:handle`)!;
    expect(late.text).toBe("here's Joe's link for the $10.00 (pizza)\ncash app: https://cash.app/$joecash/10.00\ntap 👍 here once it's sent");

    // A second settle-up doesn't ask again.
    await w.say("Priya", "got groceries, $60");
    await w.wait(31_000);
    await w.say("Kian", "let's settle up");
    expect(dmsTo(w, "Joe").filter((o) => o.purpose === "handle_prompt")).toHaveLength(1);
  });

  it('"sent" by text reports it; the payee\'s "nope" puts it back on the tab', async () => {
    const w = world(script);
    w.ctx.payments = "links";
    await w.ctx.db.set_payment_handle({ phone: PEOPLE.Joe, venmo: "joe-smith" });
    const { id } = await settled(w);
    await w.dm("Priya", "sent");
    expect(share(w, id, "Priya").status).toBe("approved");
    await w.dm("Joe", "nope not yet");
    expect(share(w, id, "Priya").status).toBe("locked");
    expect(w.db.transfers()[0]!.status).toBe("failed");
    expect(dmsTo(w, "Priya").at(-1)!.text).toBe('Joe doesn\'t see the $10.00 yet\nmind double checking? say "sent" once it\'s sorted');
    await w.dm("Priya", "ok sent");
    await w.dm("Joe", "got it");
    expect(share(w, id, "Priya").status).toBe("paid");
  });

  it('the payee can say who paid them: "priya paid me"', async () => {
    const w = world(script);
    w.ctx.payments = "links";
    const { id } = await settled(w);
    gateSays(w, { "priya paid me": ["payment_reported", 0.95] });
    await w.say("Joe", "priya paid me");
    expect(share(w, id, "Priya").status).toBe("paid");
    expect(share(w, id, "Kian").status).toBe("locked");
    await w.wait(1000);
    expect(dmsTo(w, "Priya").at(-1)!.text).toBe("Joe got your $10.00 for pizza\nyou're all square");
  });

  it("a 👍 on the group's settle request pays nothing; only someone's own link does", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    const { request } = await settled(w);
    await w.react("Kian", request);
    expect(w.db.transfers()).toEqual([]);
  });

  it("a 👎 on a link disputes it", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    const { id, request } = await settled(w);
    await w.react("Jake", linkFor(w, "Jake", "Joe", request).action_id, "dislike");
    expect(share(w, id, "Jake").status).toBe("disputed");
    expect(dmsTo(w, "Jake").at(-1)!.purpose).toBe("dispute_followup");
  });

  it("reminds people privately with their link, three times at most, and never in the group", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    await w.ctx.db.set_payment_handle({ phone: PEOPLE.Joe, venmo: "joe-smith" });
    const { request } = await settled(w);
    await w.react("Kian", linkFor(w, "Kian", "Joe", request).action_id); // Kian paid
    const before = groupTexts(w).length;
    await w.wait(21_000); // 2h, scaled
    const first = w.db.outbox().filter((o) => o.purpose === "approval_followup");
    expect(first.map((o) => o.to_phone).sort()).toEqual([PEOPLE.Priya, PEOPLE.Jake].sort());
    expect(first.every((o) => o.kind === "dm")).toBe(true);
    expect(first[0]!.text).toMatch(/^(hey, no rush, you owe Joe \$10\.00 for pizza|heads up, you owe Joe \$10\.00 for pizza, whenever)\nvenmo: https:\/\/venmo\.com\/joe-smith\?txn=pay&amount=10\.00&note=Pizza\ntap 👍 here once it's sent$/);
    await w.wait(121_000);
    await w.wait(400_000);
    await w.wait(400_000);
    expect(w.db.outbox().filter((o) => o.purpose === "approval_followup")).toHaveLength(6);
    expect(groupTexts(w).slice(before).filter((t) => /Priya|Jake/.test(t))).toEqual([]);
    // Joe never answered "did it come through?": one reminder, by DM.
    expect(dmsTo(w, "Joe").filter((o) => o.action_id.endsWith(":again"))).toHaveLength(1);
  });
});

describe("handles and links", () => {
  it("reads a handle only after Tab asked, or when it's plainly theirs", () => {
    expect(parseHandle("@joe-smith", true)).toEqual({ venmo: "joe-smith" });
    expect(parseHandle("$joecash", true)).toEqual({ cashtag: "joecash" });
    expect(parseHandle("venmo is Joe_Smith-1 and cash app $joe1", true)).toEqual({ venmo: "Joe_Smith-1", cashtag: "joe1" });
    expect(parseHandle("my venmo is joe-smith", false)).toEqual({ venmo: "joe-smith" });
    expect(parseHandle("venmo'd @priya-k 20", false)).toBeUndefined();
    expect(parseHandle("nevermind", true)).toBeUndefined();
    expect(parseHandle("$20 lol", true)).toBeUndefined();
  });

  it("builds Venmo's documented pay link and Cash App's amount link", () => {
    expect(venmoLink("joe-smith", 4128, "vegas trip")).toBe("https://venmo.com/joe-smith?txn=pay&amount=41.28&note=vegas%20trip");
    expect(venmoLink("joe", 5, "x")).toBe("https://venmo.com/joe?txn=pay&amount=0.05&note=x");
    expect(cashAppLink("joecash", 120000)).toBe("https://cash.app/$joecash/1200.00");
  });
});

describe("payment talk Tab doesn't track", () => {
  it("a payment for something else, or another amount, isn't reported", async () => {
    const w = world(script);
    w.ctx.payments = "links";
    const { id } = await settled(w);
    const cleats = "i venmo'd you 20 for the cleats joe";
    const other = "just venmo'd joe 25";
    const ours = "just venmo'd joe for the pizza";
    gateSays(w, { [cleats]: ["payment_reported", 1], [other]: ["payment_reported", 1], [ours]: ["payment_reported", 1] });
    await w.say("Kian", cleats);
    await w.say("Priya", other);
    expect(w.db.transfers()).toEqual([]);
    expect(dmsTo(w, "Joe").filter((o) => o.purpose === "payment_check")).toEqual([]);
    await w.say("Jake", ours);
    expect(share(w, id, "Jake").status).toBe("approved");
  });
});
