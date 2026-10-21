// The Postgres store: what an operation changes is saved, a restart loads
// exactly that back, and a failed operation leaves both memory and the
// database as they were. PGlite runs real Postgres in-process.
import { PGlite } from "@electric-sql/pglite";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createReducers } from "../src/db/reducers.js";
import { startHub } from "../src/hub.js";
import { Engine, SaveError, TABLES } from "../src/store/engine.js";
import { claimLease, LeaseLost, load, migrate, persistTo, type Sql } from "../src/store/postgres.js";

async function pglite(): Promise<Sql & { db: PGlite }> {
  const db = await PGlite.create();
  return {
    db,
    query: async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows,
    transaction: async (statements) => {
      await db.transaction(async (tx) => {
        for (const s of statements) await tx.query(s.text, s.params);
      });
    },
  };
}

let clock = new Date("2026-10-21T18:00:00Z");
const now = () => clock;

async function setup() {
  const sql = await pglite();
  await migrate(sql);
  const engine = new Engine({ now, persist: persistTo(sql) });
  await load(sql, engine);
  return { sql, engine, db: createReducers(engine.client) };
}

// Every table, as plain JSON, for comparing two engines.
const dump = (e: Engine) =>
  Object.fromEntries(TABLES.map((t) => [t, JSON.parse(JSON.stringify([...e.table(t)].sort(([a], [b]) => a.localeCompare(b))))]));

async function reloaded(sql: Sql) {
  const fresh = new Engine({ now });
  await load(sql, fresh);
  return fresh;
}

const AMY = "+15550000001";
const BEN = "+15550000002";
const CAL = "+15550000003";

async function trip(engine: Engine, db: ReturnType<typeof createReducers>) {
  for (const [i, phone] of [AMY, BEN, CAL].entries()) {
    await engine.ingestMessage({
      message_id: `m${i}`,
      group_id: "g1",
      group_ledger_id: "ledger-g1",
      group_display_name: "vegas",
      group_timezone: "America/Denver",
      sender_phone: phone,
      sender_ledger_member_id: `lm-${i}`,
      is_dm: false,
      kind: "text",
      text: i === 0 ? "i paid 90 for dinner" : "ok",
      received_at: clock,
    });
  }
  await db.set_group_status({ group_id: "g1", status: "active" });
  await db.set_member_name({ member_id: `g1:${AMY}`, name: " Amy " });
  await db.upsert_expense({
    expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
    split_mode: "even", status: "proposed", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
  });
  for (const phone of [AMY, BEN, CAL]) {
    await db.set_share({ expense_id: "e1", phone, role: phone === AMY ? "payer" : "participant", status: "proposed", responded: false, followup_count: 0 });
  }
  await db.enqueue_outbox({ action_id: "a1", kind: "group_message", group_id: "g1", text: "split 3 ways, $30 each", expense_id: "e1", purpose: "split_proposal", send_after: clock });
  await engine.markOutbox({ action_id: "a1", status: "sent", sent_photon_id: "imsg-1" });
  await db.set_settle_mode({ group_id: "g1", settle_mode: "per_expense" });
  await db.set_ledger_secret({ group_id: "g1", secret: "x".repeat(32) });
  await db.set_payment_handle({ phone: AMY, venmo: "amy-lee" });
}

