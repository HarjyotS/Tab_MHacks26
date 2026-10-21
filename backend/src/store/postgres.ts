// Keeps the engine's tables in Postgres (Neon in production). The backend
// loads every row at startup and holds them in memory, so reads never wait
// on the network; each operation's changes are saved in one transaction
// before it counts as done.
import { neon } from "@neondatabase/serverless";
import { SaveError, type Change, type Engine, type TableName } from "./engine.js";

type Col = "text" | "cents" | "int" | "float" | "bool" | "time";

type Spec = {
  sql: string; // table name in Postgres
  key: string; // primary key column, the engine's map key
  cols: Record<string, Col>; // every column but the key
  value?: string; // the map holds this one column, not a row
};

// Column names are the Store's field names.
export const SPECS: Record<TableName, Spec> = {
  msgs: {
    sql: "messages",
    key: "message_id",
    cols: {
      group_id: "text", sender_phone: "text", is_dm: "bool", kind: "text", text: "text", image_url: "text",
      reply_to_id: "text", reaction: "text", received_at: "time", intent: "text", confidence: "float",
      status: "text", error: "text",
    },
  },
  grps: {
    sql: "groups",
    key: "group_id",
    cols: { ledger_id: "text", display_name: "text", timezone: "text", onboarding_status: "text", created_at: "time" },
  },
  mems: {
    sql: "members",
    key: "member_id",
    cols: { ledger_member_id: "text", group_id: "text", phone: "text", name: "text", joined_at: "time", left_at: "time" },
  },
  out: {
    sql: "outbox",
    key: "action_id",
    cols: {
      kind: "text", group_id: "text", to_phone: "text", target_message_id: "text", text: "text", reaction: "text",
      expense_id: "text", purpose: "text", send_after: "time", status: "text", sent_photon_id: "text",
      created_at: "time", sent_at: "time", error: "text",
    },
  },
  exps: {
    sql: "expenses",
    key: "expense_id",
    cols: {
      group_id: "text", payer_phone: "text", description: "text", source_message_id: "text", split_mode: "text",
      status: "text", subtotal_cents: "cents", tax_cents: "cents", tip_cents: "cents", fees_cents: "cents",
      discount_cents: "cents", total_cents: "cents", objection_deadline: "time", claim_deadline: "time",
      proposal_message_id: "text", settle_message_id: "text", created_at: "time", finalized_at: "time",
    },
  },
  shrs: {
    sql: "shares",
    key: "share_id",
    cols: {
      expense_id: "text", phone: "text", role: "text", status: "text", fixed_cents: "cents", amount_cents: "cents",
      responded: "bool", followup_count: "int", last_followup_at: "time",
    },
  },
  trs: {
    sql: "transfers",
    key: "transfer_id",
    cols: {
      group_id: "text", expense_id: "text", from_phone: "text", to_phone: "text", amount_cents: "cents",
      provider: "text", status: "text", approved_by_message_id: "text", created_at: "time", completed_at: "time",
      error: "text",
    },
  },
  items: {
    sql: "line_items",
    key: "item_id",
    cols: { expense_id: "text", position: "int", description: "text", quantity: "int", amount_cents: "cents" },
  },
  clms: {
    sql: "claims",
    key: "claim_id",
    cols: { item_id: "text", expense_id: "text", phone: "text", source_message_id: "text", created_at: "time" },
  },
  schedule: { sql: "transfer_schedule", key: "transfer_id", cols: { run_at: "time" } },
  settings: { sql: "group_settings", key: "group_id", cols: { settle_mode: "text" }, value: "settle_mode" },
  ppl: { sql: "people", key: "phone", cols: { opted_out: "bool", venmo: "text", cashtag: "text" } },
  ledgerSecrets: { sql: "ledger_secrets", key: "group_id", cols: { secret: "text" }, value: "secret" },
};

