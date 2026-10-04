// "@Tab breakdown" (SPEC §7.8): where each balance comes from, traced to the
// expense records in SpacetimeDB. Built only from the store (the backend's
// subscription to the module's views), never from Grok: every name, amount,
// date and quote is a database row, and the netting is done here (P6).
//
//   @Tab breakdown              the sender's balance with each person
//   @Tab breakdown Priya        just the sender and Priya
//   @Tab breakdown Sam Alex     just Sam and Alex
//
// Always answered in the group, where the expenses happened.
import * as T from "../copy/templates.js";
import { GROUP_TIMEZONE } from "../config.js";
import type { Expense, Message } from "../store/types.js";
import { activeMembers, type BrainCtx, chatOf, say } from "./context.js";
import { ledgerUrl } from "./ledger.js";
import { explainShare, groupsOf } from "./talk.js";

export const BREAKDOWN_COMMAND = /^@?tab\b[\s,:]*breakdown\b/i;

const OWING = new Set(["locked", "approved", "disputed"]);
// Words around the names: "@Tab breakdown for me and Priya", "of what I owe Sam".
const FILLER = new Set(["for", "of", "with", "between", "and", "what", "owe", "owes", "to", "from", "the", "please", "pls", "vs", "&", "full"]);
const SELF = new Set(["me", "i", "my", "mine", "myself"]);
const MAX_PAIRS = 4;
const MAX_LINES = 12;
// Past this many lines, a Grok summary replaces the itemized list.
const SUMMARIZE_OVER_LINES = 6;
const SUMMARY_TIMEOUT_MS = 8_000;

type Event = T.BreakdownEvent & { at: Date };

// Every outstanding share between two people, as the events behind it: the
// expense, who paid what and when, the message that logged it, and why the
// share is that amount. Signed from a's side: + is a owing b.
function pairEvents(ctx: BrainCtx, group_id: string, a: string, b: string): Event[] {
  const name = nameIn(ctx, group_id);
  const tz = ctx.store.group(group_id)?.timezone ?? GROUP_TIMEZONE;
  const events: Event[] = [];
  for (const e of ctx.store.expenses().filter((x) => x.group_id === group_id && x.payer_phone)) {
    const [debtor, sign] = e.payer_phone === b ? [a, 1] : e.payer_phone === a ? [b, -1] : [undefined, 0];
    if (!debtor) continue;
    const share = ctx.store.shares(e.expense_id).find((s) => s.phone === debtor && s.role === "participant");
    if (!share || !OWING.has(share.status) || share.amount_cents === 0) continue;
    events.push({
      at: e.created_at,
      signed_cents: sign * share.amount_cents,
      description: e.description,
      payer: name(e.payer_phone!),
      debtor: name(debtor),
      total_cents: e.total_cents,
      when: when(e.created_at, tz),
      source: sourceOf(ctx, e),
      why: explainShare(ctx, e, debtor, name(debtor)),
    });
  }
  return events.sort((x, y) => x.at.getTime() - y.at.getTime());
}

// The message that logged the expense, quoted as it is stored.
function sourceOf(ctx: BrainCtx, e: Expense): string | undefined {
  const m = ctx.store.messages().find((x) => x.message_id === e.source_message_id);
  if (!m) return undefined;
  if (m.kind === "image") return "receipt photo";
  const text = m.text?.trim();
  if (!text) return undefined;
  return `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`;
}

const when = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

const nameIn = (ctx: BrainCtx, group_id: string) => {
  const members = activeMembers(ctx, group_id);
  return (phone: string) => members.find((m) => m.phone === phone)?.name ?? `…${phone.slice(-4)}`;
};

