// Tab's data, held by the backend (SPEC §5): the rows, the rules the
// SpacetimeDB module enforced (a port of spacetime/src/index.ts, check for
// check), and the Store reads. Postgres keeps it (postgres.ts); tests run it
// in memory.
//
// Every write is one operation, run one at a time, like a reducer: if its
// rules throw, or saving it fails, every row it touched goes back to what it
// was, so a half-done change never shows and never gets saved.
import type { Timestamp } from "spacetimedb";
import { computeSplit } from "../../../spacetime/src/split-math.js";
import type { ReducerClient } from "../db/reducers.js";
import type { SettleMode } from "../db/types.js";
import type { Claim, Expense, Group, LineItem, Member, Message, Outbox, Person, Share, Store, Transfer } from "./types.js";

type Args<K extends keyof ReducerClient> = Parameters<ReducerClient[K]>[0];

// Rows as stored: the Store's fields plus the few only the database uses.
export type MemberRow = Member & { ledger_member_id?: string };
export type OutboxRow = Outbox & { sent_at?: Date; error?: string };
export type TransferRow = Transfer & { error?: string };
// A simulated transfer waiting to complete (the module's transfer_completion_schedule).
export type ScheduledRow = { transfer_id: string; run_at: Date };

// What the bridge sends for each message it reads (the module's ingest_message).
export type IngestInput = {
  message_id: string;
  group_id?: string;
  group_ledger_id?: string;
  group_display_name?: string;
  group_timezone: string;
  sender_phone: string;
  sender_ledger_member_id?: string;
  is_dm: boolean;
  kind: string;
  text?: string;
  image_url?: string;
  reply_to_id?: string;
  reaction?: string;
  received_at: Date;
};

export type MarkOutboxInput = {
  action_id: string;
  status: string;
  sent_photon_id?: string;
  error?: string;
};

// The tables, by the name postgres.ts saves them under.
export const TABLES = [
  "msgs",
  "grps",
  "mems",
  "out",
  "exps",
  "shrs",
  "trs",
  "items",
  "clms",
  "schedule",
  "settings",
  "ppl",
  "ledgerSecrets",
] as const;
export type TableName = (typeof TABLES)[number];

// One row added, changed (row set) or removed (row undefined) by an operation.
export type Change = { table: TableName; key: string; row?: unknown };

