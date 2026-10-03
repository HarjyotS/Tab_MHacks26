// SPEC §7.2 onboarding and names, and §7.8 queries.
import * as T from "../copy/templates.js";
import type { Debt } from "../copy/templates.js";
import type { Message } from "../store/types.js";
import { activeMembers, alreadyQueued, type BrainCtx, chatOf, say, styleFor, tapback } from "./context.js";
import { groupFor } from "./expense.js";

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

const NAME_PREFIX =
  /^(hi|hey|hello|yo)?[\s,!]*(it'?s|i'?m|im|i am|call me|name'?s|my name is|this is)?\s*/i;

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
  if (!name) return;
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

export async function handleBalanceQuery(ctx: BrainCtx, m: Message) {
  const group_id = groupFor(ctx, m);
  if (!group_id) return;
  const all = debts(ctx, group_id);
  const text = PERSONAL.test(m.text ?? "")
    ? T.personalBalanceReply({
        owes: all.filter((d) => d.from.phone === m.sender_phone),
        owed: all.filter((d) => d.to.phone === m.sender_phone),
      })
    : T.balanceReply({ debts: all });
  await say(ctx, {
    chat: chatOf(m),
    purpose: "balance_reply",
    id: `balance_reply:${m.message_id}`,
    text,
  });
}

export async function handleBreakdown(ctx: BrainCtx, m: Message) {
  const group_id = groupFor(ctx, m);
  if (!group_id) return;
  const lines = ctx.store
    .expenses()
    .filter((e) => e.group_id === group_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .flatMap((e) => {
      const s = ctx.store
        .shares(e.expense_id)
        .find((x) => x.phone === m.sender_phone && x.role === "participant");
      return s && ["locked", "approved", "disputed"].includes(s.status)
        ? [{ description: e.description, amount_cents: s.amount_cents }]
        : [];
    });
  await say(ctx, {
    chat: chatOf(m),
    purpose: "breakdown_reply",
    id: `breakdown_reply:${m.message_id}`,
    text: T.breakdownReply({ lines }),
  });
}

export async function handleHelp(ctx: BrainCtx, m: Message) {
  await say(ctx, {
    chat: chatOf(m),
    purpose: "help_reply",
    id: `help_reply:${m.message_id}`,
    text: T.helpReply(m.message_id),
  });
}
