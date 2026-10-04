// SPEC §7.2 onboarding and names, and §7.8 queries.
import * as T from "../copy/templates.js";
import type { Debt, OwedLine } from "../copy/templates.js";
import { listJoin, money } from "../copy/format.js";
import type { Expense, Message } from "../store/types.js";
import { ledgerUrl } from "./ledger.js";
import { activeMembers, alreadyQueued, type BrainCtx, chatOf, say, styleFor, tapback, chatKey } from "./context.js";

// §7.2 step 2: intro, name prompt, and contact card for a new group.
export async function onboardNewGroups(ctx: BrainCtx) {
  for (const g of ctx.store
    .groups()
    .filter((x) => x.onboarding_status === "pending")) {
    const id = `onboarding_intro:${g.group_id}`;
    if (alreadyQueued(ctx, id)) continue;
    const chat = { group_id: g.group_id };
    const wit =
      ctx.wit &&
      (await ctx
        .wit({
          purpose: "onboarding_intro",
          moment: "Tab was just added to this group chat",
          allowed_names: [],
          all_member_names: activeMembers(ctx, g.group_id)
            .map((m) => m.name)
            .filter((n): n is string => Boolean(n)),
          style: styleFor(ctx, chat),
          previous_had_wit: false,
        })
        .catch((err: unknown) => {
          ctx.log("wit_failed", { group_id: g.group_id, error: String(err) });
          return null;
        }));
    await say(ctx, {
      chat,
      purpose: "onboarding_intro",
      id,
      text: T.onboardingIntro(g.group_id),
      wit: wit || null,
    });
    await say(ctx, {
      chat,
      purpose: "name_prompt",
      id: `name_prompt:${g.group_id}`,
      text: T.namePrompt(g.group_id),
    });
    await ctx.db.enqueue_outbox({
      action_id: `contact_card:${g.group_id}`,
      kind: "contact_card",
      group_id: g.group_id,
      purpose: "onboarding_intro",
      send_after: ctx.now(),
    });
  }
}

