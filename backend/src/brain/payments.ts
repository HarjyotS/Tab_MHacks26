// SPEC §7.6 payment links: Tab never holds or moves money. When a settle
// request goes out, each person who owes gets a DM with a Venmo or Cash App
// link for their exact amount to each person they owe. They pay in their own
// app and say so (a 👍 on the link, or "sent it"), then the person being paid
// confirms it arrived (a 👍, or "got it"). Only then is the share paid.
// PAYMENTS=simulated keeps the hackathon flow instead (a 👍 on the settle
// request runs a simulated transfer).
import * as T from "../copy/templates.js";
import { displayName, listJoin } from "../copy/format.js";
import type { PaymentProvider } from "../db/types.js";
import type { Expense, Message, Outbox, Share } from "../store/types.js";
import { activeMembers, type BrainCtx, outsideQuietHours, say, tapback } from "./context.js";
import { optedOut } from "./people.js";

export const linksMode = (ctx: BrainCtx) => (ctx.payments ?? "links") === "links";

const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

// Venmo's documented pay link: the username, txn=pay, the amount in dollars,
// and a note. Cash App takes the amount in the path and has no note.
export const venmoLink = (username: string, cents: number, note: string) =>
  `https://venmo.com/${encodeURIComponent(username)}?txn=pay&amount=${dollars(cents)}&note=${encodeURIComponent(note)}`;
export const cashAppLink = (cashtag: string, cents: number) => `https://cash.app/$${encodeURIComponent(cashtag)}/${dollars(cents)}`;

const person = (ctx: BrainCtx, group_id: string, phone: string) => ({
  phone,
  name: activeMembers(ctx, group_id).find((m) => m.phone === phone)?.name,
});

// What one person owes another across some expenses: their locked shares.
type Owe = { group_id: string; debtor: string; payee: string; items: { e: Expense; s: Share }[]; cents: number };

const lockedShares = (ctx: BrainCtx, e: Expense) =>
  ctx.store.shares(e.expense_id).filter((s) => s.role === "participant" && s.status === "locked" && s.amount_cents > 0);

// Someone who had their data deleted can't be paid or reminded (§19), so
// their debts are left out unless a caller only needs to count them.
const forgotten = (phone: string) => phone.startsWith("forgotten:");

export function owes(ctx: BrainCtx, expenses: Expense[], opts: { includeForgotten?: boolean } = {}): Owe[] {
  const out = new Map<string, Owe>();
  for (const e of expenses) {
    if (e.status !== "finalized" || !e.payer_phone) continue;
    if (!opts.includeForgotten && forgotten(e.payer_phone)) continue;
    for (const s of lockedShares(ctx, e)) {
      if (!opts.includeForgotten && forgotten(s.phone)) continue;
      const key = `${s.phone}>${e.payer_phone}`;
      const o = out.get(key) ?? { group_id: e.group_id, debtor: s.phone, payee: e.payer_phone, items: [], cents: 0 };
      o.items.push({ e, s });
      o.cents += s.amount_cents;
      out.set(key, o);
    }
  }
  return [...out.values()];
}

// What it was for: the expenses ("pizza and groceries"), or the group's name
// when there are too many to list.
function labelFor(ctx: BrainCtx, items: { e: Expense }[]): string {
  const descriptions = [...new Set(items.map((x) => x.e.description))];
  if (descriptions.length > 0 && descriptions.length <= 3) return listJoin(descriptions);
  return ctx.store.group(items[0]!.e.group_id)?.display_name ?? "the tab";
}

function linksFor(ctx: BrainCtx, payee: string, cents: number, label: string): T.PayLinks {
  const p = ctx.store.person(payee);
  return {
    venmo: p?.venmo ? venmoLink(p.venmo, cents, label) : undefined,
    cashapp: p?.cashtag ? cashAppLink(p.cashtag, cents) : undefined,
  };
}

// A transfer id per message, expense, and person who paid, without their
// number (ids show up in the web ledger's data): their place among the
// expense's participants. The module dedupes on (message, expense, person).
function transferId(ctx: BrainCtx, m: Message, e: Expense, debtor: string): string {
  const phones = ctx.store.shares(e.expense_id).filter((s) => s.role === "participant").map((s) => s.phone).sort();
  return `tr_${m.message_id}_${e.expense_id}_${phones.indexOf(debtor)}`;
}

const hasHandle = (ctx: BrainCtx, phone: string) => Boolean(ctx.store.person(phone)?.venmo || ctx.store.person(phone)?.cashtag);

