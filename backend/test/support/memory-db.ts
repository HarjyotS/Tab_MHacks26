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
  Person,
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
  // people: STOPs and payment handles, by phone (§19).
  ppl = new Map<string, Person>();
  constructor(private now: () => Date) {}

  // ── Store (backend_messages only shows new and processing rows) ────────
  // backend_messages returns full history (Kian's #16).
  messages = () => [...this.msgs.values()].map((x) => ({ ...x }));
  group = (id: string) => { const g = this.grps.get(id); return g && { ...g }; };
  groups = () => [...this.grps.values()].map((x) => ({ ...x }));
  settleMode = (id: string): SettleMode => this.settings.get(id) ?? "ledger";
  // Fresh objects on every read, like the real store (spacetime.ts maps each
  // row anew), so code that compares rows by reference fails here too.
  members = (id: string) =>
    [...this.mems.values()].filter((m) => m.group_id === id).map((m) => ({ ...m }));
  outbox = () => [...this.out.values()].map((x) => ({ ...x }));
  expense = (id: string) => { const e = this.exps.get(id); return e && { ...e }; };
  expenses = () => [...this.exps.values()].map((x) => ({ ...x }));
  shares = (id: string) =>
    [...this.shrs.values()].filter((s) => s.expense_id === id).map((x) => ({ ...x }));
  transfers = () => [...this.trs.values()].map((x) => ({ ...x }));
  person = (phone: string) => this.ppl.get(phone);
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
      const live = this.rawShares(t.expense_id).filter(
        (s) => s.role === "participant" && s.status !== "opted_out",
      );
      if (live.every((s) => s.status === "paid"))
        this.exps.get(t.expense_id)!.status = "settled";
    }
  }

  // The stored rows themselves, for the module's own reducers below.
  private rawShares = (id: string) => [...this.shrs.values()].filter((s) => s.expense_id === id);

  // ── The module's reducers ──────────────────────────────────────────────
  private settleIfAllPaid(expense_id: string) {
    const e = this.exps.get(expense_id);
    const live = this.rawShares(expense_id).filter((s) => s.role === "participant" && s.status !== "opted_out");
    if (e?.status === "finalized" && live.every((s) => s.status === "paid")) e.status = "settled";
  }

  private recompute(expense_id: string) {
    const e = this.exps.get(expense_id)!;
    if (["finalized", "settled", "void"].includes(e.status))
      throw new Error("Expense amounts are locked");
    const shares = this.rawShares(expense_id);
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
      if (a.totalCents < 0n || (a.totalCents === 0n && a.status !== "needs_info" && a.status !== "void")) {
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
        this.rawShares(a.expenseId).length > 0
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
      // The module skips DMs to anyone who texted STOP, except the confirmation.
      if (a.kind === "dm" && a.toPhone && a.purpose !== "opt_out" && this.ppl.get(a.toPhone)?.opted_out) return;
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
        provider: "spacetime_simulated",
        status: "pending",
        approved_by_message_id: a.approvedByMessageId,
        created_at: this.now(),
      });
    },
    // §7.6 payment links, in the module's order of checks.
    recordPayment: async (a: Args<"recordPayment">) => {
      if (!["venmo", "cashapp", "other"].includes(a.provider)) throw new Error(`Invalid payment provider: ${a.provider}`);
      if ([...this.trs.values()].some((t) => t.approved_by_message_id === a.messageId && t.expense_id === a.expenseId && t.from_phone === a.fromPhone)) return;
      const e = this.exps.get(a.expenseId);
      if (!e?.payer_phone) throw new Error("Expense has no payer");
      if (e.status !== "finalized") throw new Error("Expense is not ready for settlement");
      if (a.fromPhone === e.payer_phone) throw new Error("Payer does not pay themselves");
      const message = this.msgs.get(a.messageId);
      const byPayee = message?.sender_phone === e.payer_phone;
      if (!message || (message.sender_phone !== a.fromPhone && !byPayee))
        throw new Error("Only the two people involved can report a payment");
      const share = this.shrs.get(`${a.expenseId}:${a.fromPhone}`);
      if (share?.status === "paid") return;
      if (!share || share.role !== "participant" || !(share.status === "locked" || (byPayee && share.status === "approved")))
        throw new Error("Share is not payable");
      const earlier = [...this.trs.values()].find((t) => byPayee && t.expense_id === a.expenseId && t.from_phone === a.fromPhone && t.status === "reported");
      if (earlier) {
        earlier.status = "done";
        earlier.completed_at = this.now();
        share.status = "paid";
        this.settleIfAllPaid(a.expenseId);
        return;
      }
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
        created_at: this.now(),
        completed_at: byPayee ? this.now() : undefined,
      });
      if (byPayee) this.settleIfAllPaid(a.expenseId);
    },
    confirmPayment: async (a: Args<"confirmPayment">) => {
      const t = this.trs.get(a.transferId);
      if (!t) throw new Error("Unknown transfer");
      if (t.status === "done") return;
      if (t.status !== "reported") throw new Error("Transfer is not waiting on confirmation");
      if (this.msgs.get(a.messageId)?.sender_phone !== t.to_phone) throw new Error("Only the payee can confirm a payment");
      const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`);
      if (!share || share.status !== "approved") throw new Error("Reported share is missing");
      t.status = "done";
      t.completed_at = this.now();
      share.status = "paid";
      this.settleIfAllPaid(t.expense_id);
    },
    rejectPayment: async (a: Args<"rejectPayment">) => {
      const t = this.trs.get(a.transferId);
      if (!t) throw new Error("Unknown transfer");
      if (t.status !== "reported") throw new Error("Transfer is not waiting on confirmation");
      if (this.msgs.get(a.messageId)?.sender_phone !== t.to_phone) throw new Error("Only the payee can say it never arrived");
      t.status = "failed";
      const share = this.shrs.get(`${t.expense_id}:${t.from_phone}`);
      if (share?.status === "approved") share.status = "locked";
    },
    setOptOut: async (a: Args<"setOptOut">) => {
      this.ppl.set(a.phone, { ...(this.ppl.get(a.phone) ?? { phone: a.phone }), opted_out: a.optedOut });
    },
    setPaymentHandle: async (a: Args<"setPaymentHandle">) => {
      if (a.venmo !== undefined && !/^[A-Za-z0-9_-]{5,30}$/.test(a.venmo)) throw new Error("Invalid Venmo username");
      if (a.cashtag !== undefined && !/^(?=.*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(a.cashtag)) throw new Error("Invalid $cashtag");
      if (a.venmo === undefined && a.cashtag === undefined) throw new Error("No handle given");
      const p = this.ppl.get(a.phone) ?? { phone: a.phone, opted_out: false };
      this.ppl.set(a.phone, { ...p, venmo: a.venmo ?? p.venmo, cashtag: a.cashtag ?? p.cashtag });
    },
    // The module's forget_person: their number becomes a placeholder
    // everywhere, their words and name go, only the opt-out stays.
    forgetPerson: async (a: Args<"forgetPerson">) => {
      const phone = a.phone;
      const gone = `forgotten:${this.now().getTime()}`;
      const swap = (x: string) => x.split(phone).join(gone);
      const p = this.ppl.get(phone);
      const handles = [p?.venmo, p?.cashtag].filter((h): h is string => Boolean(h));
      const mentions = (text?: string) => text !== undefined && (text.includes(phone) || handles.some((h) => text.includes(h)));
      for (const [id, m] of [...this.msgs]) {
        const theirs = m.sender_phone === phone;
        if (!theirs && !id.includes(phone)) continue;
        this.msgs.delete(id);
        this.msgs.set(swap(id), {
          ...m, message_id: swap(id), sender_phone: theirs ? gone : m.sender_phone,
          text: theirs ? undefined : m.text, image_url: theirs ? undefined : m.image_url,
        });
      }
      for (const [id, o] of [...this.out]) {
        const toThem = o.to_phone === phone;
        const quotes = mentions(o.text);
        if (!toThem && !quotes && !id.includes(phone)) continue;
        const pending = o.status === "queued" || o.status === "sending";
        this.out.delete(id);
        this.out.set(swap(id), {
          ...o, action_id: swap(id), to_phone: toThem ? gone : o.to_phone,
          text: toThem || quotes ? undefined : o.text,
          status: (toThem || quotes) && pending ? "cancelled" : o.status,
        });
      }
      for (const [id, m] of [...this.mems])
        if (m.phone === phone) {
          this.mems.delete(id);
          this.mems.set(`${m.group_id}:${gone}`, { ...m, member_id: `${m.group_id}:${gone}`, phone: gone, name: undefined, left_at: m.left_at ?? this.now() });
        }
      for (const [id, s] of [...this.shrs])
        if (s.phone === phone) {
          this.shrs.delete(id);
          this.shrs.set(`${s.expense_id}:${gone}`, { ...s, share_id: `${s.expense_id}:${gone}`, phone: gone });
        }
      for (const [id, c] of [...this.clms])
        if (c.phone === phone) {
          this.clms.delete(id);
          this.clms.set(`${c.item_id}:${gone}`, { ...c, claim_id: `${c.item_id}:${gone}`, phone: gone });
        }
      for (const e of this.exps.values()) if (e.payer_phone === phone) e.payer_phone = gone;
      for (const [id, t] of [...this.trs]) {
        if (t.from_phone !== phone && t.to_phone !== phone && !id.includes(phone)) continue;
        this.trs.delete(id);
        this.trs.set(swap(id), {
          ...t, transfer_id: swap(id),
          from_phone: t.from_phone === phone ? gone : t.from_phone,
          to_phone: t.to_phone === phone ? gone : t.to_phone,
        });
      }
      this.ppl.set(phone, { phone, opted_out: true });
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
      const sum = this.rawShares(a.expenseId).reduce((t, s) => t + s.amount_cents, 0);
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
      if (this.rawShares(a.expenseId).length > 0) this.recompute(a.expenseId);
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
