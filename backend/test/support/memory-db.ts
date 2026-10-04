// An in-memory stand-in for Kian's module: the Store reads plus the reducers
// the backend calls, with the same validation and Kian's real split math, so
// a handler that would fail against SpacetimeDB fails here too.
import { Timestamp } from "spacetimedb";
import { computeSplit } from "../../../spacetime/src/split-math.js";
import { createReducers, type ReducerClient } from "../../src/db/reducers.js";
import type { SettleMode } from "../../src/db/types.js";
import type {
  Claim,
  Expense,
  Group,
  LineItem,
  Member,
  Message,
  Outbox,
  Share,
  Store,
  Transfer,
} from "../../src/store/types.js";

type Args<K extends keyof ReducerClient> = Parameters<ReducerClient[K]>[0];

const n = (v: bigint) => Number(v);
const d = (t: Timestamp) => t.toDate();
const od = (t: Timestamp | undefined) => (t ? t.toDate() : undefined);

export class MemoryDb implements Store {
  msgs = new Map<string, Message>();
  grps = new Map<string, Group>();
  mems = new Map<string, Member>();
  out = new Map<string, Outbox>();
  exps = new Map<string, Expense>();
  shrs = new Map<string, Share>();
  trs = new Map<string, Transfer>();
  items = new Map<string, LineItem>();
  clms = new Map<string, Claim>();
  // group_id → secret (the module's private ledger_secrets table).
  ledgerSecrets = new Map<string, string>();
  // group_settings: groups that chose a settle mode (no row means ledger).
  settings = new Map<string, SettleMode>();
  constructor(private now: () => Date) {}

  // ── Store (backend_messages only shows new and processing rows) ────────
  // backend_messages returns full history (Kian's #16).
  messages = () => [...this.msgs.values()];
  group = (id: string) => this.grps.get(id);
  groups = () => [...this.grps.values()];
  settleMode = (id: string): SettleMode => this.settings.get(id) ?? "ledger";
  members = (id: string) =>
    [...this.mems.values()].filter((m) => m.group_id === id);
  outbox = () => [...this.out.values()];
  expense = (id: string) => this.exps.get(id);
  expenses = () => [...this.exps.values()];
  shares = (id: string) =>
    [...this.shrs.values()].filter((s) => s.expense_id === id);
  transfers = () => [...this.trs.values()];
  lineItems = (id: string) =>
    [...this.items.values()]
      .filter((i) => i.expense_id === id)
      .sort((a, b) => a.position - b.position);
  claims = (id: string) =>
    [...this.clms.values()].filter((c) => c.expense_id === id);

  // ── What the client does ───────────────────────────────────────────────
  addGroup(
    group_id: string,
    people: { phone: string; name?: string }[],
    status: Group["onboarding_status"] = "active",
  ) {
    this.grps.set(group_id, {
      group_id,
      ledger_id: `l-${group_id}`,
      timezone: "America/Detroit",
      onboarding_status: status,
      created_at: this.now(),
    });
    for (const p of people)
      this.mems.set(`${group_id}:${p.phone}`, {
        member_id: `${group_id}:${p.phone}`,
        group_id,
        phone: p.phone,
        name: p.name,
        joined_at: this.now(),
      });
  }

  private seq = 0;
  ingest(m: Partial<Message> & Pick<Message, "sender_phone">): Message {
    const row: Message = {
      message_id: `m${++this.seq}`,
      is_dm: !m.group_id,
      kind: "text",
      received_at: this.now(),
      status: "new",
      ...m,
    };
    this.msgs.set(row.message_id, row);
    return row;
  }

  // The client marks queued rows sent and writes back an iMessage id.
  deliver(): Outbox[] {
    const sent = [...this.out.values()].filter(
      (o) => o.status === "queued" && o.send_after <= this.now(),
    );
    for (const o of sent) {
      o.status = "sent";
      o.sent_photon_id = `imsg-${o.action_id}`;
    }
    return sent;
  }

