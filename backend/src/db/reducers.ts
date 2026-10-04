// The backend's only write path into SpacetimeDB (SPEC §5.5): one typed
// function per reducer the backend role may call. This is the single place
// that converts cents to i64 and Dates to Timestamps, and that validates
// money before it reaches the database.
import { Timestamp } from "spacetimedb";
import type { DbConnection } from "../module_bindings/index.js";
import type {
  CreateTransfer,
  EnqueueOutbox,
  GroupStatus,
  LineItemInput,
  SetMessageResult,
  SettleMode,
  SetShare,
  UpsertExpense,
} from "./types.js";

type Generated = DbConnection["reducers"];

// The generated reducer functions the backend uses. Tests pass a fake.
export type ReducerClient = Pick<
  Generated,
  | "setMessageResult"
  | "setMemberName"
  | "setGroupStatus"
  | "upsertExpense"
  | "setLineItems"
  | "addClaim"
  | "removeClaim"
  | "setShare"
  | "recomputeExpense"
  | "enqueueOutbox"
  | "cancelOutbox"
  | "createTransfer"
  | "setSettleMode"
  | "resolveDispute"
  | "setLedgerSecret"
>;

export class ReducerError extends Error {
  constructor(
    readonly reducer: string,
    readonly context: Record<string, string | undefined>,
    cause: unknown,
  ) {
    super(
      `${reducer} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

export class InvalidCentsError extends Error {}

function cents(field: string, value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidCentsError(
      `${field} must be a non-negative integer number of cents, got ${value}`,
    );
  }
  return BigInt(value);
}

const optCents = (field: string, v: number | undefined) =>
  v === undefined ? undefined : cents(field, v);
const ts = (d: Date) => Timestamp.fromDate(d);
const optTs = (d: Date | undefined) => (d === undefined ? undefined : ts(d));

// Ids only in error context: message text and amounts stay out of logs.
async function call(
  reducer: string,
  context: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    throw new ReducerError(reducer, context, err);
  }
}

export function createReducers(r: ReducerClient) {
  return {
    set_message_result: (a: SetMessageResult) =>
      call("set_message_result", { message_id: a.message_id }, () =>
        r.setMessageResult({
          messageId: a.message_id,
          intent: a.intent,
          confidence: a.confidence,
          status: a.status,
          error: a.error,
        }),
      ),

    set_member_name: (a: { member_id: string; name: string }) =>
      call("set_member_name", { member_id: a.member_id }, () =>
        r.setMemberName({ memberId: a.member_id, name: a.name }),
      ),

    set_group_status: (a: { group_id: string; status: GroupStatus }) =>
      call("set_group_status", { group_id: a.group_id }, () =>
        r.setGroupStatus({ groupId: a.group_id, status: a.status }),
      ),

    upsert_expense: (a: UpsertExpense) => {
      const args = {
        expenseId: a.expense_id,
        groupId: a.group_id,
        payerPhone: a.payer_phone,
        description: a.description,
        sourceMessageId: a.source_message_id,
        splitMode: a.split_mode,
        status: a.status,
        subtotalCents: optCents("subtotal_cents", a.subtotal_cents),
        taxCents: cents("tax_cents", a.tax_cents),
        tipCents: cents("tip_cents", a.tip_cents),
        feesCents: cents("fees_cents", a.fees_cents),
        discountCents: cents("discount_cents", a.discount_cents),
        totalCents: cents("total_cents", a.total_cents),
        objectionDeadline: optTs(a.objection_deadline),
        claimDeadline: optTs(a.claim_deadline),
        proposalMessageId: a.proposal_message_id,
        settleMessageId: a.settle_message_id,
        finalizedAt: optTs(a.finalized_at),
      };
      return call(
        "upsert_expense",
        { expense_id: a.expense_id, group_id: a.group_id },
        () => r.upsertExpense(args),
      );
    },

    set_line_items: (a: { expense_id: string; items: LineItemInput[] }) => {
      const items = a.items.map((i) => ({
        itemId: i.item_id,
        position: i.position,
        description: i.description,
        quantity: i.quantity,
        amountCents: cents(`items[${i.position}].amount_cents`, i.amount_cents),
      }));
      return call("set_line_items", { expense_id: a.expense_id }, () =>
        r.setLineItems({ expenseId: a.expense_id, items }),
      );
    },

    add_claim: (a: {
      item_id: string;
      phone: string;
      source_message_id: string;
    }) =>
      call("add_claim", { item_id: a.item_id }, () =>
        r.addClaim({
          itemId: a.item_id,
          phone: a.phone,
          sourceMessageId: a.source_message_id,
        }),
      ),

    remove_claim: (a: { item_id: string; phone: string }) =>
      call("remove_claim", { item_id: a.item_id }, () =>
        r.removeClaim({ itemId: a.item_id, phone: a.phone }),
      ),

    set_share: (a: SetShare) => {
      if (!Number.isInteger(a.followup_count) || a.followup_count < 0) {
        throw new RangeError(
          `followup_count must be a non-negative integer, got ${a.followup_count}`,
        );
      }
      const args = {
        expenseId: a.expense_id,
        phone: a.phone,
        role: a.role,
        status: a.status,
        fixedCents: optCents("fixed_cents", a.fixed_cents),
        responded: a.responded,
        followupCount: a.followup_count,
        lastFollowupAt: optTs(a.last_followup_at),
      };
      return call("set_share", { expense_id: a.expense_id }, () =>
        r.setShare(args),
      );
    },

    recompute_expense: (a: { expense_id: string }) =>
      call("recompute_expense", { expense_id: a.expense_id }, () =>
        r.recomputeExpense({ expenseId: a.expense_id }),
      ),

    enqueue_outbox: (a: EnqueueOutbox) =>
      call(
        "enqueue_outbox",
        {
          action_id: a.action_id,
          purpose: a.purpose,
          expense_id: a.expense_id,
        },
        () =>
          r.enqueueOutbox({
            actionId: a.action_id,
            kind: a.kind,
            groupId: a.group_id,
            toPhone: a.to_phone,
            targetMessageId: a.target_message_id,
            text: a.text,
            reaction: a.reaction,
            expenseId: a.expense_id,
            purpose: a.purpose,
            sendAfter: ts(a.send_after),
          }),
      ),

    cancel_outbox: (a: { expense_id: string; to_phone?: string }) =>
      call("cancel_outbox", { expense_id: a.expense_id }, () =>
        r.cancelOutbox({ expenseId: a.expense_id, toPhone: a.to_phone }),
      ),

    create_transfer: (a: CreateTransfer) =>
      call(
        "create_transfer",
        { transfer_id: a.transfer_id, expense_id: a.expense_id },
        () =>
          r.createTransfer({
            transferId: a.transfer_id,
            expenseId: a.expense_id,
            fromPhone: a.from_phone,
            approvedByMessageId: a.approved_by_message_id,
          }),
      ),

    // SPEC §7.6: stored per group, so it survives a backend restart.
    set_settle_mode: (a: { group_id: string; settle_mode: SettleMode }) =>
      call("set_settle_mode", { group_id: a.group_id }, () =>
        r.setSettleMode({ groupId: a.group_id, settleMode: a.settle_mode }),
      ),

    // SPEC §7.6 disputes: a disputed share gets its new amount and goes back
    // to locked; the module moves the difference onto the payer's share.
    resolve_dispute: (a: {
      expense_id: string;
      phone: string;
      amount_cents: number;
    }) => {
      const amountCents = cents("amount_cents", a.amount_cents);
      return call("resolve_dispute", { expense_id: a.expense_id }, () =>
        r.resolveDispute({ expenseId: a.expense_id, phone: a.phone, amountCents }),
      );
    },

    set_ledger_secret: (a: { group_id: string; secret: string }) =>
      call("set_ledger_secret", { group_id: a.group_id }, () =>
        r.setLedgerSecret({ groupId: a.group_id, secret: a.secret }),
      ),
  };
}

export type BackendReducers = ReturnType<typeof createReducers>;