const PG_TYPE: Record<Col, string> = {
  text: "text",
  cents: "bigint",
  int: "integer",
  float: "double precision",
  bool: "boolean",
  time: "timestamptz",
};

export type Statement = { text: string; params: unknown[] };

// The little Postgres the store needs: a query, and a batch that runs as
// one transaction. Neon's HTTP driver in production, PGlite in tests.
export interface Sql {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction(statements: Statement[]): Promise<void>;
}

// Each call gives up after 10s, so a hung request can't hold every write for minutes.
const TIMEOUT_MS = 10_000;

export function neonSql(url: string): Sql {
  const sql = neon(url);
  const fetchOptions = () => ({ signal: AbortSignal.timeout(TIMEOUT_MS) });
  return {
    query: (text, params = []) => sql.query(text, params, { fetchOptions: fetchOptions() }) as Promise<Record<string, unknown>[]>,
    transaction: async (statements) => {
      await sql.transaction(
        statements.map((s) => sql.query(s.text, s.params)),
        { fetchOptions: fetchOptions() },
      );
    },
  };
}

const q = (name: string) => `"${name}"`;
const TABLE_NAMES = Object.keys(SPECS) as TableName[];

// Which backend may write (claimLease): the newest one to start. Every save
// checks it, so a second copy (a laptop with the server's .env) can't quietly
// overwrite rows; the older one stops at its next save and restarts.
const LEASE = "backend_lease";

// Creates what's missing: tables, and columns added since. Never drops.
export async function migrate(sql: Sql): Promise<void> {
  const statements: Statement[] = [
    { text: `CREATE TABLE IF NOT EXISTS ${q(LEASE)} ("id" text PRIMARY KEY, "owner" text NOT NULL, "taken_at" timestamptz NOT NULL)`, params: [] },
  ];
  for (const name of TABLE_NAMES) {
    const spec = SPECS[name];
    statements.push({ text: `CREATE TABLE IF NOT EXISTS ${q(spec.sql)} (${q(spec.key)} text PRIMARY KEY)`, params: [] });
    for (const [col, type] of Object.entries(spec.cols)) {
      statements.push({ text: `ALTER TABLE ${q(spec.sql)} ADD COLUMN IF NOT EXISTS ${q(col)} ${PG_TYPE[type]}`, params: [] });
    }
  }
  await sql.transaction(statements);
}

export async function claimLease(sql: Sql, owner: string): Promise<void> {
  await sql.query(
    `INSERT INTO ${q(LEASE)} ("id", "owner", "taken_at") VALUES ('main', $1, now()) ON CONFLICT ("id") DO UPDATE SET "owner" = EXCLUDED."owner", "taken_at" = EXCLUDED."taken_at"`,
    [owner],
  );
}

// Fails the transaction (division by zero) unless this backend holds the lease.
const leaseCheck = (owner: string): Statement => ({
  text: `SELECT 1 / (SELECT count(*)::int FROM ${q(LEASE)} WHERE "id" = 'main' AND "owner" = $1) AS ok`,
  params: [owner],
});

export class LeaseLost extends SaveError {
  constructor(cause: unknown) {
    super(cause);
    this.message = "another backend started on this database, so this one stops";
  }
}

function fromDb(type: Col, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  switch (type) {
    case "float": {
      const num = Number(v);
      return Number.isFinite(num) ? num : undefined;
    }
    case "cents":
    case "int": {
      const num = Number(v);
      if (!Number.isSafeInteger(num)) throw new RangeError(`bad number in database: ${String(v)}`);
      return num;
    }
    case "bool":
      return Boolean(v);
    case "time":
      return v instanceof Date ? v : new Date(String(v));
    default:
      return String(v);
  }
}

function toDb(type: Col, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (type === "time") return (v as Date).toISOString();
  // Postgres text can't hold a NUL; the hub strips them, this is the backstop.
  if (type === "text") return String(v).replaceAll("\u0000", "");
  return v;
}