describe("postgres store", () => {
  afterEach(() => {
    clock = new Date("2026-10-21T18:00:00Z");
  });

  it("migrates twice without complaint", async () => {
    const { sql } = await setup();
    await migrate(sql);
    const tables = await sql.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    expect(tables[0]!.n).toBe(TABLES.length + 1); // and the lease
  });

  it("loads back exactly what was saved", async () => {
    const { sql, engine, db } = await setup();
    await trip(engine, db);
    const shares = engine.shares("e1");
    expect(shares.map((s) => s.amount_cents).sort()).toEqual([3000, 3000, 3000]);
    expect(engine.members("g1").find((m) => m.phone === AMY)?.name).toBe("Amy");
    const fresh = await reloaded(sql);
    expect(dump(fresh)).toEqual(dump(engine));
    // Dates come back as Dates, cents as numbers.
    expect(fresh.expense("e1")?.created_at).toBeInstanceOf(Date);
    expect(fresh.outbox()[0]).toMatchObject({ status: "sent", sent_photon_id: "imsg-1", send_after: clock });
    expect(fresh.settleMode("g1")).toBe("per_expense");
    expect(fresh.person(AMY)).toEqual({ phone: AMY, opted_out: false, venmo: "amy-lee" });
  });

  it("saves a forgotten person's rows under their new ids, and drops the old ones", async () => {
    const { sql, engine, db } = await setup();
    await trip(engine, db);
    await db.forget_person({ phone: BEN });
    const fresh = await reloaded(sql);
    expect(dump(fresh)).toEqual(dump(engine));
    const all = JSON.stringify(dump(fresh));
    expect(all.includes(BEN)).toBe(true); // only the opt-out, keyed by the number
    expect(fresh.person(BEN)).toEqual({ phone: BEN, opted_out: true });
    expect(JSON.stringify(dump(fresh)).split(BEN).length - 1).toBe(2); // the people row's key and phone
  });

  it("rolls back an operation whose rules throw, in memory and in the database", async () => {
    const { sql, engine, db } = await setup();
    await trip(engine, db);
    await db.upsert_expense({
      expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
      split_mode: "even", status: "finalized", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
    });
    const before = dump(engine);
    // Both write a row, then the rules refuse: amounts are locked once finalized.
    await expect(
      db.set_share({ expense_id: "e1", phone: "+15550000004", role: "participant", status: "proposed", responded: false, followup_count: 0 }),
    ).rejects.toThrow(/locked/);
    await expect(
      db.set_line_items({ expense_id: "e1", items: [{ item_id: "i1", position: 1, description: "wings", quantity: 1, amount_cents: 1200 }] }),
    ).rejects.toThrow(/locked/);
    expect(dump(engine)).toEqual(before);
    expect(engine.shares("e1").every((s) => s.amount_cents === 3000)).toBe(true);
    expect(dump(await reloaded(sql))).toEqual(before);
  });

  it("puts everything back when the database can't be reached, and says so", async () => {
    const sql = await pglite();
    await migrate(sql);
    let down = false;
    let tries = 0;
    const flaky: Sql = {
      query: sql.query,
      transaction: (s) => (down ? (tries++, Promise.reject(new TypeError("fetch failed"))) : sql.transaction(s)),
    };
    const failed: SaveError[] = [];
    const engine = new Engine({ now, persist: persistTo(flaky, { retryDelayMs: 0 }), onSaveFailed: (e) => failed.push(e) });
    const db = createReducers(engine.client);
    await trip(engine, db);
    const before = dump(engine);
    down = true;
    await expect(db.set_opt_out({ phone: CAL, opted_out: true })).rejects.toThrow(/saving failed/);
    expect(tries).toBe(3);
    expect(failed).toHaveLength(1);
    expect(dump(engine)).toEqual(before);
    down = false;
    await db.set_opt_out({ phone: CAL, opted_out: true });
    expect((await reloaded(sql)).person(CAL)?.opted_out).toBe(true);
  });

  it("doesn't retry a change Postgres refuses, and doesn't call it an outage", async () => {
    const sql = await pglite();
    await migrate(sql);
    let tries = 0;
    const refusing: Sql = {
      query: sql.query,
      transaction: () => (tries++, Promise.reject(Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" }))),
    };
    const failed: SaveError[] = [];
    const engine = new Engine({ now, persist: persistTo(refusing, { retryDelayMs: 0 }), onSaveFailed: (e) => failed.push(e) });
    const err = await createReducers(engine.client).set_opt_out({ phone: CAL, opted_out: true }).catch((e) => e);
    expect(String(err)).toMatch(/refused/);
    expect(err.cause).not.toBeInstanceOf(SaveError);
    expect(tries).toBe(1);
    expect(failed).toEqual([]);
    expect(engine.person(CAL)).toBeUndefined();
  });

  it("keeps text with a NUL byte, without the NUL", async () => {
    const { sql, engine } = await setup();
    const server = await startHub(engine, { port: 0, log: () => {} });
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hub/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: "nul", sender_phone: AMY, is_dm: true, kind: "text", text: "paid 40\u0000", received_at: clock.toISOString() }),
      });
      expect(res.status).toBe(200);
      expect((await reloaded(sql)).messages()[0]?.text).toBe("paid 40");
    } finally {
      server.close();
    }
  });

  it("stops a backend once another one starts on the same database", async () => {
    const sql = await pglite();
    await migrate(sql);
    const failed: SaveError[] = [];
    await claimLease(sql, "server");
    const server = new Engine({ now, persist: persistTo(sql, { owner: "server", retryDelayMs: 0 }), onSaveFailed: (e) => failed.push(e) });
    await load(sql, server);
    await createReducers(server.client).set_opt_out({ phone: AMY, opted_out: true });

    await claimLease(sql, "laptop");
    const err = await createReducers(server.client).set_opt_out({ phone: BEN, opted_out: true }).catch((e) => e);
    expect(err.cause).toBeInstanceOf(LeaseLost);
    expect(failed[0]).toBeInstanceOf(LeaseLost);
    const fresh = await reloaded(sql);
    expect(fresh.person(AMY)?.opted_out).toBe(true);
    expect(fresh.person(BEN)).toBeUndefined();
  });

  it("loads tables bigger than one page", async () => {
    const sql = await pglite();
    await migrate(sql);
    await sql.query(
      `INSERT INTO messages (message_id, sender_phone, is_dm, kind, received_at, status)
       SELECT 'm' || lpad(i::text, 5, '0'), '+1555', true, 'text', now(), 'done' FROM generate_series(1, 4500) AS i`,
    );
    const engine = await reloaded(sql);
    expect(engine.msgs.size).toBe(4500);
  });

  it("fails on a transfer id that's taken, like the module's insert", async () => {
    const { engine, db } = await setup();
    await trip(engine, db);
    for (const phone of [BEN, CAL]) await db.set_share({ expense_id: "e1", phone, role: "participant", status: "locked", responded: true, followup_count: 0 });
    await db.upsert_expense({
      expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
      split_mode: "even", status: "finalized", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
    });
    await db.record_payment({ transfer_id: "t1", expense_id: "e1", from_phone: BEN, message_id: "m1", provider: "venmo" });
    await expect(db.record_payment({ transfer_id: "t1", expense_id: "e1", from_phone: CAL, message_id: "m2", provider: "venmo" })).rejects.toThrow(/already exists/);
    expect(engine.shares("e1").find((s) => s.phone === CAL)?.status).toBe("locked");
  });

  it("runs operations one at a time, in the order they were called", async () => {
    const { sql, engine, db } = await setup();
    await trip(engine, db);
    await Promise.all([
      db.set_payment_handle({ phone: BEN, venmo: "ben-one" }),
      db.set_payment_handle({ phone: BEN, venmo: "ben-two" }),
      db.set_payment_handle({ phone: BEN, cashtag: "ben3" }),
    ]);
    expect((await reloaded(sql)).person(BEN)).toEqual({ phone: BEN, opted_out: false, venmo: "ben-two", cashtag: "ben3" });
  });

  it("completes a simulated transfer on its schedule, after a restart too", async () => {
    const { sql, engine, db } = await setup();
    await trip(engine, db);
    await db.upsert_expense({
      expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
      split_mode: "even", status: "proposed", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
    });
    for (const phone of [BEN, CAL]) await db.set_share({ expense_id: "e1", phone, role: "participant", status: "locked", responded: true, followup_count: 0 });
    await db.set_share({ expense_id: "e1", phone: AMY, role: "payer", status: "locked", responded: true, followup_count: 0 });
    await db.upsert_expense({
      expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
      split_mode: "even", status: "finalized", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
    });
    await db.create_transfer({ transfer_id: "t1", expense_id: "e1", from_phone: BEN, approved_by_message_id: "m1" });
    await engine.completeDueTransfers();
    expect(engine.transfers()[0]!.status).toBe("pending"); // not due yet

    clock = new Date(clock.getTime() + 2_500);
    const restarted = await reloaded(sql);
    const persisted = new Engine({ now, persist: persistTo(sql) });
    await load(sql, persisted);
    await persisted.completeDueTransfers();
    expect(persisted.transfers()[0]).toMatchObject({ status: "done", completed_at: clock });
    expect(persisted.shares("e1").find((s) => s.phone === BEN)?.status).toBe("paid");
    expect(restarted.schedule.size).toBe(1);
    expect((await reloaded(sql)).schedule.size).toBe(0);
  });

  it("drops a simulated transfer that can't complete, and still completes the others", async () => {
    const { engine, db } = await setup();
    await trip(engine, db);
    for (const phone of [BEN, CAL]) await db.set_share({ expense_id: "e1", phone, role: "participant", status: "locked", responded: true, followup_count: 0 });
    await db.upsert_expense({
      expense_id: "e1", group_id: "g1", payer_phone: AMY, description: "dinner", source_message_id: "m0",
      split_mode: "even", status: "finalized", tax_cents: 0, tip_cents: 0, fees_cents: 0, discount_cents: 0, total_cents: 9000,
    });
    await db.create_transfer({ transfer_id: "t1", expense_id: "e1", from_phone: BEN, approved_by_message_id: "m1" });
    await db.create_transfer({ transfer_id: "t2", expense_id: "e1", from_phone: CAL, approved_by_message_id: "m2" });
    engine.shrs.get(`e1:${BEN}`)!.status = "locked"; // something else moved BEN's share on
    await engine.completeDueTransfers(true);
    expect(engine.transfers().find((t) => t.transfer_id === "t2")?.status).toBe("done");
    expect(engine.transfers().find((t) => t.transfer_id === "t1")?.status).toBe("pending");
    expect(engine.schedule.size).toBe(0);
  });
});