// Text arrives normalized to ASCII quotes (process.ts), so "I’m" is "I'm".
const NAME_PREFIX =
  /^(@?tab\b[\s,:]*)?(hi|hey|hello|yo)?[\s,!]*(it'?s|i'?m|im|i am|call me|name'?s|my name is|this is)?\s*/i;

// "it's Kian" → "Kian". One word, letters only, capitalized.
export function parseName(text: string): string | undefined {
  const word =
    text
      .trim()
      .replace(NAME_PREFIX, "")
      .split(/[\s,!.]+/)[0] ?? "";
  if (!/^[a-z][a-z'-]{0,19}$/i.test(word)) return undefined;
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

export async function handleNameReply(ctx: BrainCtx, m: Message) {
  if (!m.group_id) return;
  const name = parseName(m.text ?? "");
  if (!name) {
    ctx.log("name_not_parsed", { message_id: m.message_id, group_id: m.group_id });
    return;
  }
  await ctx.db.set_member_name({
    member_id: `${m.group_id}:${m.sender_phone}`,
    name,
  });
  await tapback(ctx, m, "like");
  // §7.2 step 5: active once every known member is named.
  const members = activeMembers(ctx, m.group_id);
  const allNamed = members.every((x) => x.name || x.phone === m.sender_phone);
  if (
    allNamed &&
    ctx.store.group(m.group_id)?.onboarding_status === "pending"
  ) {
    await ctx.db.set_group_status({ group_id: m.group_id, status: "active" });
    // SPEC #15: ask once, right after names are in. Silence keeps ledger mode.
    await say(ctx, { chat: { group_id: m.group_id }, purpose: "clarifying_question", id: `settle_mode:${m.group_id}`, text: T.settleModeQuestion() });
    ctx.memory.pending.set(chatKey({ group_id: m.group_id }), { kind: "settle_mode", source: m, asked_at: ctx.now() });
  }
}

// §5.3: what A owes B, netted per pair.
export function debts(ctx: BrainCtx, group_id: string): Debt[] {
  const members = activeMembers(ctx, group_id);
  const person = (phone: string) => ({
    phone,
    name: members.find((m) => m.phone === phone)?.name,
  });
  const owed = new Map<string, number>(); // "from>to" → cents
  for (const e of ctx.store
    .expenses()
    .filter((x) => x.group_id === group_id && x.payer_phone)) {
    for (const s of ctx.store.shares(e.expense_id)) {
      if (
        s.role !== "participant" ||
        !["locked", "approved", "disputed"].includes(s.status)
      )
        continue;
      const key = `${s.phone}>${e.payer_phone}`;
      owed.set(key, (owed.get(key) ?? 0) + s.amount_cents);
    }
  }
  const out: Debt[] = [];
  for (const [key, cents] of owed) {
    const [from, to] = key.split(">") as [string, string];
    const net = cents - (owed.get(`${to}>${from}`) ?? 0);
    if (net > 0)
      out.push({ from: person(from), to: person(to), amount_cents: net });
  }
  return out.sort((a, b) => b.amount_cents - a.amount_cents);
}

const PERSONAL = /\b(i|me|my|am i)\b/i;

// Why someone's share of an expense is what it is, in words, built only from
// the database (P6): the split mode, pinned amounts, claims, and extras.
export function explainShare(ctx: BrainCtx, e: Expense, phone: string): string {
  const shares = ctx.store.shares(e.expense_id).filter((s) => s.status !== "opted_out");
  const members = activeMembers(ctx, e.group_id);
  const nameOf = (p: string) => members.find((m) => m.phone === p)?.name ?? `…${p.slice(-4)}`;
  const extras = [e.tax_cents > 0 && "tax", e.tip_cents > 0 && "tip", e.fees_cents > 0 && "fees"].filter(Boolean) as string[];
  const plus = extras.length ? ` + ${listJoin(extras)}` : "";

  if (e.split_mode === "itemized") {
    const claims = ctx.store.claims(e.expense_id);
    const mine: string[] = [];
    const shared: string[] = [];
    for (const item of ctx.store.lineItems(e.expense_id)) {
      const claimers = claims.filter((c) => c.item_id === item.item_id).map((c) => c.phone);
      const name = item.description.toLowerCase();
      if (claimers.length === 1 && claimers[0] === phone) mine.push(name);
      else if (claimers.length === 0 || claimers.includes(phone)) shared.push(name);
    }
    const parts = [...mine, ...(shared.length ? [`share of ${listJoin(shared)}`] : [])];
    return `${parts.join(", ") || "even share"}${plus}`;
  }
  const mine = shares.find((s) => s.phone === phone);
  if (e.split_mode === "custom" && mine?.fixed_cents !== undefined) return "what you had";
  const pinned = shares.filter((s) => s.fixed_cents !== undefined && s.phone !== phone);
  const after = pinned.length ? ` after ${listJoin(pinned.map((s) => `${nameOf(s.phone)}'s ${money(s.fixed_cents!)}`))}` : "";
  return `split ${shares.length - pinned.length} ways${after}${plus}`;
}

const OWING = ["locked", "approved", "disputed"];

function myLines(ctx: BrainCtx, group_id: string, phone: string): (OwedLine & { to: string })[] {
  return ctx.store
    .expenses()
    .filter((e) => e.group_id === group_id && e.payer_phone && e.payer_phone !== phone)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .flatMap((e) => {
      const s = ctx.store.shares(e.expense_id).find((x) => x.phone === phone && x.role === "participant");
      return s && OWING.includes(s.status) ? [{ to: e.payer_phone!, description: e.description, amount_cents: s.amount_cents, why: explainShare(ctx, e, phone) }] : [];
    });
}

// A DM is about every group the sender is in (Harjyot's playground test:
// a member of two groups got no answer by DM).
export function groupsOf(ctx: BrainCtx, m: Message): string[] {
  if (m.group_id) return [m.group_id];
  return ctx.store
    .groups()
    .filter((g) => activeMembers(ctx, g.group_id).some((x) => x.phone === m.sender_phone))
    .map((g) => g.group_id);
}

export async function handleBalanceQuery(ctx: BrainCtx, m: Message) {
  const groups = groupsOf(ctx, m);
  if (groups.length === 0) return;
  // The same two people can owe each other in several groups: one line each.
  const byPair = new Map<string, Debt>();
  for (const d of groups.flatMap((g) => debts(ctx, g))) {
    const key = `${d.from.phone}>${d.to.phone}`;
    const seen = byPair.get(key);
    byPair.set(key, seen ? { ...seen, amount_cents: seen.amount_cents + d.amount_cents } : d);
  }
  const all = [...byPair.values()];
  const text = PERSONAL.test(m.text ?? "")
    ? T.personalBalanceReply({
        owes: all.filter((d) => d.from.phone === m.sender_phone),
        owed: all.filter((d) => d.to.phone === m.sender_phone),
      })
    : T.balanceReply({
        debts: all,
        // Past six lines the rest is on the ledger (§7.8).
        ledger_url: all.length > 6 && groups.length === 1 ? await ledgerUrl(ctx, groups[0]!) : undefined,
      });
  await say(ctx, { chat: chatOf(m), purpose: "balance_reply", id: `balance_reply:${m.message_id}`, reply_to: m.message_id, text });
}

export async function handleBreakdown(ctx: BrainCtx, m: Message) {
  const groups = groupsOf(ctx, m);
  if (groups.length === 0) return;
  const lines = groups.flatMap((g) => myLines(ctx, g, m.sender_phone));
  await say(ctx, {
    chat: chatOf(m),
    purpose: "breakdown_reply",
    id: `breakdown_reply:${m.message_id}`, reply_to: m.message_id,
    text: T.breakdownReply({
      lines,
      // Past five lines the rest is on the ledger (§7.8).
      ledger_url: lines.length > 5 && groups.length === 1 ? await ledgerUrl(ctx, groups[0]!) : undefined,
    }),
  });
}

export async function handleHelp(ctx: BrainCtx, m: Message) {
  await say(ctx, {
    chat: chatOf(m),
    purpose: "help_reply",
    id: `help_reply:${m.message_id}`, reply_to: m.message_id,
    text: T.helpReply(m.message_id),
  });
}
