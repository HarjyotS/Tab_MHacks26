import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import {
  createReducers,
  InvalidCentsError,
  ReducerError,
  type ReducerClient,
} from "../src/db/reducers.js";

function fakeClient() {
  const ok = () => vi.fn().mockResolvedValue(undefined);
  const r = {
    setMessageResult: ok(),
    setMemberName: ok(),
    setGroupStatus: ok(),
    upsertExpense: ok(),
    setLineItems: ok(),
    addClaim: ok(),
    removeClaim: ok(),
    setShare: ok(),
    recomputeExpense: ok(),
    enqueueOutbox: ok(),
    cancelOutbox: ok(),
    createTransfer: ok(),
    setSettleMode: ok(),
    resolveDispute: ok(),
    setLedgerSecret: ok(),
  };
  return { r, db: createReducers(r as unknown as ReducerClient) };
}

const expense = {
  expense_id: "e1",
  group_id: "g1",
  payer_phone: "+15555550101",
  description: "Groceries",
  source_message_id: "m1",
  split_mode: "even" as const,
  status: "proposed" as const,
  tax_cents: 0,
  tip_cents: 0,
  fees_cents: 0,
  discount_cents: 0,
  total_cents: 6300,
};

describe("createReducers", () => {
  it("sends money as i64 cents and deadlines as Timestamps", async () => {
    const { r, db } = fakeClient();
    const deadline = new Date("2026-10-04T03:00:00Z");
    await db.upsert_expense({
      ...expense,
      subtotal_cents: 5800,
      objection_deadline: deadline,
    });
    const args = r.upsertExpense.mock.calls[0]![0];
    expect(args.totalCents).toBe(6300n);
    expect(args.subtotalCents).toBe(5800n);
    expect(args.taxCents).toBe(0n);
    expect(args.objectionDeadline).toEqual(Timestamp.fromDate(deadline));
    expect(args.claimDeadline).toBeUndefined();
    expect(args.payerPhone).toBe("+15555550101");
  });

  it.each([[-100], [12.5], [Number.MAX_SAFE_INTEGER + 2]])(
    "refuses %d cents before anything reaches the database",
    (bad) => {
      const { r, db } = fakeClient();
      expect(() => db.upsert_expense({ ...expense, total_cents: bad })).toThrow(
        InvalidCentsError,
      );
      expect(r.upsertExpense).not.toHaveBeenCalled();
    },
  );

  it("refuses a fractional line item amount", () => {
    const { r, db } = fakeClient();
    const items = [
      {
        item_id: "i1",
        position: 1,
        description: "Fries",
        quantity: 1,
        amount_cents: 7.99,
      },
    ];
    expect(() => db.set_line_items({ expense_id: "e1", items })).toThrow(
      InvalidCentsError,
    );
    expect(r.setLineItems).not.toHaveBeenCalled();
  });

  it("maps outbox fields to the generated names", async () => {
    const { r, db } = fakeClient();
    const sendAfter = new Date("2026-10-03T22:00:00Z");
    await db.enqueue_outbox({
      action_id: "a1",
      kind: "dm",
      to_phone: "+15555550102",
      text: "Last call on Frita Batidos.",
      expense_id: "e1",
      purpose: "claim_followup",
      send_after: sendAfter,
    });
    expect(r.enqueueOutbox).toHaveBeenCalledWith({
      actionId: "a1",
      kind: "dm",
      groupId: undefined,
      toPhone: "+15555550102",
      targetMessageId: undefined,
      text: "Last call on Frita Batidos.",
      reaction: undefined,
      expenseId: "e1",
      purpose: "claim_followup",
      sendAfter: Timestamp.fromDate(sendAfter),
    });
  });

  it("wraps a reducer failure with ids for logging but no message text", async () => {
    const { r, db } = fakeClient();
    r.setMessageResult.mockRejectedValueOnce(
      new Error("Requires service role: backend"),
    );
    const err = await db
      .set_message_result({
        message_id: "m9",
        intent: "ignore",
        confidence: 0.99,
        status: "done",
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReducerError);
    expect((err as ReducerError).reducer).toBe("set_message_result");
    expect((err as ReducerError).context).toEqual({ message_id: "m9" });
    expect((err as ReducerError).message).toBe(
      "set_message_result failed: Requires service role: backend",
    );
  });

  it("creates a transfer with the approving message id", async () => {
    const { r, db } = fakeClient();
    await db.create_transfer({
      transfer_id: "t1",
      expense_id: "e1",
      from_phone: "+15555550102",
      approved_by_message_id: "m7",
    });
    expect(r.createTransfer).toHaveBeenCalledWith({
      transferId: "t1",
      expenseId: "e1",
      fromPhone: "+15555550102",
      approvedByMessageId: "m7",
    });
  });

  it("stores the group's settle mode", async () => {
    const { r, db } = fakeClient();
    await db.set_settle_mode({ group_id: "g1", settle_mode: "per_expense" });
    expect(r.setSettleMode).toHaveBeenCalledWith({
      groupId: "g1",
      settleMode: "per_expense",
    });
  });

  it("resolves a dispute with the amount as i64 cents, and rejects bad cents", async () => {
    const { r, db } = fakeClient();
    await db.resolve_dispute({ expense_id: "e1", phone: "+15555550102", amount_cents: 1500 });
    expect(r.resolveDispute).toHaveBeenCalledWith({
      expenseId: "e1",
      phone: "+15555550102",
      amountCents: 1500n,
    });
    expect(() =>
      db.resolve_dispute({ expense_id: "e1", phone: "+15555550102", amount_cents: 1.5 }),
    ).toThrow(InvalidCentsError);
  });
});