describe("hub", () => {
  async function hub() {
    const { sql, engine } = await setup();
    let ingested = 0;
    const withNotify = new Engine({ now, persist: persistTo(sql), onIngest: () => ingested++ });
    await load(sql, withNotify);
    const server = await startHub(withNotify, { port: 0, log: () => {} });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    void engine;
    return { sql, engine: withNotify, server, base, ingested: () => ingested };
  }

  it("takes messages and outbox updates from the bridge, and hands out what to send", async () => {
    const { engine, server, base, ingested } = await hub();
    try {
      const post = (path: string, body: unknown) =>
        fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const message = {
        message_id: "imsg-a", group_id: "g1", group_ledger_id: "l1", group_display_name: "vegas", group_timezone: "America/Denver",
        sender_phone: AMY, sender_ledger_member_id: "lm1", is_dm: false, kind: "text", text: "hi", received_at: clock.toISOString(),
      };
      expect((await post("/hub/ingest", message)).status).toBe(200);
      expect(ingested()).toBe(1);
      expect(engine.messages()[0]).toMatchObject({ message_id: "imsg-a", status: "new", received_at: clock });
      expect(engine.group("g1")).toMatchObject({ display_name: "vegas", onboarding_status: "pending" });

      await createReducers(engine.client).enqueue_outbox({ action_id: "a1", kind: "group_message", group_id: "g1", text: "yo", purpose: "other", send_after: clock });
      const due = (await (await fetch(base + "/hub/outbox")).json()) as { action_id: string; send_after: string }[];
      expect(due.map((r) => r.action_id)).toEqual(["a1"]);
      expect(new Date(due[0]!.send_after)).toEqual(clock);

      expect((await post("/hub/mark", { action_id: "a1", status: "sent", sent_photon_id: "p1" })).status).toBe(200);
      expect(await (await fetch(base + "/hub/outbox")).json()).toEqual([]);

      // A rule saying no is a 422; a malformed request a 400.
      expect((await post("/hub/mark", { action_id: "nope", status: "sent" })).status).toBe(422);
      expect((await post("/hub/ingest", { message_id: "x" })).status).toBe(400);
      expect((await post("/hub/ingest", { ...message, message_id: "imsg-b", kind: "sticker" })).status).toBe(422);
    } finally {
      server.close();
    }
  });

  it("answers 503 when the database is down, so the bridge tries again", async () => {
    const engine = new Engine({ now, persist: () => Promise.reject(new SaveError(new Error("neon unreachable"))) });
    const server = await startHub(engine, { port: 0, log: () => {} });
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hub/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: "m", sender_phone: AMY, is_dm: true, kind: "text", text: "hi", received_at: clock.toISOString(), group_timezone: "UTC" }),
      });
      expect(res.status).toBe(503);
      expect(engine.messages()).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("asks for the token when one is set", async () => {
    const engine = new Engine({ now });
    const server = await startHub(engine, { port: 0, token: "s3cret", log: () => {} });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(base + "/hub/outbox")).status).toBe(401);
      expect((await fetch(base + "/hub/outbox", { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
      expect((await fetch(base + "/health")).status).toBe(200);
      // Never a web page: anything with an Origin, or a POST that isn't JSON.
      const auth = { authorization: "Bearer s3cret" };
      expect((await fetch(base + "/hub/outbox", { headers: { ...auth, origin: "https://evil.example" } })).status).toBe(403);
      expect((await fetch(base + "/hub/mark", { method: "POST", headers: { ...auth, "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    } finally {
      server.close();
    }
  });
});