// Ids carry who owes whom and on which request. Phones never contain ":" or
// "|"; request ids contain ":" but never "|", so "|" ends the request id
// and anything after it ("handle", a reminder's step) can't be mistaken for
// part of it (review: "settle_request:<exp>:<ms>" lost its ":<ms>").
export const linkId = (debtor: string, payee: string, request_id: string) => `payment_link:${debtor}:${payee}|${request_id}`;
const reminderPrefix = (debtor: string, payee: string, request_id: string) => `approval_followup:${debtor}:${payee}|${request_id}|`;
const missingId = (debtor: string, payee: string, request_id: string, message_id: string) => `payment_missing:${debtor}:${payee}|${request_id}|${message_id}`;

export function parseLinkRow(o: { action_id: string }): { debtor: string; payee: string; request_id: string } | undefined {
  const m = o.action_id.match(/^(?:payment_link|approval_followup|payment_missing):([^:|]+):([^:|]+)\|([^|]+)(?:\|.*)?$/);
  return m ? { debtor: m[1]!, payee: m[2]!, request_id: m[3]! } : undefined;
}

// ── When a settle request goes out ───────────────────────────────────────

export async function sendPaymentLinks(ctx: BrainCtx, request_id: string, expenses: Expense[]) {
  for (const o of owes(ctx, expenses)) {
    if (optedOut(ctx, o.debtor)) continue;
    const label = labelFor(ctx, o.items);
    const payeeOut = optedOut(ctx, o.payee);
    if (!hasHandle(ctx, o.payee) && !payeeOut) await askForHandle(ctx, o.payee, label);
    await say(ctx, {
      chat: { dm_phone: o.debtor },
      purpose: "payment_link",
      id: linkId(o.debtor, o.payee, request_id),
      text: T.paymentLink({
        payee: person(ctx, o.group_id, o.payee),
        amount_cents: o.cents,
        label,
        links: linksFor(ctx, o.payee, o.cents, label),
        waiting: !hasHandle(ctx, o.payee) && !payeeOut,
      }),
      expense_id: o.items.length === 1 ? o.items[0]!.e.expense_id : undefined,
    });
  }
}

// Asked once, only when someone first needs to get paid (the FAQ's promise).
async function askForHandle(ctx: BrainCtx, payee: string, label: string) {
  await say(ctx, { chat: { dm_phone: payee }, purpose: "handle_prompt", id: `handle_prompt:${payee}`, text: T.handlePrompt(label) });
}

// The most recent DM Tab sent this person, if it's one of these.
function lastDm(ctx: BrainCtx, phone: string): Outbox | undefined {
  return ctx.store
    .outbox()
    .filter((o) => o.kind === "dm" && o.to_phone === phone && o.status !== "cancelled")
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
}