// Rows per read at startup, well under Neon's HTTP response limit.
const PAGE = 2000;

// Reads every table into the engine, and marks it all as saved.
export async function load(sql: Sql, engine: Engine): Promise<void> {
  for (const name of TABLE_NAMES) {
    const spec = SPECS[name];
    const rows: Record<string, unknown>[] = [];
    for (let after = ""; ; ) {
      const page = await sql.query(`SELECT * FROM ${q(spec.sql)} WHERE ${q(spec.key)} COLLATE "C" > $1 ORDER BY ${q(spec.key)} COLLATE "C" LIMIT ${PAGE}`, [after]);
      rows.push(...page);
      if (page.length < PAGE) break;
      after = String(page.at(-1)![spec.key]);
    }
    const table = engine.table(name);
    table.clear();
    for (const r of rows) {
      const key = String(r[spec.key]);
      if (spec.value) {
        table.set(key, fromDb(spec.cols[spec.value]!, r[spec.value]));
        continue;
      }
      const row: Record<string, unknown> = { [spec.key]: key };
      for (const [col, type] of Object.entries(spec.cols)) {
        const v = fromDb(type, r[col]);
        if (v !== undefined) row[col] = v;
      }
      table.set(key, row);
    }
  }
  engine.markSaved();
}

export function statementsFor(changes: Change[]): Statement[] {
  // Removals first: a renamed row (forget_person) frees its old key before
  // the new one is written.
  const ordered = [...changes.filter((c) => c.row === undefined), ...changes.filter((c) => c.row !== undefined)];
  return ordered.map((c) => {
    const spec = SPECS[c.table];
    if (c.row === undefined) return { text: `DELETE FROM ${q(spec.sql)} WHERE ${q(spec.key)} = $1`, params: [c.key] };
    const row = spec.value ? { [spec.value]: c.row } : (c.row as Record<string, unknown>);
    const cols = Object.keys(spec.cols);
    const names = [spec.key, ...cols].map(q).join(", ");
    const slots = [spec.key, ...cols].map((_, i) => `$${i + 1}`).join(", ");
    const updates = cols.map((col) => `${q(col)} = EXCLUDED.${q(col)}`).join(", ");
    return {
      text: `INSERT INTO ${q(spec.sql)} (${names}) VALUES (${slots}) ON CONFLICT (${q(spec.key)}) DO UPDATE SET ${updates}`,
      params: [c.key, ...cols.map((col) => toDb(spec.cols[col]!, row[col]))],
    };
  });
}

// Errors worth retrying: no answer from Postgres at all (network, timeout,
// Neon waking up), or a connection or capacity problem. Anything else is
// Postgres refusing this change, and trying again won't help.
function transient(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code === "") return true;
  return /^(08|53|57P0[1-3]|40001|40P01)/.test(code);
}

// The engine's `persist`: one transaction per operation. A transient failure
// gets two more tries; if those fail too, it throws SaveError (the change may
// or may not have landed, so the backend restarts and reloads). A refusal
// throws as is: the transaction rolled back, nothing landed.
export function persistTo(
  sql: Sql,
  opts: { owner?: string; log?: (event: string, fields?: Record<string, unknown>) => void; retryDelayMs?: number } = {},
) {
  const delay = opts.retryDelayMs ?? 1000;
  return async (changes: Change[]) => {
    const statements = statementsFor(changes);
    if (opts.owner) statements.unshift(leaseCheck(opts.owner));
    for (let attempt = 1; ; attempt++) {
      try {
        await sql.transaction(statements);
        return;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code === "22012" && opts.owner) throw new LeaseLost(err);
        if (!transient(err)) throw new Error(`the database refused the change: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        if (attempt >= 3) throw new SaveError(err);
        opts.log?.("db_retry", { attempt, error: String(err).slice(0, 200) });
        await new Promise((r) => setTimeout(r, attempt * delay));
      }
    }
  };
}