// Names after "breakdown", resolved to members of the group. Unknown words
// that aren't filler are reported back rather than guessed (P3).
export function breakdownTargets(ctx: BrainCtx, group_id: string, m: Message): { phones: string[]; unknown: string[] } {
  const rest = (m.text ?? "").replace(BREAKDOWN_COMMAND, "").toLowerCase();
  const members = activeMembers(ctx, group_id).filter((x) => x.name);
  const phones: string[] = [];
  const unknown: string[] = [];
  for (const word of rest.match(/[a-z][a-z'’-]*/g) ?? []) {
    if (FILLER.has(word)) continue;
    const phone = SELF.has(word)
      ? m.sender_phone
      : (members.find((x) => x.name!.toLowerCase() === word) ?? members.find((x) => x.name!.toLowerCase().startsWith(word)))?.phone;
    if (phone) {
      if (!phones.includes(phone)) phones.push(phone);
    } else unknown.push(word);
  }
  return { phones, unknown };
}

// Each pair's balance and the events behind it, largest balance first.
function buildSections(ctx: BrainCtx, group_id: string, pairs: [string, string][]): T.BreakdownPair[] {
  const name = nameIn(ctx, group_id);
  const sections: T.BreakdownPair[] = [];
  for (const [a, b] of pairs) {
    const events = pairEvents(ctx, group_id, a, b);
    if (events.length === 0) continue;
    const net = events.reduce((sum, e) => sum + e.signed_cents, 0);
    // Headline from the side that owes; flip the signs to match it.
    const [debtor, creditor, flip] = net >= 0 ? [a, b, 1] : [b, a, -1];
    sections.push({
      debtor: name(debtor),
      creditor: name(creditor),
      net_cents: Math.abs(net),
      events: events.map((e) => ({ ...e, signed_cents: e.signed_cents * flip })),
    });
  }
  return sections.sort((x, y) => y.net_cents - x.net_cents);
}

// "why?" right after a balance reply (Joe's rule: "if he asks why, explain
// very shortly"): one short line per balance the asker has, from the same
// traced records. "@Tab breakdown" is there for the full trace.
export async function handleShortWhy(ctx: BrainCtx, m: Message) {
  const groups = groupsOf(ctx, m);
  const lines = groups.flatMap((g) =>
    T.shortWhyLines(buildSections(ctx, g, activeMembers(ctx, g).filter((x) => x.phone !== m.sender_phone).map((x) => [m.sender_phone, x.phone])), nameIn(ctx, g)(m.sender_phone)),
  );
  await say(ctx, {
    chat: chatOf(m), purpose: "breakdown_reply", id: `breakdown_reply:${m.message_id}`, reply_to: m.message_id,
    text: T.shortWhyReply(lines),
  });
}

// "why do I owe Priya", "why does Sam owe me": the breakdown for that pair.
const WHY_OWE = /\bwhy (?:do|does|am) (\w+) (?:owe|owing) (\w+)/i;
export function whyOweTarget(m: Message): string | undefined {
  const match = (m.text ?? "").match(WHY_OWE);
  if (!match) return undefined;
  const [, a, b] = match;
  const self = (w: string) => /^(i|me)$/i.test(w);
  return [a!, b!].filter((w) => !self(w)).join(" ") || undefined;
}

export async function handleBreakdownCommand(ctx: BrainCtx, m: Message) {
  const group_id = m.group_id ?? groupsOf(ctx, m)[0];
  if (!group_id) return;
  const name = nameIn(ctx, group_id);
  const reply = (text: string) =>
    say(ctx, { chat: chatOf(m), purpose: "breakdown_reply", id: `breakdown_reply:${m.message_id}`, reply_to: m.message_id, text });

  const { phones, unknown } = breakdownTargets(ctx, group_id, m);
  if (unknown.length > 0) return reply(T.breakdownUnknown(unknown));

  // Who to pair: the sender with everyone, the sender with one person, or two people.
  const others = phones.filter((p) => p !== m.sender_phone);
  const pairs: [string, string][] =
    phones.length >= 2 && others.length >= 2
      ? [[phones[0]!, phones[1]!]]
      : others.length === 1
        ? [[m.sender_phone, others[0]!]]
        : activeMembers(ctx, group_id).filter((x) => x.phone !== m.sender_phone).map((x) => [m.sender_phone, x.phone]);

  const sections = buildSections(ctx, group_id, pairs);
  const subject = pairs.length === 1 ? undefined : name(m.sender_phone);
  const shown = T.breakdownCommandReply({ subject, pairs: sections, max_pairs: MAX_PAIRS, max_lines: MAX_LINES });
  const url = shown.truncated ? await ledgerUrl(ctx, group_id) : undefined;

  // Long and not asked for in full: one checked line per balance instead.
  if (!wantsFull(m) && shown.text.split("\n").length > SUMMARIZE_OVER_LINES) {
    const top = sections.slice(0, MAX_PAIRS);
    const reasons = await summarize(ctx, top, activeMembers(ctx, group_id).map((x) => x.name).filter((n): n is string => Boolean(n)));
    if (reasons) {
      const more_url = sections.length > top.length ? url ?? (await ledgerUrl(ctx, group_id)) : undefined;
      return reply(T.breakdownSummaryReply({ subject, pairs: top, reasons, more_url }));
    }
  }
  return reply(url ? `${shown.text}\nrest is here: ${url}` : shown.text);
}

// "@Tab breakdown full": every line, never summarized.
const wantsFull = (m: Message) => /\bfull\b/i.test((m.text ?? "").replace(BREAKDOWN_COMMAND, ""));

// Grok's short reasons, or null (no summarizer, slow, failed, or a reason
// that broke a rule): the caller then sends the full list.
async function summarize(ctx: BrainCtx, pairs: T.BreakdownPair[], member_names: string[]): Promise<string[] | null> {
  if (!ctx.summarize) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS)));
  try {
    const reasons = await Promise.race([ctx.summarize({ pairs, member_names }), timeout]);
    if (!reasons) ctx.log("summary_fallback", { pairs: pairs.length });
    return reasons;
  } catch (err) {
    ctx.log("summary_failed", { error: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function hintBreakdown(ctx: BrainCtx, m: Message) {
  await say(ctx, { chat: chatOf(m), purpose: "other", id: `breakdown_hint:${m.message_id}`, reply_to: m.message_id, text: T.breakdownHint() });
}