// Only an explicit "@joe-smith" (Venmo) or "$joesmith" (Cash App), which is
// what Tab's question asks for. Plain words never are: "my venmo is frozen"
// would send everyone a link to a stranger (review). After Tab asked (or
// confirmed one), the token alone; otherwise only with "my venmo / cash app",
// never someone else's handle in "venmo'd @priya 20".
const AT_HANDLE = /(?:^|[\s:(])@([A-Za-z0-9_-]{5,30})(?![A-Za-z0-9_-])/;
const CASHTAG = /(?:^|[\s:(])\$([A-Za-z0-9_]{1,20})(?![A-Za-z0-9_.])/;
const MINE = /\bmy\s+(?:venmo|cash\s?app|cashtag)\b/i;
const ABOUT_HANDLES = /\b(?:venmo|cash\s?app|cashtag|handle|username)\b/i;

export function parseHandle(text: string, prompted: boolean): { venmo?: string; cashtag?: string } | undefined {
  const t = text.trim();
  if (!prompted && !MINE.test(t)) return undefined;
  const venmo = t.match(AT_HANDLE)?.[1];
  const cashtag = t.match(CASHTAG)?.[1];
  const out = {
    ...(venmo ? { venmo } : {}),
    ...(cashtag && /[A-Za-z]/.test(cashtag) ? { cashtag } : {}),
  };
  return out.venmo || out.cashtag ? out : undefined;
}

// A payee's handle: saved and said back, then everyone still owing them
// gets a link that uses it, unless their latest link already does (links
// that went out without one, or with a handle since corrected).
async function saveHandle(ctx: BrainCtx, m: Message, handle: { venmo?: string; cashtag?: string }) {
  const payee = m.sender_phone;
  await ctx.db.set_payment_handle({ phone: payee, ...handle });
  // Same purpose as the question, so "wrong? just text the right one" works.
  await say(ctx, { chat: { dm_phone: payee }, purpose: "handle_prompt", id: `handle_saved:${m.message_id}`, text: T.handleSaved(handle) });
  const now = ctx.store.person(payee);
  const quotes = (text?: string) =>
    Boolean(text && ((now?.venmo && text.includes(`venmo.com/${now.venmo}`)) || (now?.cashtag && text.includes(`cash.app/$${now.cashtag}`))));
  const latest = new Map<string, Outbox>();
  for (const o of ctx.store.outbox().filter((x) => (x.purpose === "payment_link" || x.purpose === "approval_followup") && x.status !== "cancelled")) {
    const row = parseLinkRow(o);
    if (!row || row.payee !== payee) continue;
    const key = linkId(row.debtor, row.payee, row.request_id);
    if (!latest.has(key) || latest.get(key)!.created_at <= o.created_at) latest.set(key, o);
  }
  for (const [key, row] of latest) {
    if (quotes(row.text)) continue;
    const { debtor, request_id } = parseLinkRow(row)!;
    const o = stillOwed(ctx, debtor, payee, request_id);
    if (!o) continue;
    const label = labelFor(ctx, o.items);
    await say(ctx, {
      chat: { dm_phone: debtor },
      purpose: "payment_link",
      id: `${key}|handle:${m.message_id}`,
      text: T.handleArrived({ payee: person(ctx, o.group_id, payee), amount_cents: o.cents, label, links: linksFor(ctx, payee, o.cents, label) }),
    });
  }
}

// What the debtor still owes the payee on a request, or on any locked-in
// expense in that group once a newer request has taken those over.
function stillOwed(ctx: BrainCtx, debtor: string, payee: string, request_id: string): Owe | undefined {
  const inRequest = ctx.store.expenses().filter((e) => e.settle_message_id === request_id);
  const pick = (expenses: Expense[]) => owes(ctx, expenses).find((o) => o.debtor === debtor && o.payee === payee);
  const group_id = inRequest[0]?.group_id;
  return pick(inRequest) ?? pick(group_id ? ctx.store.expenses().filter((e) => e.group_id === group_id) : ctx.store.expenses());
}

// ── Saying it's paid, and confirming it arrived ──────────────────────────

function providerFor(ctx: BrainCtx, payee: string, text?: string): PaymentProvider {
  if (text && /\bvenmo/i.test(text)) return "venmo";
  if (text && /\bcash\s?app/i.test(text)) return "cashapp";
  const p = ctx.store.person(payee);
  if (p?.venmo && !p.cashtag) return "venmo";
  if (p?.cashtag && !p.venmo) return "cashapp";
  return "other";
}

// The person who owed says it's sent: recorded as reported, then the payee
// gets one "did it come through?" DM.
async function report(ctx: BrainCtx, m: Message, o: Owe) {
  const provider = providerFor(ctx, o.payee, m.text);
  for (const { e } of o.items)
    await ctx.db.record_payment({ transfer_id: transferId(ctx, m, e, o.debtor), expense_id: e.expense_id, from_phone: o.debtor, message_id: m.message_id, provider });
  const label = labelFor(ctx, o.items);
  const payee = person(ctx, o.group_id, o.payee);
  if (m.kind === "reaction") await say(ctx, { chat: { dm_phone: o.debtor }, purpose: "other", id: `reported:${m.message_id}`, text: T.paymentReported(payee) });
  else await tapback(ctx, m, "💸");
  await say(ctx, {
    chat: { dm_phone: o.payee },
    purpose: "payment_check",
    id: `payment_check:${m.message_id}`,
    text: T.paymentCheck({ debtor: person(ctx, o.group_id, o.debtor), amount_cents: o.cents, label }),
    expense_id: o.items.length === 1 ? o.items[0]!.e.expense_id : undefined,
  });
  ctx.log("payment_reported", { message_id: m.message_id, group_id: o.group_id, provider });
}

// "did it come through?" (and its one reminder) names the report it's about.
function reportOf(o: Outbox): string | undefined {
  if (o.purpose !== "payment_check" || !o.action_id.startsWith("payment_check:")) return undefined;
  return o.action_id.slice("payment_check:".length).replace(/:again$/, "");
}

// The payee's answer to "did it come through?", for every transfer that
// report covered.
async function payeeAnswer(ctx: BrainCtx, m: Message, report_id: string, arrived: boolean) {
  const ts = ctx.store.transfers().filter((t) => t.approved_by_message_id === report_id && t.to_phone === m.sender_phone && t.status === "reported");
  if (ts.length === 0) return;
  for (const t of ts)
    if (arrived) await ctx.db.confirm_payment({ transfer_id: t.transfer_id, message_id: m.message_id });
    else await ctx.db.reject_payment({ transfer_id: t.transfer_id, message_id: m.message_id });
  if (m.kind !== "reaction") await tapback(ctx, m, arrived ? "🤑" : "like");
  if (arrived) return; // announceSettlements tells the person who paid
  const group_id = ts[0]!.group_id;
  const request_id = ctx.store.expense(ts[0]!.expense_id)?.settle_message_id ?? "none";
  await say(ctx, {
    chat: { dm_phone: ts[0]!.from_phone },
    purpose: "payment_check",
    id: missingId(ts[0]!.from_phone, m.sender_phone, request_id, m.message_id),
    text: T.paymentMissing({ payee: person(ctx, group_id, m.sender_phone), amount_cents: ts.reduce((n, t) => n + t.amount_cents, 0) }),
  });
}

// §6.2 for the DMs above: a 👍 on a link (or a reminder) says it's sent, a
// 👍 or 👎 on "did it come through?" is the payee's answer. True when the
// reaction was on one of them.
export async function routePaymentReaction(ctx: BrainCtx, m: Message, target: Outbox): Promise<boolean> {
  if (target.to_phone !== m.sender_phone) return false;
  const report_id = reportOf(target);
  if (report_id) {
    if (m.reaction === "like" || m.reaction === "dislike") await payeeAnswer(ctx, m, report_id, m.reaction === "like");
    return true;
  }
  if (target.purpose !== "payment_link" && target.purpose !== "approval_followup" && !target.action_id.startsWith("payment_missing:")) return false;
  const row = parseLinkRow(target);
  if (!row || m.reaction !== "like") return false; // a 👎 is a dispute (settle.ts)
  const o = stillOwed(ctx, row.debtor, row.payee, row.request_id);
  if (o) await report(ctx, m, o);
  return true;
}

// Short DMs that answer one of the DMs above: "sent", "paid it", "got it",
// "nope not yet", or a handle after Tab asked for one. Handled before the
// gate, like a tapback would be. True when handled.
const SENT = /^(?:ok(?:ay)?[\s,]*)?(?:just\s+)?(?:sent|paid|done|did it|venmo'?d|cash ?app'?d)(?:\s+(?:it|you|him|her|them|that))?(?:\s+(?:on|thru|through|via)\s+\S+)?[\s.!👍]*$/iu;
// Short, plain answers only: "yea not yet" or "no worries, got it!" mix both,
// and are left for a tap on the DM itself (review).
const ARRIVED = /^(?:y(?:es|ep|up|eah?|a)|got it|it came|came through|it came through|received|all good|(?:yes|yep|yeah) got it|got it thanks?|👍)[\s.!]*$/iu;
const MISSING = /^(?:no(?:pe)?|nah|not yet|(?:no|nope|nah) not yet|didn'?t get it|haven'?t gotten it|nothing yet|don'?t see it|not seeing it|👎)[\s.!]*$/iu;

export async function handlePaymentDm(ctx: BrainCtx, m: Message): Promise<boolean> {
  if (m.group_id || m.kind !== "text" || !linksMode(ctx)) return false;
  const text = (m.text ?? "").trim();
  const last = lastDm(ctx, m.sender_phone);
  const prompted = last?.purpose === "handle_prompt";
  const handle = parseHandle(text, prompted);
  if (handle) {
    await saveHandle(ctx, m, handle);
    return true;
  }
  // "venmo is joesmith" after Tab asked: one nudge toward the @ form.
  if (prompted && ABOUT_HANDLES.test(text) && !last!.action_id.startsWith("handle_format:")) {
    await say(ctx, { chat: { dm_phone: m.sender_phone }, purpose: "handle_prompt", id: `handle_format:${m.message_id}`, reply_to: m.message_id, text: T.handleFormat() });
    return true;
  }
  const asked = last && reportOf(last);
  if (asked && (ARRIVED.test(text) || MISSING.test(text))) {
    // A typed answer can only mean one payment: with several waiting on
    // them, the payee taps the DM they mean (review: Joe's "got it" marked
    // Kian paid and left Priya pending).
    const open = [...new Set(ctx.store.transfers().filter((t) => t.to_phone === m.sender_phone && t.status === "reported").map((t) => t.approved_by_message_id))];
    if (open.length > 1) {
      await say(ctx, { chat: { dm_phone: m.sender_phone }, purpose: "clarifying_question", id: `which_check:${m.message_id}`, reply_to: m.message_id, text: T.whichCheck() });
      return true;
    }
    if (open.length === 1) await payeeAnswer(ctx, m, open[0]!, ARRIVED.test(text));
    return true;
  }
  if (last && (last.purpose === "payment_link" || last.purpose === "approval_followup" || last.action_id.startsWith("payment_missing:")) && SENT.test(text)) {
    const row = parseLinkRow(last);
    const o = row && stillOwed(ctx, row.debtor, row.payee, row.request_id);
    if (!o) return false;
    await report(ctx, m, o);
    return true;
  }
  return false;
}

// The gate's payment_reported (and a typed approval) in links mode: "just
// venmo'd jake for the uber" from the person who owed, or "priya paid me"
// from the payee. Names pick who; with one person it's them.
export async function reportFromText(ctx: BrainCtx, m: Message): Promise<void> {
  const groups = m.group_id ? [m.group_id] : ctx.store.groups().map((g) => g.group_id).filter((g) => activeMembers(ctx, g).some((x) => x.phone === m.sender_phone));
  const all = groups.flatMap((g) => owes(ctx, ctx.store.expenses().filter((e) => e.group_id === g)));
  const text = m.text ?? "";
  const named = (o: Owe, phone: string) => {
    const name = person(ctx, o.group_id, phone).name;
    return Boolean(name && mentions(text, name));
  };
  // From the payee: "priya paid me", confirmed as it's said. Everything a
  // person owes them counts together (locked or already reported), and once
  // the message names someone who owes them it's the payee speaking: a
  // mismatch never falls through to the payee's own debts (review).
  const owedToMe = new Map<string, Owe>();
  for (const o of [...all, ...reportedTo(ctx, m.sender_phone, groups)].filter((x) => x.payee === m.sender_phone)) {
    const sum = owedToMe.get(o.debtor) ?? { ...o, items: [], cents: 0 };
    sum.items.push(...o.items);
    sum.cents += o.cents;
    owedToMe.set(o.debtor, sum);
  }
  const fromWhom = [...owedToMe.values()].filter((o) => named(o, o.debtor));
  // "I just sent dhanush 30 bucks" names someone who owes the sender, but
  // the money went the other way: never their payment (Vegas chat). Say so.
  const sentTo = fromWhom.filter((o) => sentToThem(text, person(ctx, o.group_id, o.debtor).name));
  if (sentTo.length > 0 && sentTo.length === fromWhom.length) {
    const o = sentTo[0]!;
    await say(ctx, {
      chat: m.group_id ? { group_id: m.group_id } : { dm_phone: m.sender_phone },
      purpose: "clarifying_question",
      id: `paid_wrong_way:${m.message_id}`,
      reply_to: m.message_id,
      text: T.paidWrongWay({ name: displayName(person(ctx, o.group_id, o.debtor)), cents: o.cents }),
    });
    return;
  }
  if (fromWhom.length > 0) {
    // "priya paid me back 25 for the concert tickets" isn't her $10 pizza share.
    const ours = fromWhom.filter((o) => !aboutSomethingElse(text, o));
    for (const o of ours)
      for (const { e } of o.items)
        await ctx.db.record_payment({ transfer_id: transferId(ctx, m, e, o.debtor), expense_id: e.expense_id, from_phone: o.debtor, message_id: m.message_id, provider: providerFor(ctx, o.payee, text) });
    if (ours.length > 0) await tapback(ctx, m, "like");
    else ctx.log("payment_not_ours", { message_id: m.message_id, group_id: m.group_id });
    return;
  }
  // From the person who owed. Debts to someone who deleted their data count
  // toward "which one?" but are never acted on.
  const mine = groups
    .flatMap((g) => owes(ctx, ctx.store.expenses().filter((e) => e.group_id === g), { includeForgotten: true }))
    .filter((o) => o.debtor === m.sender_phone);
  const toWhom = mine.filter((o) => named(o, o.payee));
  const target = toWhom.length === 1 ? toWhom[0] : mine.length === 1 ? mine[0] : undefined;
  // Only when it's for what they owe: another amount, or something else
  // ("venmo'd you 20 for the cleats" while they owe $17.40 for groceries),
  // is a payment Tab doesn't track (noise eval).
  if (target && !forgotten(target.payee) && !aboutSomethingElse(text, target)) return report(ctx, m, target);
  if (target) return ctx.log("payment_not_ours", { message_id: m.message_id, group_id: target.group_id });
  const options = (toWhom.length > 1 ? toWhom : mine).filter((o) => !forgotten(o.payee));
  if (options.length > 1) {
    const who = options.map((o) => person(ctx, o.group_id, o.payee));
    await say(ctx, { chat: m.group_id ? { group_id: m.group_id } : { dm_phone: m.sender_phone }, purpose: "clarifying_question", id: `which_payee:${m.message_id}`, reply_to: m.message_id, text: T.whichPayee(who) });
  }
}

// "ok everyone paid", "it's all been settled", "everyone paid we are good":
// from someone people owe, everyone paid them back (Vegas chat: Harjyot said
// it three times and the balances never moved, since only "priya paid me"
// with a name counted). It's recorded the same way, confirmed as it's said,
// and only for what's owed to the sender: nobody can say someone else got
// paid. A disputed share counts too: the person owed says it's paid.
const WHO_ALL = String.raw`(?:every(?:one|body)|y'?all|you all|they all|all of (?:you|them|us)|the whole group)(?:'s)?`;
const EVERYONE_PAID = new RegExp(
  [
    String.raw`\b${WHO_ALL}\s+(?:(?:has|have|already|just|all|finally)\s+)*(?:paid|payed|venmo'?d|venmoed|zelle'?d|settled|squared)\b`,
    String.raw`\b${WHO_ALL}\s+(?:(?:has|have|already|just|all)\s+)*sent\s+(?:it|me|theirs|their (?:part|share|money))\b`,
    String.raw`\b(?:it'?s|its|it has|that'?s)\s+all\s+(?:been\s+)?(?:settled|squared|paid)\b`,
    String.raw`\b(?:we'?re|we are|we have|we'?ve)\s+(?:all\s+)?(?:been\s+)?(?:settled|squared)\b`,
    String.raw`\beverything(?:'s| is| has been|'s been)\s+(?:settled|squared|paid)\b`,
    String.raw`\b(?:every(?:one|body)(?:'s| is)|we'?re all|we are all)\s+(?:square|even|paid up|settled up)\b`,
    String.raw`\b(?:nobody|no ?one) owes (?:me )?(?:anything|nothing|money)\b`,
    String.raw`\ball (?:settled|squared)\b`,
  ].join("|"),
  "i",
);
// A question ("has everyone paid?"), a plan ("once everyone pays"), a "not
// yet", everyone paying their own way, or settling somewhere else ("we're
// all settled in at the hotel"): none of those paid the sender.
const NOT_DONE = /\?|^\s*(?:has|have|did|is|are|was|were)\b|\b(?:not|never|yet|if|once|when|until|unless|before|almost|nearly|hopefully|should|will|gonna|soon|own|separately|themselves|individually)\b|n't\b|\b(?:settled|squared)\s+(?:in|on|into|down|for|at|with)\b|\bpaid attention\b/i;

export async function handleEveryonePaid(ctx: BrainCtx, m: Message): Promise<boolean> {
  const text = m.text ?? "";
  if (m.kind !== "text" || !linksMode(ctx) || !EVERYONE_PAID.test(text) || NOT_DONE.test(text)) return false;
  const mine = m.group_id ? [m.group_id] : ctx.store.groups().map((g) => g.group_id).filter((g) => activeMembers(ctx, g).some((x) => x.phone === m.sender_phone));
  // Naming someone ("everyone paid joe back", "just venmo'd joe, we're all
  // settled") is about them, so reportFromText reads it. And someone who
  // still owes may mean they paid: never everyone paying them (review).
  const others = mine.flatMap((g) => activeMembers(ctx, g)).filter((x) => x.phone !== m.sender_phone && x.name);
  if (others.some((x) => mentions(text, x.name!)) || stillOwes(ctx, m.sender_phone, mine)) return false;
  const ours = owedTo(ctx, m.sender_phone, mine).filter((o) => !forgotten(o.debtor) && !aboutSomethingElse(text, o));
  if (ours.length === 0) return false;
  // By DM it could be any of their groups: only one owes them, or Tab asks.
  const groups = [...new Set(ours.map((o) => o.group_id))];
  if (!m.group_id && groups.length > 1) {
    const names = groups.map((g) => ctx.store.group(g)?.display_name?.toLowerCase() ?? "your other group");
    await say(ctx, { chat: { dm_phone: m.sender_phone }, purpose: "clarifying_question", id: `everyone_paid_which:${m.message_id}`, reply_to: m.message_id, text: T.everyonePaidWhich(names) });
    return true;
  }
  for (const o of ours)
    for (const { e } of o.items)
      await ctx.db.record_payment({ transfer_id: transferId(ctx, m, e, o.debtor), expense_id: e.expense_id, from_phone: o.debtor, message_id: m.message_id, provider: providerFor(ctx, o.payee, text) });
  // 🎉 when nobody owes them anything now, else 🤑 (someone's share wasn't locked in yet).
  await tapback(ctx, m, owedTo(ctx, m.sender_phone, groups).length === 0 ? "🎉" : "🤑");
  ctx.log("everyone_paid", { message_id: m.message_id, group_id: m.group_id, people: ours.length });
  return true;
}

const mentions = (text: string, name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

// Whether this person owes anyone in these groups, or said they paid and
// is waiting on the payee's word.
function stillOwes(ctx: BrainCtx, phone: string, groups: string[]): boolean {
  return ctx.store.expenses().some(
    (e) =>
      e.status === "finalized" && groups.includes(e.group_id) && e.payer_phone !== phone &&
      ctx.store.shares(e.expense_id).some((s) => s.phone === phone && s.role === "participant" && s.amount_cents > 0 && ["locked", "disputed", "approved"].includes(s.status)),
  );
}

// Everything each person owes this payee in these groups: locked shares,
// disputed ones, and ones reported and waiting on the payee's word.
function owedTo(ctx: BrainCtx, payee: string, groups: string[]): Owe[] {
  const out = new Map<string, Owe>();
  const add = (group_id: string, debtor: string, e: Expense, s: Share) => {
    if (debtor === payee) return;
    const key = `${group_id}\n${debtor}`;
    const o = out.get(key) ?? { group_id, debtor, payee, items: [], cents: 0 };
    o.items.push({ e, s });
    o.cents += s.amount_cents;
    out.set(key, o);
  };
  for (const e of ctx.store.expenses()) {
    if (e.status !== "finalized" || e.payer_phone !== payee || !groups.includes(e.group_id)) continue;
    for (const s of ctx.store.shares(e.expense_id))
      if (s.role === "participant" && s.amount_cents > 0 && (s.status === "locked" || s.status === "disputed")) add(e.group_id, s.phone, e, s);
  }
  for (const o of reportedTo(ctx, payee, groups)) for (const { e, s } of o.items) add(o.group_id, o.debtor, e, s);
  return [...out.values()];
}

// "sent dhanush 30", "paid dhanush back", "venmo'd dhanush": money from the
// sender to that person, the opposite of "dhanush paid me".
function sentToThem(text: string, name: string | undefined): boolean {
  if (!name) return false;
  const who = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:sent|send|paid|pay|payed|venmo'?d|venmoed|zelle'?d|zelled|cash ?app'?d|gave|give|transferred|wired)\\s+(?:it\\s+)?(?:to\\s+)?${who}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

// A stated amount that isn't what they owe, or "for the X" naming none of
// the expenses it would cover. "for my half", "for everything" are fine.
const STATED = /\$\s?(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:bucks|dollars)?\b/i;
const FOR_WHAT = /\bfor\s+(?:the\s+|my\s+|our\s+)?([a-z][a-z' ]{1,30})/i;
const GENERIC = /^(?:half|share|part|portion|everything|all|it|that|this|tab|stuff|last night|this week|today|yesterday)\b/i;

function aboutSomethingElse(text: string, o: Owe): boolean {
  const amount = text.match(STATED);
  const cents = amount ? Math.round(Number(amount[1] ?? amount[2]) * 100) : undefined;
  if (cents !== undefined && cents !== o.cents) return true;
  const what = text.match(FOR_WHAT)?.[1]?.trim();
  if (!what || GENERIC.test(what)) return false;
  const words = (what.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !["the", "and", "for", "you", "your"].includes(w));
  return words.length > 0 && !o.items.some(({ e }) => words.some((w) => e.description.toLowerCase().includes(w.replace(/s$/, ""))));
}

// Shares already reported to this payee and waiting on their word, as Owes,
// so "priya paid me" settles those too.
function reportedTo(ctx: BrainCtx, payee: string, groups: string[]): Owe[] {
  const out = new Map<string, Owe>();
  for (const t of ctx.store.transfers()) {
    if (t.to_phone !== payee || t.status !== "reported" || !groups.includes(t.group_id)) continue;
    const e = ctx.store.expense(t.expense_id);
    const s = e && ctx.store.shares(e.expense_id).find((x) => x.phone === t.from_phone);
    if (!e || !s) continue;
    const key = `${t.from_phone}>${payee}`;
    const o = out.get(key) ?? { group_id: t.group_id, debtor: t.from_phone, payee, items: [], cents: 0 };
    o.items.push({ e, s });
    o.cents += s.amount_cents;
    out.set(key, o);
  }
  return [...out.values()];
}

// A typed "yes" to the settle request in links mode: the link is the way.
export async function linkHint(ctx: BrainCtx, m: Message) {
  if (!ctx.store.outbox().some((o) => o.purpose === "payment_link" && o.to_phone === m.sender_phone)) return;
  await say(ctx, { chat: m.group_id ? { group_id: m.group_id } : { dm_phone: m.sender_phone }, purpose: "clarifying_question", id: `link_hint:${m.message_id}`, reply_to: m.message_id, text: T.linkHint() });
}

// ── Reminders, privately (FAQ: never in front of the group) ──────────────

// People who still owe on a request get a DM with their link on the claim
// nudge schedule; after the last one the balance just stays on the tab. A
// payee who hasn't answered "did it come through?" gets one reminder.
export async function paymentReminders(ctx: BrainCtx) {
  const now = ctx.now();
  const d = ctx.timing.durations;
  const schedule = [d.FOLLOWUP_DM1_AFTER, d.FOLLOWUP_DM1_AFTER + d.FOLLOWUP_DM2_AFTER, d.FOLLOWUP_DM3_AFTER];
  const outbox = ctx.store.outbox();
  for (const request of outbox.filter((o) => o.purpose === "settle_request" && o.status !== "cancelled" && o.group_id)) {
    const tz = ctx.store.group(request.group_id!)?.timezone ?? "America/Detroit";
    const covered = ctx.store.expenses().filter((e) => e.settle_message_id === request.action_id);
    for (const o of owes(ctx, covered)) {
      if (optedOut(ctx, o.debtor)) continue;
      const prefix = reminderPrefix(o.debtor, o.payee, request.action_id);
      const step = outbox.filter((x) => x.action_id.startsWith(prefix)).length;
      const due = schedule[step];
      if (due === undefined || now.getTime() < request.created_at.getTime() + due) continue;
      const label = labelFor(ctx, o.items);
      await say(ctx, {
        chat: { dm_phone: o.debtor },
        purpose: "approval_followup",
        id: `${prefix}${step + 1}`,
        text: T.paymentReminder({ seed: prefix, payee: person(ctx, o.group_id, o.payee), amount_cents: o.cents, label, links: linksFor(ctx, o.payee, o.cents, label), step: (step + 1) as 1 | 2 | 3 }),
        send_after: outsideQuietHours(ctx, now, tz),
      });
    }
  }
  for (const check of outbox.filter((o) => reportOf(o) !== undefined && !o.action_id.endsWith(":again"))) {
    const report_id = reportOf(check)!;
    const waiting = ctx.store.transfers().filter((t) => t.approved_by_message_id === report_id && t.status === "reported");
    const id = `payment_check:${report_id}:again`;
    if (waiting.length === 0 || outbox.some((x) => x.action_id === id) || now.getTime() < check.created_at.getTime() + d.FOLLOWUP_DM2_AFTER) continue;
    const t = waiting[0]!;
    // The module skips DMs to someone who texted STOP; asking every tick would never end.
    if (optedOut(ctx, t.to_phone)) continue;
    await say(ctx, {
      chat: { dm_phone: t.to_phone },
      purpose: "payment_check",
      id,
      text: T.paymentCheckReminder({ debtor: person(ctx, t.group_id, t.from_phone), amount_cents: waiting.reduce((n, x) => n + x.amount_cents, 0) }),
      send_after: outsideQuietHours(ctx, now, ctx.store.group(t.group_id)?.timezone ?? "America/Detroit"),
    });
  }
}