  // What the scheduled reducer does once a transfer's delay passes.
  completeTransfers() {
    for (const t of this.trs.values()) {
      if (t.status !== "pending") continue;
      t.status = "done";
      t.completed_at = this.now();
      const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`)!;
      share.status = "paid";
      const live = this.shares(t.expense_id).filter(
        (s) => s.role === "participant" && s.status !== "opted_out",
      );
      if (live.every((s) => s.status === "paid"))
        this.exps.get(t.expense_id)!.status = "settled";
    }
  }

  // ── The module's reducers ──────────────────────────────────────────────
  private recompute(expense_id: string) {
    const e = this.exps.get(expense_id)!;
    if (["finalized", "settled", "void"].includes(e.status))
      throw new Error("Expense amounts are locked");
    const shares = this.shares(expense_id);
    if (shares.length === 0) return;
    const items = this.lineItems(expense_id);
    if (e.split_mode === "itemized" && items.length === 0) return;
    const result = computeSplit({
      mode: e.split_mode,
      participants: shares.map((s) => ({
        phone: s.phone,
        fixedCents:
          s.fixed_cents === undefined ? undefined : BigInt(s.fixed_cents),
        optedOut: s.status === "opted_out",
      })),
      subtotalCents: BigInt(e.subtotal_cents ?? e.total_cents),
      taxCents: BigInt(e.tax_cents),
      tipCents: BigInt(e.tip_cents),
      feesCents: BigInt(e.fees_cents),
      discountCents: BigInt(e.discount_cents),
      items: items.map((i) => ({
        amountCents: BigInt(i.amount_cents),
        claimers: [...this.clms.values()]
          .filter((c) => c.item_id === i.item_id)
          .map((c) => c.phone),
      })),
    });
    const sum = [...result.values()].reduce((a, b) => a + b, 0n);
    if (sum !== BigInt(e.total_cents))
      throw new Error("Computed shares do not match expense total");
    for (const s of shares) s.amount_cents = n(result.get(s.phone) ?? 0n);
  }

  private client = {
    setMessageResult: async (a: Args<"setMessageResult">) => {
      const m = this.msgs.get(a.messageId);
      if (!m) throw new Error("Unknown message");
      // Ignored chat text is discarded after classification (Kian\'s #16).
      if (a.intent === "ignore") m.text = undefined;
      Object.assign(m, {
        intent: a.intent,
        confidence: a.confidence,
        status: a.status,
        error: a.error,
      });
    },
    setMemberName: async (a: Args<"setMemberName">) => {
      const m = this.mems.get(a.memberId);
      if (!m) throw new Error("Unknown member");
      m.name = a.name.trim();
    },
    setGroupStatus: async (a: Args<"setGroupStatus">) => {
      const g = this.grps.get(a.groupId);
      if (!g) throw new Error("Unknown group");
      g.onboarding_status = a.status as Group["onboarding_status"];
    },
    upsertExpense: async (a: Args<"upsertExpense">) => {
      if (a.totalCents < 0n || (a.totalCents === 0n && a.status !== "needs_info")) {
        throw new Error("Expense total must be positive unless more information is needed");
      }
      const bySource = [...this.exps.values()].find(
        (e) => e.source_message_id === a.sourceMessageId,
      );
      if (bySource && bySource.expense_id !== a.expenseId)
        throw new Error("Source message already has an expense");
      const existing = this.exps.get(a.expenseId);
      this.exps.set(a.expenseId, {
        expense_id: a.expenseId,
        group_id: a.groupId,
        payer_phone: a.payerPhone,
        description: a.description,
        source_message_id: a.sourceMessageId,
        split_mode: a.splitMode as Expense["split_mode"],
        status: a.status as Expense["status"],
        subtotal_cents:
          a.subtotalCents === undefined ? undefined : n(a.subtotalCents),
        tax_cents: n(a.taxCents),
        tip_cents: n(a.tipCents),
        fees_cents: n(a.feesCents),
        discount_cents: n(a.discountCents),
        total_cents: n(a.totalCents),
        objection_deadline: od(a.objectionDeadline),
        claim_deadline: od(a.claimDeadline),
        proposal_message_id: a.proposalMessageId,
        settle_message_id: a.settleMessageId,
        created_at: existing?.created_at ?? this.now(),
        finalized_at: od(a.finalizedAt),
      });
      if (
        !["finalized", "settled", "void"].includes(a.status) &&
        this.shares(a.expenseId).length > 0
      )
        this.recompute(a.expenseId);
    },
    setShare: async (a: Args<"setShare">) => {
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
      // A dispute changes state, not the locked amount (Kian's #16).
      if (a.status !== "disputed") this.recompute(a.expenseId);
    },
    recomputeExpense: async (a: Args<"recomputeExpense">) =>
      this.recompute(a.expenseId),
    enqueueOutbox: async (a: Args<"enqueueOutbox">) => {
      if (this.out.has(a.actionId)) return;
      this.out.set(a.actionId, {
        action_id: a.actionId,
        kind: a.kind as Outbox["kind"],
        group_id: a.groupId,
        to_phone: a.toPhone,
        target_message_id: a.targetMessageId,
        text: a.text,
        reaction: a.reaction as Outbox["reaction"],
        expense_id: a.expenseId,
        purpose: a.purpose as Outbox["purpose"],
        send_after: d(a.sendAfter),
        status: "queued",
        created_at: this.now(),
      });
    },
    cancelOutbox: async (a: Args<"cancelOutbox">) => {
      for (const o of this.out.values()) {
        if (
          o.expense_id === a.expenseId &&
          o.status === "queued" &&
          (!a.toPhone || o.to_phone === a.toPhone)
        )
          o.status = "cancelled";
      }
    },
    // Deduped on (approval, expense), like the module's by_approval_expense
    // index: one 👍 pays several shares, and a repeat of it pays nothing.
    createTransfer: async (a: Args<"createTransfer">) => {
      if (
        [...this.trs.values()].some(
          (t) =>
            t.approved_by_message_id === a.approvedByMessageId &&
            t.expense_id === a.expenseId,
        )
      )
        return;
      const e = this.exps.get(a.expenseId);
      if (!e?.payer_phone) throw new Error("Expense has no payer");
      if (e.status !== "finalized")
        throw new Error("Expense is not ready for settlement");
      if (a.fromPhone === e.payer_phone)
        throw new Error("Payer does not transfer to themselves");
      const approval = this.msgs.get(a.approvedByMessageId);
      if (!approval || approval.sender_phone !== a.fromPhone)
        throw new Error("Approval does not belong to debtor");
      const share = this.shrs.get(`${a.expenseId}:${a.fromPhone}`);
      if (!share || share.role !== "participant" || share.status !== "locked")
        throw new Error("Share is not payable");
      share.status = "approved";
      this.trs.set(a.transferId, {
        transfer_id: a.transferId,
        group_id: e.group_id,
        expense_id: a.expenseId,
        from_phone: a.fromPhone,
        to_phone: e.payer_phone,
        amount_cents: share.amount_cents,
        status: "pending",
        approved_by_message_id: a.approvedByMessageId,
        created_at: this.now(),
      });
    },
    setSettleMode: async (a: Args<"setSettleMode">) => {
      if (a.settleMode !== "ledger" && a.settleMode !== "per_expense")
        throw new Error(`Invalid settle mode: ${a.settleMode}`);
      if (!this.grps.has(a.groupId)) throw new Error("Unknown group");
      this.settings.set(a.groupId, a.settleMode);
    },
    // The module's checks, in its order: the payer's share absorbs the
    // difference so the total (and everyone else) is unchanged.
    resolveDispute: async (a: Args<"resolveDispute">) => {
      if (a.amountCents < 0n) throw new Error("Amount must not be negative");
      const e = this.exps.get(a.expenseId);
      if (!e) throw new Error("Unknown expense");
      if (e.status !== "finalized")
        throw new Error("Only finalized expenses have disputes to resolve");
      if (!e.payer_phone) throw new Error("Expense has no payer");
      const share = this.shrs.get(`${a.expenseId}:${a.phone}`);
      if (!share || share.role !== "participant" || share.status !== "disputed")
        throw new Error("Share is not disputed");
      const payer = this.shrs.get(`${a.expenseId}:${e.payer_phone}`);
      if (!payer) throw new Error("Payer share is missing");
      const amount = n(a.amountCents);
      const payerAmount = payer.amount_cents - (amount - share.amount_cents);
      if (payerAmount < 0)
        throw new Error("Amount exceeds what the payer's share can absorb");
      share.amount_cents = amount;
      share.status = "locked";
      payer.amount_cents = payerAmount;
      const sum = this.shares(a.expenseId).reduce((t, s) => t + s.amount_cents, 0);
      if (sum !== e.total_cents) throw new Error("Shares do not match expense total");
    },
    setLedgerSecret: async (a: Args<"setLedgerSecret">) => {
      if (!this.grps.has(a.groupId)) throw new Error("Unknown group");
      if (a.secret.length < 24) throw new Error("Ledger secret must contain at least 24 characters");
      this.ledgerSecrets.set(a.groupId, a.secret);
    },
    setLineItems: async (a: Args<"setLineItems">) => {
      for (const [k, i] of this.items)
        if (i.expense_id === a.expenseId) this.items.delete(k);
      for (const i of a.items) {
        this.items.set(i.itemId, {
          item_id: i.itemId,
          expense_id: a.expenseId,
          position: i.position,
          description: i.description,
          quantity: i.quantity,
          amount_cents: n(i.amountCents),
        });
      }
      if (this.shares(a.expenseId).length > 0) this.recompute(a.expenseId);
    },
    addClaim: async (a: Args<"addClaim">) => {
      const item = this.items.get(a.itemId);
      if (!item) throw new Error("Unknown line item");
      const id = `${a.itemId}:${a.phone}`;
      if (!this.clms.has(id))
        this.clms.set(id, {
          claim_id: id,
          item_id: a.itemId,
          expense_id: item.expense_id,
          phone: a.phone,
          source_message_id: a.sourceMessageId,
          created_at: this.now(),
        });
      this.recompute(item.expense_id);
    },
    removeClaim: async (a: Args<"removeClaim">) => {
      const item = this.items.get(a.itemId);
      this.clms.delete(`${a.itemId}:${a.phone}`);
      if (item) this.recompute(item.expense_id);
    },
  };

  reducers = () => createReducers(this.client as unknown as ReducerClient);
}
