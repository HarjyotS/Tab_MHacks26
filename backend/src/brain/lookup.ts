// Read-only lookups over the database for answering questions (the money
// brain, SPEC §7.8). Every number here is computed in code (P6): the agent
// only phrases what these return. Scoped like balance replies: a group chat
// sees that group, a DM sees every group the sender is in. Output names
// people (never phone numbers) and refers to expenses by short refs (e1,
// e2, …) mapped to expense ids here.
import { displayName, money } from "../copy/format.js";
import type { Expense, LineItem, Message, Share, Transfer } from "../store/types.js";
import { activeMembers, type BrainCtx } from "./context.js";
import { ledgerUrl } from "./ledger.js";
import { owing } from "./settle.js";
import { debts, explainShare, groupsOf, owedLines } from "./talk.js";

export type Scope = { groups: string[]; asker: string };

export const scopeOf = (ctx: BrainCtx, m: Message): Scope => ({ groups: groupsOf(ctx, m), asker: m.sender_phone });

// What each status means, so the agent can say it in words.
const EXPENSE_STATUS: Record<Expense["status"], string> = {
  needs_info: "Tab is still asking for details",
  proposed: "split proposed, can still change",
  itemizing: "waiting for people to claim receipt items",
  finalized: "locked in; shares are owed until paid",
  settled: "fully paid",
  void: "cancelled",
};
const SHARE_STATUS: Record<Share["status"], string> = {
  proposed: "proposed",
  awaiting_claim: "hasn't claimed items yet",
  locked: "owed, not paid yet",
  approved: "approved with a 👍, payment in progress",
  paid: "paid",
  disputed: "disputed",
  opted_out: "not part of it",
};
const SPLIT_MODE: Record<Expense["split_mode"], string> = {
  even: "even",
  custom: "custom (fixed amounts for some people)",
  itemized: "itemized (people claimed receipt items)",
};
const TRANSFER_STATUS: Record<Transfer["status"], string> = { pending: "in progress", done: "paid", failed: "failed" };

// Expenses that count as spending: anything logged except a cancelled one
// or one still missing details.
const COUNTED: Expense["status"][] = ["proposed", "itemizing", "finalized", "settled"];

// ── Text matching ────────────────────────────────────────────────────────
// Structured search over a small database: ranked word matches over the
// description, receipt items, and the message that logged it, with a few
// categories so "food" finds dinner, pizza, and groceries. Deterministic.

const STOP = new Set([
  "the", "a", "an", "of", "and", "or", "for", "on", "at", "to", "in", "from", "with", "my", "our", "we", "us", "i", "me",
  "you", "it", "that", "this", "was", "were", "is", "are", "did", "do", "does", "how", "much", "what", "who", "when",
  "receipt", "expense", "thing", "stuff", "trip", "spend", "spent", "spending", "cost", "costs", "total", "paid", "pay",
  "owe", "owed", "split", "all", "everything", "time", "last", "one", "some", "any",
]);

const CATEGORIES: Record<string, string[]> = {
  food: [
    "food", "dinner", "lunch", "breakfast", "brunch", "meal", "pizza", "grocery", "groceries", "restaurant", "burger",
    "taco", "sushi", "takeout", "doordash", "ubereat", "grubhub", "cafe", "coffee", "bistro", "diner", "snack", "dessert",
    "bbq", "ramen", "pho", "sandwich", "salad", "chipotle", "thai", "indian", "chinese", "grill", "kitchen", "bagel",
    "costco", "meijer", "kroger", "walmart", "trader", "aldi", "safeway", "wing", "noodle", "cheesecake", "fries",
  ],
  drinks: ["drink", "bar", "beer", "wine", "cocktail", "liquor", "boba", "soda", "pub", "brewery", "shot"],
  transport: ["uber", "lyft", "cab", "taxi", "gas", "parking", "train", "bus", "flight", "toll", "ride", "car", "rental"],
  lodging: ["airbnb", "hotel", "motel", "hostel", "stay", "rent", "deposit"],
  groceries: ["grocery", "groceries", "costco", "meijer", "kroger", "walmart", "target", "trader", "aldi", "safeway"],
  fun: ["movie", "ticket", "concert", "show", "game", "bowling", "museum"],
  utilities: ["electric", "electricity", "wifi", "internet", "water", "utility", "utilities", "bill"],
};
const ALIASES: Record<string, string> = {
  food: "food", eating: "food", meal: "food", restaurant: "food", eat: "food",
  drink: "drinks", alcohol: "drinks", booze: "drinks",
  transport: "transport", transportation: "transport", travel: "transport", ride: "transport",
  lodging: "lodging", housing: "lodging", accommodation: "lodging",
  grocery: "groceries", groceries: "groceries",
  fun: "fun", entertainment: "fun", activity: "fun",
  utility: "utilities", utilities: "utilities", bill: "utilities",
};

