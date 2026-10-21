// The backend's real engine (src/store/engine.ts), kept in memory, plus the
// shortcuts tests use to play the bridge: a handler that would fail in
// production fails here too.
import { createReducers } from "../../src/db/reducers.js";
import { Engine } from "../../src/store/engine.js";
import type { Group, Message, Outbox } from "../../src/store/types.js";

export class MemoryDb extends Engine {
  constructor(now: () => Date) {
    super({ now });
  }

  // Tests seed and change rows directly between operations: that's the
  // state an operation starts from, and goes back to if it throws.
  protected override beforeOp(): void {
    this.acceptTouched();
  }

  // ── What the client does ───────────────────────────────────────────────
  addGroup(group_id: string, people: { phone: string; name?: string }[], status: Group["onboarding_status"] = "active") {
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
    const sent = [...this.out.values()].filter((o) => o.status === "queued" && o.send_after <= this.now());
    for (const o of sent) {
      o.status = "sent";
      o.sent_photon_id = `imsg-${o.action_id}`;
    }
    return sent;
  }

  // What the scheduled completion does once a transfer's delay passes, for
  // every pending transfer at once.
  completeTransfers() {
    for (const t of this.trs.values()) {
      if (t.status !== "pending") continue;
      t.status = "done";
      t.completed_at = this.now();
      this.shrs.get(`${t.expense_id}:${t.from_phone}`)!.status = "paid";
      const live = this.rawShares(t.expense_id).filter((s) => s.role === "participant" && s.status !== "opted_out");
      if (live.every((s) => s.status === "paid")) this.exps.get(t.expense_id)!.status = "settled";
    }
    this.schedule.clear();
  }

  reducers = () => createReducers(this.client);
}