export type EngineOptions = {
  now: () => Date;
  // Saves an operation's changes, all or nothing. Without it nothing is kept.
  persist?: (changes: Change[]) => Promise<void>;
  // Completes simulated transfers on a timer (production). Tests call
  // completeDueTransfers themselves.
  autoComplete?: boolean;
  // The module's demo mode: simulated transfers complete in 0.75s, not 2s.
  demo?: boolean;
  // Called after the bridge hands over a message.
  onIngest?: () => void;
  // Saving failed in a way that leaves it unknown whether the change landed
  // (SaveError). Production restarts, so memory reloads from the database.
  onSaveFailed?: (err: SaveError) => void;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

const n = (v: bigint) => Number(v);
const d = (t: Timestamp) => t.toDate();
const od = (t: Timestamp | undefined) => (t ? t.toDate() : undefined);
const LOCKED = ["finalized", "settled", "void"];

function requireValue(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}: ${value}`);
}

// A table that notes which keys an operation touched: set, delete, or a
// change to a row's fields (rows are wrapped so assignments are seen). Saving
// then only looks at those, however big the table gets.
export class Table<V> extends Map<string, V> {
  readonly touched = new Set<string>();

  override set(key: string, value: V): this {
    this.touched?.add(key);
    return super.set(key, this.wrap(key, value));
  }

  override delete(key: string): boolean {
    this.touched.add(key);
    return super.delete(key);
  }

  override clear(): void {
    for (const key of this.keys()) this.touched.add(key);
    super.clear();
  }

  // Puts a saved row back without counting it as a change.
  restore(key: string, value: V | undefined): void {
    if (value === undefined) super.delete(key);
    else super.set(key, this.wrap(key, value));
  }

  private wrap(key: string, value: V): V {
    if (typeof value !== "object" || value === null) return value;
    const touched = this.touched;
    return new Proxy(value, {
      set(target, prop, v) {
        touched.add(key);
        return Reflect.set(target, prop, v);
      },
      deleteProperty(target, prop) {
        touched.add(key);
        return Reflect.deleteProperty(target, prop);
      },
    });
  }
}

// A row as saved: its JSON to compare against, and a copy to go back to.
// Rows hold only strings, numbers, booleans and Dates, and Dates are never
// changed in place, so a shallow copy is a full one.
type Saved = { json: string; row: unknown };
const copy = (v: unknown) => (typeof v === "object" && v !== null ? { ...v } : v);

// The database couldn't be reached, as opposed to a rule saying no: worth
// trying again later.
export class SaveError extends Error {
  constructor(cause: unknown) {
    super(`saving failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export class Engine implements Store {
  msgs = new Table<Message>();
  grps = new Table<Group>();
  mems = new Table<MemberRow>();
  out = new Table<OutboxRow>();
  exps = new Table<Expense>();
  shrs = new Table<Share>();
  trs = new Table<TransferRow>();
  items = new Table<LineItem>();
  clms = new Table<Claim>();
  schedule = new Table<ScheduledRow>();
  // group_id → settle mode, for groups that chose one (no entry means ledger).
  settings = new Table<SettleMode>();
  // phone → STOP and payment handles (§19).
  ppl = new Table<Person>();
  // group_id → the web ledger's secret.
  ledgerSecrets = new Table<string>();

  protected readonly now: () => Date;
  private readonly opts: EngineOptions;
  // Each row as last saved, to tell what an operation really changed.
  private saved = new Map<TableName, Map<string, Saved>>(TABLES.map((t) => [t, new Map()]));
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.now = opts.now;
  }

  // ── Saving ─────────────────────────────────────────────────────────────

  table(name: TableName): Table<unknown> {
    return this[name] as Table<unknown>;
  }

  // Loaded rows count as saved.
  markSaved(): void {
    for (const name of TABLES) {
      const snap = new Map<string, Saved>();
      for (const [key, row] of this.table(name)) snap.set(key, { json: JSON.stringify(row), row: copy(row) });
      this.saved.set(name, snap);
      this.table(name).touched.clear();
    }
  }

  // Rows changed outside an operation (tests do) count as saved: an
  // operation that fails goes back to them, not past them.
  protected acceptTouched(): void {
    this.commit(this.changes());
  }

  protected beforeOp(): void {}

  private changes(): (Change & { json?: string })[] {
    const out: (Change & { json?: string })[] = [];
    for (const name of TABLES) {
      const rows = this.table(name);
      const snap = this.saved.get(name)!;
      for (const key of rows.touched) {
        const row = rows.get(key);
        if (row === undefined) {
          if (snap.has(key)) out.push({ table: name, key });
          continue;
        }
        const json = JSON.stringify(row);
        if (snap.get(key)?.json !== json) out.push({ table: name, key, row: copy(row), json });
      }
    }
    // Only once every table is read: if anything above threw, revert still
    // sees everything that was touched.
    for (const name of TABLES) this.table(name).touched.clear();
    return out;
  }

  // Puts every row the operation touched back as it was saved.
  private revert(): void {
    for (const name of TABLES) {
      const rows = this.table(name);
      const snap = this.saved.get(name)!;
      for (const key of rows.touched) rows.restore(key, copy(snap.get(key)?.row));
      rows.touched.clear();
    }
  }

  private undo(changes: Change[]): void {
    for (const c of changes) this.table(c.table).restore(c.key, copy(this.saved.get(c.table)!.get(c.key)?.row));
  }

  private commit(changes: (Change & { json?: string })[]): void {
    for (const c of changes) {
      const snap = this.saved.get(c.table)!;
      if (c.row === undefined) snap.delete(c.key);
      else snap.set(c.key, { json: c.json!, row: copy(c.row) });
    }
  }

  // Runs one operation after the ones before it finish. `fn` sees one clock
  // reading, like a reducer's ctx.timestamp.
  protected op<T>(fn: (now: Date) => T): Promise<T> {
    const run = async () => {
      this.beforeOp();
      let result: T;
      let changes: (Change & { json?: string })[];
      try {
        result = fn(this.now());
        changes = this.changes();
      } catch (err) {
        this.revert();
        throw err;
      }
      if (changes.length && this.opts.persist) {
        try {
          await this.opts.persist(changes.map(({ table, key, row }) => ({ table, key, row })));
        } catch (err) {
          this.undo(changes);
          if (err instanceof SaveError) this.opts.onSaveFailed?.(err);
          throw err;
        }
      }
      this.commit(changes);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  // Reads after every operation started so far, without being one.
  private afterOps<T>(read: () => T): Promise<T> {
    return this.queue.then(read);
  }

  // Resolves once every operation started so far has finished.
  settled(): Promise<void> {
    return this.queue.then(() => {});
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  // ── Store ──────────────────────────────────────────────────────────────
  // Fresh copies on every read, like the SpacetimeDB store, so callers can't
  // change rows behind an operation's back.

  messages = () => [...this.msgs.values()].map((x) => ({ ...x }));
  group = (id: string) => {
    const g = this.grps.get(id);
    return g && { ...g };
  };
  groups = () => [...this.grps.values()].map((x) => ({ ...x }));
  settleMode = (id: string): SettleMode => this.settings.get(id) ?? "ledger";
  members = (id: string) => [...this.mems.values()].filter((m) => m.group_id === id).map((m) => ({ ...m }));
  outbox = () => [...this.out.values()].map((x) => ({ ...x }));
  expense = (id: string) => {
    const e = this.exps.get(id);
    return e && { ...e };
  };
  expenses = () => [...this.exps.values()].map((x) => ({ ...x }));
  shares = (id: string) => [...this.shrs.values()].filter((s) => s.expense_id === id).map((x) => ({ ...x }));
  transfers = () => [...this.trs.values()].map((x) => ({ ...x }));
  person = (phone: string) => {
    const p = this.ppl.get(phone);
    return p && { ...p };
  };
  lineItems = (id: string) =>
    [...this.items.values()]
      .filter((i) => i.expense_id === id)
      .sort((a, b) => a.position - b.position)
      .map((x) => ({ ...x }));
  claims = (id: string) => [...this.clms.values()].filter((c) => c.expense_id === id).map((x) => ({ ...x }));

  // ── The bridge's side (ingest_message, mark_outbox, client_outbox) ─────

  ingestMessage(input: IngestInput): Promise<void> {
    return this.op((now) => {
      requireValue(input.kind, ["text", "image", "reaction", "system"], "message kind");
      const existing = this.msgs.get(input.message_id);
      this.msgs.set(input.message_id, {
        message_id: input.message_id,
        group_id: input.group_id,
        sender_phone: input.sender_phone,
        is_dm: input.is_dm,
        kind: input.kind as Message["kind"],
        text: input.text,
        image_url: input.image_url,
        reply_to_id: input.reply_to_id,
        reaction: input.reaction as Message["reaction"],
        received_at: input.received_at,
        intent: existing?.intent,
        confidence: existing?.confidence,
        status: existing?.status ?? "new",
        error: existing?.error,
      });
      if (input.group_id) {
        const group = this.grps.get(input.group_id);
        if (!group) {
          if (!input.group_ledger_id) throw new Error("A new group requires group_ledger_id");
          if ([...this.grps.values()].some((g) => g.ledger_id === input.group_ledger_id)) throw new Error("Ledger id already in use");
          this.grps.set(input.group_id, {
            group_id: input.group_id,
            ledger_id: input.group_ledger_id,
            display_name: input.group_display_name,
            timezone: input.group_timezone,
            onboarding_status: "pending",
            created_at: now,
          });
        } else if (input.group_display_name && input.group_display_name !== group.display_name) {
          // Groups renamed since pick up the current name.
          group.display_name = input.group_display_name;
        }
        const memberId = `${input.group_id}:${input.sender_phone}`;
        if (!this.mems.has(memberId)) {
          if (!input.sender_ledger_member_id) throw new Error("A new member requires sender_ledger_member_id");
          if ([...this.mems.values()].some((m) => m.ledger_member_id === input.sender_ledger_member_id)) throw new Error("Ledger member id already in use");
          this.mems.set(memberId, {
            member_id: memberId,
            ledger_member_id: input.sender_ledger_member_id,
            group_id: input.group_id,
            phone: input.sender_phone,
            joined_at: now,
          });
        }
      }
    }).then(() => this.opts.onIngest?.());
  }

  markOutbox(input: MarkOutboxInput): Promise<void> {
    return this.op((now) => {
      requireValue(input.status, ["queued", "sending", "sent", "cancelled", "failed"], "outbox status");
      const row = this.out.get(input.action_id);
      if (!row) throw new Error("Unknown outbox action");
      row.status = input.status as OutboxRow["status"];
      row.sent_photon_id = input.sent_photon_id;
      row.error = input.error;
      if (input.status === "sent") row.sent_at = now;
    });
  }

  // What the bridge may send: queued rows, and ones it was sending when it stopped.
  clientOutbox(): Promise<OutboxRow[]> {
    return this.afterOps(() =>
      [...this.out.values()].filter((o) => o.status === "queued" || o.status === "sending").map((o) => ({ ...o })),
    );
  }

  // ── Simulated transfers (PAYMENTS=simulated) ───────────────────────────

  // The module's complete_simulated_transfer, once per due job. Each job is
  // its own operation, as each scheduled reducer was: one that fails is
  // logged and dropped, and the others still run.
  async completeDueTransfers(all = false): Promise<void> {
    try {
      const due = await this.afterOps(() =>
        [...this.schedule.values()].filter((j) => all || j.run_at <= this.now()).map((j) => j.transfer_id),
      );
      for (const id of due) {
        try {
          await this.op((now) => this.completeTransfer(id, now));
        } catch (err) {
          if (err instanceof SaveError) throw err;
          this.opts.log?.("transfer_completion_failed", { transfer_id: id, error: String(err) });
          await this.op(() => void this.schedule.delete(id)).catch(() => {});
        }
      }
    } finally {
      this.armTimer();
    }
  }

  private completeTransfer(id: string, now: Date): void {
    if (!this.schedule.has(id)) return;
    this.schedule.delete(id);
    const t = this.trs.get(id);
    if (!t || t.status !== "pending") return;
    const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`);
    if (!share || share.status !== "approved") throw new Error("Approved share is missing");
    t.status = "done";
    t.completed_at = now;
    t.error = undefined;
    share.status = "paid";
    const allPaid = this.rawShares(t.expense_id)
      .filter((s) => s.role === "participant" && s.status !== "opted_out")
      .every((s) => s.status === "paid");
    const e = this.exps.get(t.expense_id);
    if (allPaid && e) e.status = "settled";
  }

  private armTimer(): void {
    if (!this.opts.autoComplete) return;
    clearTimeout(this.timer);
    const next = Math.min(...[...this.schedule.values()].map((j) => j.run_at.getTime()));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => void this.completeDueTransfers().catch(() => {}), Math.max(0, next - this.now().getTime()));
  }

  // ── The module's reducers ──────────────────────────────────────────────

  protected rawShares = (id: string) => [...this.shrs.values()].filter((s) => s.expense_id === id);

  private settleIfAllPaid(expense_id: string) {
    const allPaid = this.rawShares(expense_id)
      .filter((s) => s.role === "participant" && s.status !== "opted_out")
      .every((s) => s.status === "paid");
    const e = this.exps.get(expense_id);
    if (allPaid && e?.status === "finalized") e.status = "settled";
  }

  private recompute(expense_id: string) {
    const e = this.exps.get(expense_id);
    if (!e) throw new Error("Unknown expense");
    if (LOCKED.includes(e.status)) throw new Error("Expense amounts are locked");
    const shares = this.rawShares(expense_id);
    if (shares.length === 0) return;
    const items = [...this.items.values()].filter((i) => i.expense_id === expense_id);
    if (e.split_mode === "itemized" && items.length === 0) return;
    const result = computeSplit({
      mode: e.split_mode,
      participants: shares.map((s) => ({
        phone: s.phone,
        fixedCents: s.fixed_cents === undefined ? undefined : BigInt(s.fixed_cents),
        optedOut: s.status === "opted_out",
      })),
      subtotalCents: BigInt(e.subtotal_cents ?? e.total_cents),
      taxCents: BigInt(e.tax_cents),
      tipCents: BigInt(e.tip_cents),
      feesCents: BigInt(e.fees_cents),
      discountCents: BigInt(e.discount_cents),
      items: items.map((i) => ({
        amountCents: BigInt(i.amount_cents),
        claimers: [...this.clms.values()].filter((c) => c.item_id === i.item_id).map((c) => c.phone),
      })),
    });
    const sum = [...result.values()].reduce((a, b) => a + b, 0n);
    if (sum !== BigInt(e.total_cents)) throw new Error("Computed shares do not match expense total");
    for (const s of shares) s.amount_cents = n(result.get(s.phone) ?? 0n);
  }

  private upsertPerson(phone: string, change: { opted_out?: boolean; venmo?: string; cashtag?: string; clear_handles?: boolean }) {
    const existing = this.ppl.get(phone);
    this.ppl.set(phone, {
      phone,
      opted_out: change.opted_out ?? existing?.opted_out ?? false,
      venmo: change.clear_handles ? undefined : (change.venmo ?? existing?.venmo),
      cashtag: change.clear_handles ? undefined : (change.cashtag ?? existing?.cashtag),
    });
  }

  // The backend's write path: createReducers(engine.client) checks and
  // converts arguments exactly as it does for SpacetimeDB.
  readonly client: ReducerClient = {
    setMessageResult: (a: Args<"setMessageResult">) =>
      this.op(() => {
        requireValue(a.status, ["new", "processing", "done", "error"], "message status");
        const m = this.msgs.get(a.messageId);
        if (!m) throw new Error("Unknown message");
        // Ignored chat text isn't needed after classification: the row stays, its words go.
        if (a.intent === "ignore") m.text = undefined;
        Object.assign(m, { intent: a.intent, confidence: a.confidence, status: a.status, error: a.error });
      }),

    setMemberName: (a: Args<"setMemberName">) =>
      this.op(() => {
        const m = this.mems.get(a.memberId);
        if (!m) throw new Error("Unknown member");
        m.name = a.name.trim();
      }),

    setGroupStatus: (a: Args<"setGroupStatus">) =>
      this.op(() => {
        requireValue(a.status, ["pending", "active"], "group status");
        const g = this.grps.get(a.groupId);
        if (!g) throw new Error("Unknown group");
        g.onboarding_status = a.status as Group["onboarding_status"];
      }),

    upsertExpense: (a: Args<"upsertExpense">) =>
      this.op((now) => {
        requireValue(a.splitMode, ["even", "custom", "itemized"], "split mode");
        requireValue(a.status, ["needs_info", "proposed", "itemizing", "finalized", "settled", "void"], "expense status");
        // $0 is fine while details are missing, and when such an expense is dropped.
        if (a.totalCents < 0n || (a.totalCents === 0n && a.status !== "needs_info" && a.status !== "void")) {
          throw new Error("Expense total must be positive unless more information is needed");
        }
        const bySource = [...this.exps.values()].find((e) => e.source_message_id === a.sourceMessageId);
        if (bySource && bySource.expense_id !== a.expenseId) throw new Error("Source message already has an expense");
        const existing = this.exps.get(a.expenseId);
        this.exps.set(a.expenseId, {
          expense_id: a.expenseId,
          group_id: a.groupId,
          payer_phone: a.payerPhone,
          description: a.description,
          source_message_id: a.sourceMessageId,
          split_mode: a.splitMode as Expense["split_mode"],
          status: a.status as Expense["status"],
          subtotal_cents: a.subtotalCents === undefined ? undefined : n(a.subtotalCents),
          tax_cents: n(a.taxCents),
          tip_cents: n(a.tipCents),
          fees_cents: n(a.feesCents),
          discount_cents: n(a.discountCents),
          total_cents: n(a.totalCents),
          objection_deadline: od(a.objectionDeadline),
          claim_deadline: od(a.claimDeadline),
          proposal_message_id: a.proposalMessageId,
          settle_message_id: a.settleMessageId,
          created_at: existing?.created_at ?? now,
          finalized_at: od(a.finalizedAt),
        });
        if (!LOCKED.includes(a.status) && this.rawShares(a.expenseId).length > 0) this.recompute(a.expenseId);
      }),

    setLineItems: (a: Args<"setLineItems">) =>
      this.op(() => {
        if (!this.exps.has(a.expenseId)) throw new Error("Unknown expense");
        for (const [k, c] of [...this.clms]) if (c.expense_id === a.expenseId) this.clms.delete(k);
        for (const [k, i] of [...this.items]) if (i.expense_id === a.expenseId) this.items.delete(k);
        for (const i of a.items) {
          if (i.amountCents < 0n || i.quantity === 0) throw new Error("Invalid line item");
          if (this.items.has(i.itemId)) throw new Error("Line item already exists");
          this.items.set(i.itemId, {
            item_id: i.itemId,
            expense_id: a.expenseId,
            position: i.position,
            description: i.description,
            quantity: i.quantity,
            amount_cents: n(i.amountCents),
          });
        }
        this.recompute(a.expenseId);
      }),

    addClaim: (a: Args<"addClaim">) =>
      this.op((now) => {
        const item = this.items.get(a.itemId);
        if (!item) throw new Error("Unknown line item");
        const id = `${a.itemId}:${a.phone}`;
        if (!this.clms.has(id)) {
          this.clms.set(id, {
            claim_id: id,
            item_id: a.itemId,
            expense_id: item.expense_id,
            phone: a.phone,
            source_message_id: a.sourceMessageId,
            created_at: now,
          });
        }
        this.recompute(item.expense_id);
      }),

    removeClaim: (a: Args<"removeClaim">) =>
      this.op(() => {
        const item = this.items.get(a.itemId);
        if (!item) throw new Error("Unknown line item");
        this.clms.delete(`${a.itemId}:${a.phone}`);
        this.recompute(item.expense_id);
      }),

    setShare: (a: Args<"setShare">) =>
      this.op(() => {
        requireValue(a.role, ["payer", "participant"], "share role");
        requireValue(a.status, ["proposed", "awaiting_claim", "locked", "approved", "paid", "disputed", "opted_out"], "share status");
        const id = `${a.expenseId}:${a.phone}`;
        const existing = this.shrs.get(id);
        this.shrs.set(id, {
          share_id: id,
          expense_id: a.expenseId,
          phone: a.phone,
          role: a.role as Share["role"],
          status: a.status as Share["status"],
          fixed_cents: a.fixedCents === undefined ? undefined : n(a.fixedCents),
          amount_cents: existing?.amount_cents ?? 0,
          responded: a.responded,
          followup_count: a.followupCount,
          last_followup_at: od(a.lastFollowupAt),
        });
        // A dispute changes state, not the locked amount.
        if (a.status !== "disputed") this.recompute(a.expenseId);
      }),

    recomputeExpense: (a: Args<"recomputeExpense">) => this.op(() => this.recompute(a.expenseId)),

    enqueueOutbox: (a: Args<"enqueueOutbox">) =>
      this.op((now) => {
        if (this.out.has(a.actionId)) return;
        // Someone who texted STOP gets no more DMs (§19), except the one that
        // confirms it. The row stays, cancelled and without its text, so the
        // backend sees it was handled and never asks again.
        const skipped = a.kind === "dm" && !!a.toPhone && a.purpose !== "opt_out" && this.ppl.get(a.toPhone)?.opted_out === true;
        this.out.set(a.actionId, {
          action_id: a.actionId,
          kind: a.kind as Outbox["kind"],
          group_id: a.groupId,
          to_phone: a.toPhone,
          target_message_id: a.targetMessageId,
          text: skipped ? undefined : a.text,
          reaction: a.reaction as Outbox["reaction"],
          expense_id: a.expenseId,
          purpose: a.purpose as Outbox["purpose"],
          send_after: d(a.sendAfter),
          status: skipped ? "cancelled" : "queued",
          created_at: now,
          error: skipped ? "opted_out" : undefined,
        });
      }),

    cancelOutbox: (a: Args<"cancelOutbox">) =>
      this.op(() => {
        for (const o of this.out.values()) {
          if (o.expense_id === a.expenseId && o.status === "queued" && (!a.toPhone || o.to_phone === a.toPhone)) o.status = "cancelled";
        }
      }),

    // Deduped on (approval, expense): one 👍 pays several shares, and a repeat pays nothing.
    createTransfer: (a: Args<"createTransfer">) =>
      this.op((now) => {
        if ([...this.trs.values()].some((t) => t.approved_by_message_id === a.approvedByMessageId && t.expense_id === a.expenseId)) return;
        const e = this.exps.get(a.expenseId);
        if (!e?.payer_phone) throw new Error("Expense has no payer");
        if (e.status !== "finalized") throw new Error("Expense is not ready for settlement");
        if (a.fromPhone === e.payer_phone) throw new Error("Payer does not transfer to themselves");
        const approval = this.msgs.get(a.approvedByMessageId);
        if (!approval || approval.sender_phone !== a.fromPhone) throw new Error("Approval does not belong to debtor");
        const share = this.shrs.get(`${a.expenseId}:${a.fromPhone}`);
        if (!share || share.role !== "participant" || share.status !== "locked") throw new Error("Share is not payable");
        if (this.trs.has(a.transferId)) throw new Error("Transfer already exists");
        share.status = "approved";
        this.trs.set(a.transferId, {
          transfer_id: a.transferId,
          group_id: e.group_id,
          expense_id: a.expenseId,
          from_phone: a.fromPhone,
          to_phone: e.payer_phone,
          amount_cents: share.amount_cents,
          provider: "spacetime_simulated",
          status: "pending",
          approved_by_message_id: a.approvedByMessageId,
          created_at: now,
        });
        this.schedule.set(a.transferId, { transfer_id: a.transferId, run_at: new Date(now.getTime() + (this.opts.demo ? 750 : 2000)) });
      }).finally(() => this.armTimer()),

    // §7.6 payment links. From the person who owed, it waits on the payee
    // (reported); from the payee, it's confirmed already (done).
    recordPayment: (a: Args<"recordPayment">) =>
      this.op((now) => {
        requireValue(a.provider, ["venmo", "cashapp", "other"], "payment provider");
        // One message can cover several people: a repeat is the same message, expense, and person.
        if ([...this.trs.values()].some((t) => t.approved_by_message_id === a.messageId && t.expense_id === a.expenseId && t.from_phone === a.fromPhone)) return;
        const e = this.exps.get(a.expenseId);
        if (!e?.payer_phone) throw new Error("Expense has no payer");
        if (e.status !== "finalized") throw new Error("Expense is not ready for settlement");
        if (a.fromPhone === e.payer_phone) throw new Error("Payer does not pay themselves");
        const message = this.msgs.get(a.messageId);
        const byPayee = message?.sender_phone === e.payer_phone;
        if (!message || (message.sender_phone !== a.fromPhone && !byPayee)) throw new Error("Only the two people involved can report a payment");
        const share = this.shrs.get(`${a.expenseId}:${a.fromPhone}`);
        if (share?.status === "paid") return;
        // The payee's word also ends a dispute: they say it's paid.
        if (!share || share.role !== "participant" || !(share.status === "locked" || (byPayee && (share.status === "approved" || share.status === "disputed")))) {
          throw new Error("Share is not payable");
        }
        // The payee's word settles any earlier unconfirmed report of the same share.
        const earlier = [...this.trs.values()].find((t) => byPayee && t.expense_id === a.expenseId && t.from_phone === a.fromPhone && t.status === "reported");
        if (earlier) {
          earlier.status = "done";
          earlier.completed_at = now;
          share.status = "paid";
          this.settleIfAllPaid(a.expenseId);
          return;
        }
        if (this.trs.has(a.transferId)) throw new Error("Transfer already exists");
        share.status = byPayee ? "paid" : "approved";
        this.trs.set(a.transferId, {
          transfer_id: a.transferId,
          group_id: e.group_id,
          expense_id: a.expenseId,
          from_phone: a.fromPhone,
          to_phone: e.payer_phone,
          amount_cents: share.amount_cents,
          provider: a.provider,
          status: byPayee ? "done" : "reported",
          approved_by_message_id: a.messageId,
          created_at: now,
          completed_at: byPayee ? now : undefined,
        });
        if (byPayee) this.settleIfAllPaid(a.expenseId);
      }),

    confirmPayment: (a: Args<"confirmPayment">) =>
      this.op((now) => {
        const t = this.trs.get(a.transferId);
        if (!t) throw new Error("Unknown transfer");
        if (t.status === "done") return;
        if (t.status !== "reported") throw new Error("Transfer is not waiting on confirmation");
        if (this.msgs.get(a.messageId)?.sender_phone !== t.to_phone) throw new Error("Only the payee can confirm a payment");
        const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`);
        if (!share || share.status !== "approved") throw new Error("Reported share is missing");
        t.status = "done";
        t.completed_at = now;
        t.error = undefined;
        share.status = "paid";
        this.settleIfAllPaid(t.expense_id);
      }),

    rejectPayment: (a: Args<"rejectPayment">) =>
      this.op(() => {
        const t = this.trs.get(a.transferId);
        if (!t) throw new Error("Unknown transfer");
        if (t.status !== "reported") throw new Error("Transfer is not waiting on confirmation");
        if (this.msgs.get(a.messageId)?.sender_phone !== t.to_phone) throw new Error("Only the payee can say it never arrived");
        t.status = "failed";
        t.error = "payee did not see it";
        const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`);
        if (share?.status === "approved") share.status = "locked";
      }),

    setOptOut: (a: Args<"setOptOut">) => this.op(() => this.upsertPerson(a.phone, { opted_out: a.optedOut })),

    // Venmo usernames: 5 to 30 letters, numbers, hyphens, underscores. Cash App
    // $cashtags (stored without the $): up to 20, with at least one letter.
    setPaymentHandle: (a: Args<"setPaymentHandle">) =>
      this.op(() => {
        if (a.venmo !== undefined && !/^[A-Za-z0-9_-]{5,30}$/.test(a.venmo)) throw new Error("Invalid Venmo username");
        if (a.cashtag !== undefined && !/^(?=.*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(a.cashtag)) throw new Error("Invalid $cashtag");
        if (a.venmo === undefined && a.cashtag === undefined) throw new Error("No handle given");
        this.upsertPerson(a.phone, { venmo: a.venmo, cashtag: a.cashtag });
      }),

    // §19 "delete my data", confirmed by the person. Their words, photos, name
    // and handles go, and their number becomes a placeholder everywhere (rows,
    // and ids that carried it), so amounts still add up but no longer point to
    // them. Tab's messages that quoted their number or handle lose their text.
    // Only the opt-out stays, so Tab never texts them again unless they START.
    forgetPerson: (a: Args<"forgetPerson">) =>
      this.op((now) => {
        const phone = a.phone;
        const gone = `forgotten:${now.getTime() * 1000}`;
        const swap = (x: string) => x.split(phone).join(gone);
        const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const p = this.ppl.get(phone);
        // Their handle only where it is one (a link, @name, $name), never a bare substring.
        const handle = [
          p?.venmo ? `(?:venmo\\.com/|@)${escape(p.venmo)}(?![A-Za-z0-9_-])` : "",
          p?.cashtag ? `(?:cash\\.app/)?\\$${escape(p.cashtag)}(?![A-Za-z0-9_])` : "",
        ]
          .filter(Boolean)
          .join("|");
        const handleRe = handle ? new RegExp(handle, "i") : undefined;
        const mentions = (text?: string) => text !== undefined && (text.includes(phone) || (handleRe?.test(text) ?? false));

        for (const [id, m] of [...this.msgs]) {
          const theirs = m.sender_phone === phone;
          if (!theirs && !id.includes(phone)) continue;
          this.msgs.delete(id);
          this.msgs.set(swap(id), {
            ...m,
            message_id: swap(id),
            sender_phone: theirs ? gone : m.sender_phone,
            text: theirs ? undefined : m.text,
            image_url: theirs ? undefined : m.image_url,
          });
        }
        // Tab's messages to them, about them (ids like payment_link:<x>:<phone>),
        // or quoting their number or handle: the text goes, and any still
        // waiting are cancelled.
        for (const [id, o] of [...this.out]) {
          const about = o.to_phone === phone || id.includes(phone) || mentions(o.text);
          const error = o.error?.includes(phone) ? undefined : o.error;
          if (!about && error === o.error) continue;
          const pending = o.status === "queued" || o.status === "sending";
          this.out.delete(id);
          this.out.set(swap(id), {
            ...o,
            action_id: swap(id),
            to_phone: o.to_phone === phone ? gone : o.to_phone,
            text: about ? undefined : o.text,
            error,
            status: about && pending ? "cancelled" : o.status,
          });
        }
        for (const [id, m] of [...this.mems]) {
          if (m.phone !== phone) continue;
          this.mems.delete(id);
          this.mems.set(`${m.group_id}:${gone}`, {
            ...m,
            member_id: `${m.group_id}:${gone}`,
            phone: gone,
            name: undefined,
            left_at: m.left_at ?? now,
          });
        }
        for (const [id, s] of [...this.shrs]) {
          if (s.phone !== phone) continue;
          this.shrs.delete(id);
          this.shrs.set(`${s.expense_id}:${gone}`, { ...s, share_id: `${s.expense_id}:${gone}`, phone: gone });
        }
        for (const [id, c] of [...this.clms]) {
          if (c.phone !== phone) continue;
          this.clms.delete(id);
          this.clms.set(`${c.item_id}:${gone}`, { ...c, claim_id: `${c.item_id}:${gone}`, phone: gone });
        }
        for (const e of this.exps.values()) if (e.payer_phone === phone) e.payer_phone = gone;
        for (const [id, t] of [...this.trs]) {
          if (t.from_phone !== phone && t.to_phone !== phone && !id.includes(phone)) continue;
          this.trs.delete(id);
          this.trs.set(swap(id), {
            ...t,
            transfer_id: swap(id),
            from_phone: t.from_phone === phone ? gone : t.from_phone,
            to_phone: t.to_phone === phone ? gone : t.to_phone,
          });
          const job = this.schedule.get(id);
          if (job && swap(id) !== id) {
            this.schedule.delete(id);
            this.schedule.set(swap(id), { ...job, transfer_id: swap(id) });
          }
        }
        this.upsertPerson(phone, { opted_out: true, clear_handles: true });
      }),

    setSettleMode: (a: Args<"setSettleMode">) =>
      this.op(() => {
        requireValue(a.settleMode, ["ledger", "per_expense"], "settle mode");
        if (!this.grps.has(a.groupId)) throw new Error("Unknown group");
        this.settings.set(a.groupId, a.settleMode as SettleMode);
      }),

    // §7.6 disputes: only the disputing person's amount changes, and the
    // payer's share absorbs the difference so the total is unchanged.
    resolveDispute: (a: Args<"resolveDispute">) =>
      this.op(() => {
        if (a.amountCents < 0n) throw new Error("Amount must not be negative");
        const e = this.exps.get(a.expenseId);
        if (!e) throw new Error("Unknown expense");
        if (e.status !== "finalized") throw new Error("Only finalized expenses have disputes to resolve");
        if (!e.payer_phone) throw new Error("Expense has no payer");
        const share = this.shrs.get(`${a.expenseId}:${a.phone}`);
        if (!share || share.role !== "participant" || share.status !== "disputed") throw new Error("Share is not disputed");
        const payer = this.shrs.get(`${a.expenseId}:${e.payer_phone}`);
        if (!payer) throw new Error("Payer share is missing");
        const amount = n(a.amountCents);
        const payerAmount = payer.amount_cents - (amount - share.amount_cents);
        if (payerAmount < 0) throw new Error("Amount exceeds what the payer's share can absorb");
        share.amount_cents = amount;
        share.status = "locked";
        payer.amount_cents = payerAmount;
        const sum = this.rawShares(a.expenseId).reduce((t, s) => t + s.amount_cents, 0);
        if (sum !== e.total_cents) throw new Error("Shares do not match expense total");
      }),

    setLedgerSecret: (a: Args<"setLedgerSecret">) =>
      this.op(() => {
        if (!this.grps.has(a.groupId)) throw new Error("Unknown group");
        if (a.secret.length < 24) throw new Error("Ledger secret must contain at least 24 characters");
        for (const [group, secret] of this.ledgerSecrets) if (group !== a.groupId && secret === a.secret) throw new Error("Ledger secret already in use");
        this.ledgerSecrets.set(a.groupId, a.secret);
      }),
  } as unknown as ReducerClient;
}