const stem = (w: string) => w.replace(/ies$/, "y").replace(/(?<!s)s$/, "");

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
    .map(stem);
}

// Each query word, widened to its category when it names one.
function queryTerms(query: string): string[][] {
  return words(query)
    .filter((w) => !STOP.has(w))
    .map((w) => {
      const cat = ALIASES[w];
      return cat ? [w, ...CATEGORIES[cat]!.map(stem)] : [w];
    });
}

const hits = (have: string[], terms: string[]) =>
  terms.some((t) => have.some((h) => h === t || (t.length >= 4 && h.includes(t))));

// ── The lookup itself ────────────────────────────────────────────────────

export type ExpenseFilter = {
  query?: string;
  payer?: string;
  participant?: string;
  status?: Expense["status"];
  since?: string; // YYYY-MM-DD, inclusive
  until?: string; // YYYY-MM-DD, inclusive
  limit?: number;
};

type Err = { error: string };

export function createLookup(ctx: BrainCtx, scope: Scope) {
  const groups = new Set(scope.groups);
  const multi = scope.groups.length > 1;
  const members = scope.groups.flatMap((g) => activeMembers(ctx, g));
  const nameOf = (phone: string) => {
    const m = members.find((x) => x.phone === phone);
    return displayName({ phone, name: m?.name });
  };
  const groupName = (group_id: string) => ctx.store.group(group_id)?.display_name ?? "the group";

  // Every expense in scope, oldest first; refs follow that order, so they
  // stay the same for the whole conversation.
  const all = ctx.store
    .expenses()
    .filter((e) => groups.has(e.group_id))
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.expense_id.localeCompare(b.expense_id));
  const refs = new Map(all.map((e, i) => [e.expense_id, `e${i + 1}`]));
  const refOf = (e: Expense) => refs.get(e.expense_id)!;
  const byRef = (ref: string) => all.find((e) => refOf(e) === ref.trim().toLowerCase());

  const tz = (group_id: string) => ctx.store.group(group_id)?.timezone ?? "America/Detroit";
  const dateOf = (d: Date, group_id: string) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz(group_id) }).format(d);
  const dayOf = (d: Date, group_id: string) =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz(group_id) }).format(d);

  // "me", "jake", "Priya" → a phone in scope. Never guesses between two.
  function person(name: string): string | Err {
    const n = name.trim().toLowerCase().replace(/^@/, "");
    if (["me", "i", "myself", "sender", "asker"].includes(n)) return scope.asker;
    const named = [...new Map(members.map((m) => [m.phone, m])).values()];
    const exact = named.filter((m) => m.name?.toLowerCase() === n);
    if (exact.length === 1) return exact[0]!.phone;
    const prefix = n.length >= 3 ? named.filter((m) => m.name?.toLowerCase().startsWith(n)) : [];
    if (prefix.length === 1 && exact.length === 0) return prefix[0]!.phone;
    return { error: `No one named "${name}" here. People: ${named.map((m) => displayName(m)).join(", ")}` };
  }
  const isErr = (v: unknown): v is Err => typeof v === "object" && v !== null && "error" in v;

  const live = (e: Expense) => ctx.store.shares(e.expense_id).filter((s) => s.status !== "opted_out");
  const inIt = (e: Expense, phone: string) => e.payer_phone === phone || live(e).some((s) => s.phone === phone);

  // Kept text only: a message is in the database only if it was about money.
  function sourceText(e: Expense): string | undefined {
    const msg = ctx.store.messages().find((x) => x.message_id === e.source_message_id);
    if (!msg?.text || msg.intent === "ignore") return undefined;
    // Someone's DM to Tab stays theirs.
    if (!msg.group_id && msg.sender_phone !== scope.asker) return undefined;
    return msg.text;
  }

  function score(e: Expense, terms: string[][]): number {
    const desc = words(e.description);
    const items = ctx.store.lineItems(e.expense_id).flatMap((i) => words(i.description));
    const source = words(sourceText(e) ?? "");
    let total = 0;
    for (const t of terms) total += hits(desc, t) ? 3 : hits(items, t) ? 2 : hits(source, t) ? 1 : 0;
    return total;
  }

  function select(f: ExpenseFilter): Expense[] | Err {
    const payer = f.payer ? person(f.payer) : undefined;
    if (isErr(payer)) return payer;
    const participant = f.participant ? person(f.participant) : undefined;
    if (isErr(participant)) return participant;
    const terms = f.query ? queryTerms(f.query) : [];
    const picked = all
      .filter((e) => (f.status ? e.status === f.status : COUNTED.includes(e.status)))
      .filter((e) => !payer || e.payer_phone === payer)
      .filter((e) => !participant || inIt(e, participant))
      .filter((e) => !f.since || dayOf(e.created_at, e.group_id) >= f.since)
      .filter((e) => !f.until || dayOf(e.created_at, e.group_id) <= f.until)
      .map((e) => ({ e, s: terms.length ? score(e, terms) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.e.created_at.getTime() - a.e.created_at.getTime());
    return picked.map((x) => x.e);
  }

  const summary = (e: Expense) => ({
    ref: refOf(e),
    description: e.description,
    total: money(e.total_cents),
    payer: e.payer_phone ? nameOf(e.payer_phone) : "unknown",
    date: dateOf(e.created_at, e.group_id),
    status: EXPENSE_STATUS[e.status],
    people: live(e).map((s) => nameOf(s.phone)),
    ...(ctx.store.lineItems(e.expense_id).length ? { receipt_items: ctx.store.lineItems(e.expense_id).length } : {}),
    ...(multi ? { group: groupName(e.group_id) } : {}),
  });

  const cap = (n: number | undefined, d: number) => Math.min(Math.max(1, Math.floor(n ?? d)), 20);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // Netted per group like `debts`, then one line per pair (handleBalanceQuery).
  function allDebts() {
    const byPair = new Map<string, { from: string; to: string; cents: number }>();
    for (const d of scope.groups.flatMap((g) => debts(ctx, g))) {
      const key = `${d.from.phone}>${d.to.phone}`;
      const seen = byPair.get(key);
      byPair.set(key, { from: d.from.phone, to: d.to.phone, cents: (seen?.cents ?? 0) + d.amount_cents });
    }
    return [...byPair.values()].sort((a, b) => b.cents - a.cents);
  }

  return {
    refOf,
    byRef,

    findExpenses(f: ExpenseFilter) {
      const found = select(f);
      if (isErr(found)) return found;
      const limit = cap(f.limit, 8);
      return {
        count: found.length,
        all_matches_total: money(sum(found.map((e) => e.total_cents))),
        expenses: found.slice(0, limit).map(summary),
        ...(found.length > limit ? { more_not_shown: found.length - limit } : {}),
      };
    },

    expenseDetail(ref: string) {
      const e = byRef(ref);
      if (!e) return { error: `No expense ${ref}. Use find_expenses to get refs.` };
      const items: LineItem[] = ctx.store.lineItems(e.expense_id);
      const claims = ctx.store.claims(e.expense_id);
      const extra = (label: string, cents: number | undefined) => (cents ? { [label]: money(cents) } : {});
      const posted = ctx.store.messages().find((x) => x.message_id === e.source_message_id);
      return {
        ref: refOf(e),
        description: e.description,
        status: EXPENSE_STATUS[e.status],
        payer: e.payer_phone ? nameOf(e.payer_phone) : "unknown",
        ...(posted && posted.sender_phone !== e.payer_phone ? { logged_by: nameOf(posted.sender_phone) } : {}),
        date: dateOf(e.created_at, e.group_id),
        ...(e.finalized_at ? { locked_in: dateOf(e.finalized_at, e.group_id) } : {}),
        split: SPLIT_MODE[e.split_mode],
        total: money(e.total_cents),
        ...(e.subtotal_cents !== undefined && e.subtotal_cents !== e.total_cents ? { subtotal: money(e.subtotal_cents) } : {}),
        ...extra("tax", e.tax_cents),
        ...extra("tip", e.tip_cents),
        ...extra("fees", e.fees_cents),
        ...extra("discount", e.discount_cents),
        shares: live(e).map((s) => ({
          name: nameOf(s.phone),
          ...(s.role === "payer"
            ? { role: "payer", own_part: money(s.amount_cents) }
            : { owes_payer: money(s.amount_cents), status: SHARE_STATUS[s.status] }),
          why: explainShare(ctx, e, s.phone),
        })),
        ...(items.length
          ? {
              receipt_items: items.map((i) => {
                const who = claims.filter((c) => c.item_id === i.item_id).map((c) => nameOf(c.phone));
                return {
                  line: i.position,
                  description: i.description,
                  ...(i.quantity > 1 ? { quantity: i.quantity } : {}),
                  price: money(i.amount_cents),
                  ...(e.split_mode === "itemized" ? { claimed_by: who.length ? who : "nobody (shared by everyone)" } : {}),
                };
              }),
            }
          : {}),
        payments: ctx.store
          .transfers()
          .filter((t) => t.expense_id === e.expense_id)
          .map((t) => ({ from: nameOf(t.from_phone), to: nameOf(t.to_phone), amount: money(t.amount_cents), status: TRANSFER_STATUS[t.status] })),
        ...(sourceText(e) ? { logged_from_message: sourceText(e) } : {}),
        ...(multi ? { group: groupName(e.group_id) } : {}),
      };
    },

    balances(a: { person?: string } = {}) {
      const who = a.person ? person(a.person) : undefined;
      if (isErr(who)) return who;
      const ds = allDebts();
      const net = new Map<string, number>();
      for (const d of ds) {
        net.set(d.to, (net.get(d.to) ?? 0) + d.cents);
        net.set(d.from, (net.get(d.from) ?? 0) - d.cents);
      }
      const shown = who ? ds.filter((d) => d.from === who || d.to === who) : ds;
      const position = (phone: string) => {
        const c = net.get(phone) ?? 0;
        return { name: nameOf(phone), ...(c > 0 ? { is_owed_in_total: money(c) } : c < 0 ? { owes_in_total: money(-c) } : { square: true }) };
      };
      return {
        all_square: ds.length === 0,
        debts: shown.map((d) => ({ from: nameOf(d.from), owes: nameOf(d.to), amount: money(d.cents) })),
        positions: who ? [position(who)] : [...net.keys()].map(position),
        note: "Counts every locked-in share not yet paid. Proposed splits aren't owed until they lock in.",
      };
    },

    whyOwe(a: { from: string; to: string }) {
      const from = person(a.from);
      if (isErr(from)) return from;
      const to = person(a.to);
      if (isErr(to)) return to;
      const line = (l: ReturnType<typeof owedLines>[number]) => ({
        ref: refOf(l.expense),
        description: l.description,
        date: dateOf(l.expense.created_at, l.expense.group_id),
        amount: money(l.amount_cents),
        why: l.why,
      });
      const owes = scope.groups.flatMap((g) => owedLines(ctx, g, from, to));
      const back = scope.groups.flatMap((g) => owedLines(ctx, g, to, from));
      const gross = sum(owes.map((l) => l.amount_cents));
      const offset = sum(back.map((l) => l.amount_cents));
      const now = allDebts();
      const debt = now.find((d) => d.from === from && d.to === to)?.cents ?? 0;
      const reverse = now.find((d) => d.from === to && d.to === from)?.cents ?? 0;
      return {
        from: nameOf(from),
        to: nameOf(to),
        owes_now: debt ? money(debt) : "nothing",
        ...(reverse ? { instead_is_owed: money(reverse) } : {}),
        expenses: owes.map(line),
        expenses_total: money(gross),
        ...(back.length ? { offset_by: back.map(line), offset_total: money(offset), note: `${nameOf(to)} owes ${nameOf(from)} for these, so they net out` } : {}),
      };
    },

    totals(a: ExpenseFilter & { refs?: string[] }) {
      let picked: Expense[];
      if (a.refs?.length) {
        const found = a.refs.map((r) => byRef(r));
        const missing = a.refs.filter((_, i) => !found[i]);
        if (missing.length) return { error: `Unknown refs: ${missing.join(", ")}` };
        picked = [...new Set(found as Expense[])];
      } else {
        const s = select(a);
        if (isErr(s)) return s;
        picked = s;
      }
      const paid = new Map<string, number>();
      const share = new Map<string, number>();
      for (const e of picked) {
        if (e.payer_phone) paid.set(e.payer_phone, (paid.get(e.payer_phone) ?? 0) + e.total_cents);
        for (const s of live(e)) share.set(s.phone, (share.get(s.phone) ?? 0) + s.amount_cents);
      }
      const ranked = (m: Map<string, number>, label: string) =>
        [...m.entries()].sort((x, y) => y[1] - x[1]).map(([p, c]) => ({ name: nameOf(p), [label]: money(c) }));
      const tax = sum(picked.map((e) => e.tax_cents));
      const tip = sum(picked.map((e) => e.tip_cents));
      return {
        count: picked.length,
        total_spent: money(sum(picked.map((e) => e.total_cents))),
        ...(tax ? { tax_included: money(tax) } : {}),
        ...(tip ? { tip_included: money(tip) } : {}),
        paid_upfront_by: ranked(paid, "paid"),
        each_persons_share: ranked(share, "share"),
        expenses: picked.slice(0, 10).map((e) => ({ ref: refOf(e), description: e.description, date: dateOf(e.created_at, e.group_id), total: money(e.total_cents) })),
        ...(picked.length > 10 ? { more_not_shown: picked.length - 10 } : {}),
      };
    },

    payments(a: { person?: string } = {}) {
      const who = a.person ? person(a.person) : undefined;
      if (isErr(who)) return who;
      const ts = ctx.store
        .transfers()
        .filter((t) => groups.has(t.group_id) && (!who || t.from_phone === who || t.to_phone === who))
        .sort((x, y) => y.created_at.getTime() - x.created_at.getTime());
      return {
        count: ts.length,
        paid_total: money(sum(ts.filter((t) => t.status === "done").map((t) => t.amount_cents))),
        payments: ts.slice(0, 15).map((t) => {
          const e = ctx.store.expense(t.expense_id);
          return {
            from: nameOf(t.from_phone),
            to: nameOf(t.to_phone),
            amount: money(t.amount_cents),
            status: TRANSFER_STATUS[t.status],
            date: dateOf(t.completed_at ?? t.created_at, t.group_id),
            ...(e ? { for: e.description, ref: refOf(e) } : {}),
          };
        }),
      };
    },

    settleStatus() {
      const requests = new Map<string, Expense[]>();
      for (const e of all.filter((x) => x.status === "finalized" && x.settle_message_id))
        requests.set(e.settle_message_id!, [...(requests.get(e.settle_message_id!) ?? []), e]);
      const people = (es: Expense[], status: Share["status"]) =>
        es.flatMap((e) =>
          ctx.store
            .shares(e.expense_id)
            .filter((s) => s.role === "participant" && s.status === status && s.amount_cents > 0)
            .map((s) => ({ name: nameOf(s.phone), amount: money(s.amount_cents), to: nameOf(e.payer_phone!), for: e.description })),
        );
      const unrequested = all.filter((x) => x.status === "finalized" && !x.settle_message_id);
      return {
        ...Object.fromEntries(scope.groups.map((g) => [multi ? `settle_mode_${groupName(g)}` : "settle_mode", ctx.store.settleMode(g) === "ledger" ? "running tab: settles when someone says settle up" : "each expense settles on its own"])),
        open_settle_requests: [...requests.values()].map((es) => ({
          expenses: es.map((e) => ({ ref: refOf(e), description: e.description })),
          waiting_for_thumbs_up: people(es, "locked"),
          approved_payment_in_progress: people(es, "approved"),
          paid: people(es, "paid"),
          disputed: people(es, "disputed"),
        })),
        locked_in_not_requested_yet: unrequested.flatMap((e) =>
          owing(ctx, e).map((s) => ({ name: nameOf(s.phone), amount: money(s.amount_cents), to: nameOf(e.payer_phone!), for: e.description, ref: refOf(e) })),
        ),
        not_locked_in_yet: all
          .filter((e) => e.status === "proposed" || e.status === "itemizing")
          .map((e) => ({ ref: refOf(e), description: e.description, total: money(e.total_cents), status: EXPENSE_STATUS[e.status] })),
        everything_owed: allDebts().map((d) => ({ from: nameOf(d.from), owes: nameOf(d.to), amount: money(d.cents) })),
      };
    },

    searchMessages(a: { query?: string; limit?: number }) {
      const terms = a.query ? queryTerms(a.query) : [];
      // Money messages in scope (ignored chat has no text) and Tab's own
      // replies there. Other people's DMs to Tab stay out.
      const people = ctx.store
        .messages()
        .filter((x) => x.text && x.intent && x.intent !== "ignore" && x.kind === "text")
        .filter((x) => (x.group_id ? groups.has(x.group_id) : x.sender_phone === scope.asker))
        .map((x) => ({ at: x.received_at, group_id: x.group_id ?? scope.groups[0]!, from: nameOf(x.sender_phone), text: x.text! }));
      const tab = ctx.store
        .outbox()
        .filter((o) => o.kind !== "reaction" && o.text && o.status !== "cancelled")
        .filter((o) => (o.group_id ? groups.has(o.group_id) : o.to_phone === scope.asker))
        .map((o) => ({ at: o.created_at, group_id: o.group_id ?? scope.groups[0]!, from: "Tab", text: o.text! }));
      const found = [...people, ...tab]
        .map((x) => ({ x, s: terms.length ? sum(terms.map((t) => (hits(words(x.text), t) ? 1 : 0))) : 1 }))
        .filter((r) => r.s > 0)
        .sort((p, q) => q.s - p.s || q.x.at.getTime() - p.x.at.getTime())
        .slice(0, cap(a.limit, 8));
      return {
        messages: found.map(({ x }) => ({ from: x.from, date: dateOf(x.at, x.group_id), text: x.text })),
      };
    },

    async ledgerLink() {
      const links: { group?: string; url: string }[] = [];
      for (const g of scope.groups) {
        const url = await ledgerUrl(ctx, g);
        if (url) links.push({ ...(multi ? { group: groupName(g) } : {}), url });
      }
      return links.length ? { links } : { error: "The web ledger isn't set up." };
    },
  };
}

export type Lookup = ReturnType<typeof createLookup>;
