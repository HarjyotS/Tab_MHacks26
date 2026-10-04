// A week of house history written straight into the in-memory module, for
// the lookup layer and the money brain: a receipt with claimed items, a
// running tab, a paid and an in-progress payment, a split still proposed,
// a cancelled expense, and a second group the house can't see.
import type { Expense, Share } from "../../src/store/types.js";
import { GROUP, PEOPLE } from "./harness.js";
import type { MemoryDb } from "./memory-db.js";

export const SAM = "+15555550199";
export const WORK = "work";

const day = (d: number, h = 19) => new Date(Date.UTC(2026, 8, 26 + d, h, 0, 0)); // Sep 26 + d, evening in Detroit

function expense(db: MemoryDb, e: Partial<Expense> & Pick<Expense, "expense_id" | "description" | "total_cents">, text?: string, sender?: string) {
  const source = `src-${e.expense_id}`;
  db.msgs.set(source, {
    message_id: source,
    group_id: e.group_id ?? GROUP,
    sender_phone: sender ?? e.payer_phone ?? PEOPLE.Joe,
    is_dm: false,
    kind: text ? "text" : "image",
    text,
    image_url: text ? undefined : `https://img/${e.expense_id}.jpg`,
    received_at: e.created_at ?? day(0),
    intent: text ? "expense" : "receipt",
    status: "done",
  });
  db.exps.set(e.expense_id, {
    group_id: GROUP,
    source_message_id: source,
    split_mode: "even",
    status: "finalized",
    tax_cents: 0,
    tip_cents: 0,
    fees_cents: 0,
    discount_cents: 0,
    created_at: day(0),
    ...e,
  });
}

function share(db: MemoryDb, expense_id: string, phone: string, amount_cents: number, status: Share["status"], extra: Partial<Share> = {}) {
  const payer = db.exps.get(expense_id)!.payer_phone === phone;
  db.shrs.set(`${expense_id}:${phone}`, {
    share_id: `${expense_id}:${phone}`,
    expense_id,
    phone,
    role: payer ? "payer" : "participant",
    status,
    amount_cents,
    responded: false,
    followup_count: 0,
    ...extra,
  });
}

export function seedHistory(db: MemoryDb) {
  const { Joe, Kian, Priya, Jake } = PEOPLE;
  db.addGroup(WORK, [{ phone: Joe, name: "Joe" }, { phone: SAM, name: "Sam" }]);

  // e1: Harjyot's bistro receipt, itemized, settle request out.
  expense(db, {
    expense_id: "bistro", description: "The Bistro", payer_phone: Joe, split_mode: "itemized", total_cents: 4707,
    subtotal_cents: 3895, tax_cents: 312, tip_cents: 500, created_at: day(0), finalized_at: day(1), settle_message_id: "imsg-settle-1",
  });
  const items = [
    ["BURGER DELUXE", 1499, [Kian]],
    ["CAESAR SALAD", 999, [Priya]],
    ["2 x SOFT DRINK @ $2.99", 598, [Priya, Jake]],
    ["CHEESECAKE", 799, []],
  ] as const;
  items.forEach(([description, amount_cents, who], i) => {
    const item_id = `bistro-${i + 1}`;
    db.items.set(item_id, { item_id, expense_id: "bistro", position: i + 1, description, quantity: 1, amount_cents });
    for (const phone of who)
      db.clms.set(`${item_id}:${phone}`, { claim_id: `${item_id}:${phone}`, item_id, expense_id: "bistro", phone, source_message_id: "claim", created_at: day(0, 20) });
  });
  share(db, "bistro", Joe, 1000, "locked");
  share(db, "bistro", Kian, 1500, "locked");
  share(db, "bistro", Priya, 1400, "locked");
  share(db, "bistro", Jake, 807, "approved");
  db.trs.set("tr-jake-bistro", {
    transfer_id: "tr-jake-bistro", group_id: GROUP, expense_id: "bistro", from_phone: Jake, to_phone: Joe, amount_cents: 807,
    status: "pending", approved_by_message_id: "react-1", created_at: day(2),
  });

  // e2: pizza on the running tab (locked in, no request yet).
  expense(db, { expense_id: "pizza", description: "Pizza", payer_phone: Joe, total_cents: 4800, created_at: day(2), finalized_at: day(2, 22) }, "got pizza for everyone, $48");
  for (const p of [Joe, Kian, Priya, Jake]) share(db, "pizza", p, 1200, "locked");

  // e3: Jake's uber; Kian already paid him back.
  expense(db, { expense_id: "uber", description: "Uber to the airport", payer_phone: Jake, total_cents: 2400, created_at: day(3), finalized_at: day(3, 22) }, "uber to the airport was 24, i got it");
  share(db, "uber", Jake, 600, "locked");
  share(db, "uber", Joe, 600, "locked");
  share(db, "uber", Kian, 600, "paid");
  share(db, "uber", Priya, 600, "locked");
  db.trs.set("tr-kian-uber", {
    transfer_id: "tr-kian-uber", group_id: GROUP, expense_id: "uber", from_phone: Kian, to_phone: Jake, amount_cents: 600,
    status: "done", approved_by_message_id: "react-2", created_at: day(4), completed_at: day(4, 20),
  });

  // e4: groceries, still proposed.
  expense(db, { expense_id: "groceries", description: "Groceries", payer_phone: Kian, total_cents: 6300, status: "proposed", created_at: day(5) }, "got groceries, $63");
  for (const p of [Joe, Kian, Priya, Jake]) share(db, "groceries", p, 1575, "proposed");

  // e5: cancelled.
  expense(db, { expense_id: "tacos", description: "Tacos", payer_phone: Priya, total_cents: 3600, status: "void", created_at: day(5, 21) }, "tacos 36");

  // The other group: Joe and Sam's sushi. The house never sees it.
  expense(db, { expense_id: "sushi", group_id: WORK, description: "Sushi", payer_phone: Joe, total_cents: 9000, created_at: day(4) }, "sushi was 90");
  share(db, "sushi", Joe, 4500, "locked");
  share(db, "sushi", SAM, 4500, "locked");
}
