// SPEC §7.3 text expenses and §7.5 custom splits and opt-outs.
import type {
  ExpenseExtraction,
  Extracted,
  Problem,
} from "../extraction/types.js";
import type { Person } from "../copy/format.js";
import * as T from "../copy/templates.js";
import type { Expense, LineItem, Message, Share } from "../store/types.js";
import {
  activeMembers,
  chatOf,
  outsideQuietHours,
  say,
  tapback,
  type BrainCtx,
  type Pending,
} from "./context.js";
import { extractInput } from "./inputs.js";
import { startItemizing } from "./receipt.js";
import { acceptSplit } from "./settle.js";
import { addInvite, addThread, closeExpenseThreads, openThreads } from "./threads.js";

export const expenseIdFor = (source_message_id: string) =>
  `exp_${source_message_id}`;

const people = (ctx: BrainCtx, group_id: string): Person[] =>
  activeMembers(ctx, group_id).map((m) => ({ phone: m.phone, name: m.name }));

// The group an expense belongs to. In a DM, the sender's only group.
export function groupFor(ctx: BrainCtx, m: Message): string | undefined {
  if (m.group_id) return m.group_id;
  const mine = ctx.store
    .groups()
    .filter((g) =>
      activeMembers(ctx, g.group_id).some((x) => x.phone === m.sender_phone),
    );
  return mine.length === 1 ? mine[0]!.group_id : undefined;
}

// Ask the first problem as one short question (P2/P3) and remember it.
async function ask(
  ctx: BrainCtx,
  m: Message,
  problems: Problem[],
  pending: Pending,
  description?: string,
) {
  const group_id = groupFor(ctx, m);
  const problem = problems[0]!;
  const who = group_id ? people(ctx, group_id) : [];
  const q = T.clarifyingQuestion(problem, { description, people: who });
  const id = `clarify:${m.message_id}`;
  const expense_id = "expense_id" in pending ? pending.expense_id : undefined;
  // Their share now, as an example amount if Tab has to ask again.
  const example_cents =
    problem.kind === "missing_item_price" && expense_id
      ? ctx.store.shares(expense_id).find((s) => s.phone === problem.phone && s.status !== "opted_out")?.amount_cents
      : undefined;
  const sent = await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id, reply_to: m.message_id,
    text: q,
    expense_id,
    rephrase: T.rephraseQuestion(problem, { description, people: who, example_cents }),
  });
  // Asked already (say): nothing goes out, but the open question now
  // carries this message, so the answer applies to the newest change.
  if (sent) await tapback(ctx, m, "question");
  // A missing fact (who paid, how much) anyone in the chat may know; a
  // confirmation is only the sender's to give.
  addThread(ctx, chatOf(m), {
    id,
    text: q,
    expense_id,
    who: pending.kind === "confirm" ? "asker" : "anyone",
    asker: m.sender_phone,
    data: pending,
  });
}

// Problems Tab can't resolve by asking for a missing fact.
const CONFIRM = new Set<Problem["kind"]>(["large_amount"]);

// SPEC §7.3: extract, validate, then propose or ask.
export async function handleExpense(
  ctx: BrainCtx,
  m: Message,
  text = m.text ?? "",
  source: Message = m,
  opts: { senderPaid?: boolean } = {},
): Promise<void> {
  const group_id = groupFor(ctx, source);
  if (!group_id) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: T.postInGroup(m.message_id),
    });
    return;
  }
  const extracted = await ctx.extract.expense(
    extractInput(ctx, { ...source, text }),
    "new",
  );
  if (!extracted.result.is_expense) return; // Not a purchase after all: stay silent (P1).
  // "ice cream was 50" → "want me to split that?" → "yeah": whoever said it
  // and wants it split is the one who paid. One question, not two
  // (playground run); "no, alex paid" is still a correction away.
  if (opts.senderPaid && extracted.result.payer.kind === "unknown") {
    extracted.result = { ...extracted.result, payer: { kind: "sender" }, missing: extracted.result.missing.filter((x) => x !== "payer") };
    extracted.problems = extracted.problems.filter((p) => p.kind !== "missing_payer");
  }
  const { result, problems } = extracted;
  const expense_id = expenseIdFor(source.message_id);

  // Always keep a needs_info row while Tab asks, so the ledger shows it.
  // The module accepts a $0 total for needs_info (Kian's #16).
  if (problems.length > 0) {
    await upsertNeedsInfo(ctx, { expense_id, group_id, source, result });
    if (problems.every((p) => CONFIRM.has(p.kind))) {
      await ask(
        ctx,
        m,
        problems,
        {
          kind: "confirm",
          then: "large_amount",
          source,
          extraction: extracted,
          expense_id,
          asked_at: ctx.now(),
        },
        result.description,
      );
    } else {
      await ask(
        ctx,
        m,
        problems,
        {
          kind: "expense",
          source,
          text,
          problems,
          expense_id,
          asked_at: ctx.now(),
        },
        result.description,
      );
    }
    return;
  }
  await proposeNew(ctx, { group_id, source, extracted });
}

async function upsertNeedsInfo(
  ctx: BrainCtx,
  a: {
    expense_id: string;
    group_id: string;
    source: Message;
    result: ExpenseExtraction;
  },
) {
  await ctx.db.upsert_expense({
    expense_id: a.expense_id,
    group_id: a.group_id,
    payer_phone: payerPhone(a.result, a.source),
    description: a.result.description ?? "Expense",
    source_message_id: a.source.message_id,
    split_mode: "even",
    status: "needs_info",
    tax_cents: 0,
    tip_cents: 0,
    fees_cents: 0,
    discount_cents: 0,
    total_cents: a.result.amount_cents ?? 0,
  });
}

function payerPhone(r: ExpenseExtraction, source: Message): string | undefined {
  if (r.payer.kind === "sender") return source.sender_phone;
  if (r.payer.kind === "member") return r.payer.phone;
  return undefined;
}

// Create the expense, its shares, and post the proposal (§7.3 steps 3–6).
export async function proposeNew(
  ctx: BrainCtx,
  a: {
    group_id: string;
    source: Message;
    extracted: Extracted<ExpenseExtraction>;
  },
) {
  const { result } = a.extracted;
  const payer = payerPhone(result, a.source)!;
  const expense_id = expenseIdFor(a.source.message_id);
  const members = activeMembers(ctx, a.group_id);
  const included = new Set(
    result.participants.kind === "list"
      ? result.participants.phones
      : members.map((x) => x.phone),
  );
  for (const p of result.exclusions) included.delete(p);
  const fixed = new Map(result.fixed.map((f) => [f.phone, f.amount_cents]));
  const group = ctx.store.group(a.group_id);
  const deadline = outsideQuietHours(
    ctx,
    new Date(ctx.now().getTime() + ctx.timing.durations.OBJECTION_WINDOW),
    group?.timezone ?? "America/Detroit",
  );

  await ctx.db.upsert_expense({
    expense_id,
    group_id: a.group_id,
    payer_phone: payer,
    description: result.description ?? "Expense",
    source_message_id: a.source.message_id,
    split_mode: [...fixed.values()].some((v) => v !== undefined)
      ? "custom"
      : "even",
    status: "proposed",
    tax_cents: 0,
    tip_cents: 0,
    fees_cents: 0,
    discount_cents: 0,
    total_cents: result.amount_cents!,
    objection_deadline: deadline,
  });
  // The payer always has a share (what they consumed); everyone else either
  // participates or is opted out, so the ledger shows who was left out.
  // People in the split first: the module recomputes on every set_share and
  // refuses an expense whose only share so far is opted out (playground:
  // "sam owes me 15 for the tickets" failed when the payer came first).
  const inFirst = [...members].sort((x, y) => Number(included.has(y.phone)) - Number(included.has(x.phone)));
  for (const m of inFirst) {
    await ctx.db.set_share({
      expense_id,
      phone: m.phone,
      role: m.phone === payer ? "payer" : "participant",
      status: included.has(m.phone) ? "proposed" : "opted_out",
      fixed_cents: fixed.get(m.phone),
      responded: m.phone === payer,
      followup_count: 0,
    });
  }
  if (group?.onboarding_status === "pending")
    await ctx.db.set_group_status({ group_id: a.group_id, status: "active" });
  await tapback(ctx, a.source, "like", expense_id);
  await postProposal(ctx, expense_id, false);
}

// For "just you and Priya on Pizza then?": who an opt-out-only change
// leaves on the split, or who it drops when that's the shorter list. Names
// only, from members (P3); the sender is "you". Empty when the change pins
// amounts, which the plain question covers.
function whoIsLeft(
  ctx: BrainCtx,
  expense: Expense,
  result: { exclusions: string[]; fixed: unknown[] },
  sender: string,
): { only?: string[]; without?: string[] } {
  if (result.fixed.length > 0 || result.exclusions.length === 0) return {};
  const members = activeMembers(ctx, expense.group_id);
  const label = (phone: string) =>
    phone === sender ? "you" : members.find((x) => x.phone === phone)?.name;
  const named = (phones: string[]) => {
    const names = phones.map(label);
    return names.every((n): n is string => Boolean(n))
      ? [...names.filter((n) => n === "you"), ...names.filter((n) => n !== "you")]
      : undefined;
  };
  const left = liveShares(ctx, expense.expense_id)
    .map((s) => s.phone)
    .filter((p) => !result.exclusions.includes(p));
  if (left.length === 0) return {};
  if (left.length <= 3) {
    const only = named(left);
    if (only) return { only };
  }
  const without = named(result.exclusions);
  return without ? { without } : {};
}

export function liveShares(ctx: BrainCtx, expense_id: string): Share[] {
  return ctx.store.shares(expense_id).filter((s) => s.status !== "opted_out");
}

export async function postProposal(
  ctx: BrainCtx,
  expense_id: string,
  updated: boolean,
) {
  const e = ctx.store.expense(expense_id);
  if (!e) throw new Error(`expense ${expense_id} not visible after write`);
  const members = activeMembers(ctx, e.group_id);
  const shares = liveShares(ctx, expense_id).map((s) => ({
    person: {
      phone: s.phone,
      name: members.find((m) => m.phone === s.phone)?.name,
    },
    amount_cents: s.amount_cents,
  }));
  // Updated proposals get a fresh id per version so each one is sent.
  const version = updated ? `:${ctx.now().getTime()}` : "";
  const id = `split_proposal:${expense_id}${version}`;
  const text = T.splitProposal({
    seed: expense_id,
    description: e.description,
    total_cents: e.total_cents,
    shares,
    updated,
  });
  await say(ctx, {
    chat: { group_id: e.group_id },
    purpose: "split_proposal",
    id,
    text,
    expense_id,
    // The first proposal answers the expense message; updates aren't answers.
    reply_to: updated ? undefined : e.source_message_id,
  });
  // "Anything uneven, or anyone not there?": open while it's proposed.
  addInvite(ctx, { group_id: e.group_id }, { id, text, kind: "split_open", expense_id });
}

// SPEC §7.5: "not even, John only had a Diet Coke", "I wasn't there".
export async function handleAdjustment(
  ctx: BrainCtx,
  m: Message,
  text = m.text ?? "",
  target?: Expense,
  // The gate was unsure (§6.4 clarify band): explain or confirm, never apply.
  opts: { confirmOnly?: boolean } = {},
): Promise<void> {
  const group_id = groupFor(ctx, m);
  // "the pool cabana was just tanuj and joe": the expense it names, even an
  // older locked-in one, before the newest open one (live run).
  const said = text.toLowerCase();
  const named = target
    ? undefined
    : ctx.store
        .expenses()
        .filter((e) => e.group_id === group_id && (e.status === "proposed" || e.status === "finalized") && e.description.length >= 4 && said.includes(e.description.toLowerCase()))
        .sort((x, y) => y.created_at.getTime() - x.created_at.getTime())[0];
  const expense =
    target ?? named ?? latestOpen(ctx, group_id, ["proposed"]) ?? latestOpen(ctx, group_id, ["finalized"]);
  if (!expense) return;
  // §7.7: a locked-in expense changes only while no money is moving.
  const locked = expense.status === "finalized";
  if (locked && moneyMoving(ctx, expense)) {
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id: `clarify:${m.message_id}`, reply_to: m.message_id,
      text: T.cantChangePaid(expense.description),
      expense_id: expense.expense_id,
    });
    return;
  }
  const extracted = await ctx.extract.expense(
    extractInput(ctx, { ...m, text }),
    "adjustment",
  );
  let { result, problems } = priceChange(ctx, expense, extracted);
  // "just tanuj and joe" says who was in it, not what they had: everyone
  // else is out, and nobody needs a price ("how much was Joe's pool cabana?").
  if (PRESENCE.test(text) && result.fixed.length > 0 && result.fixed.every((f) => f.amount_cents === undefined)) {
    const inIt = new Set(result.fixed.map((f) => f.phone));
    const out = activeMembers(ctx, expense.group_id).map((x) => x.phone).filter((p) => !inIt.has(p));
    result = { ...result, fixed: [], exclusions: [...new Set([...result.exclusions, ...out])] };
    problems = problems.filter((p) => p.kind !== "missing_item_price");
  }
  const unknown = problems.filter(
    (p) => p.kind === "unknown_name" || p.kind === "missing_item_price",
  );
  if (unknown.length > 0) {
    await holdOpen(ctx, expense);
    await ask(
      ctx,
      m,
      unknown,
      {
        kind: "adjustment",
        source: m,
        text,
        expense_id: expense.expense_id,
        problems: unknown,
        asked_at: ctx.now(),
      },
      expense.description,
    );
    return;
  }
  if (result.exclusions.length === 0 && result.fixed.length === 0) {
    // "yeah", "split 4 ways", "it's even": agreement is never an objection
    // (Harjyot's playground: "yeah" got "ok what was uneven?").
    if (agreesWithSplit(ctx, m.text ?? "", expense)) return keepSplit(ctx, m, expense, true);
    // "not even" with no specifics (§7.5): a receipt switches to itemizing;
    // a text expense asks what's uneven and stays proposed.
    if (ctx.store.lineItems(expense.expense_id).length > 0) {
      await tapback(ctx, m, "like", expense.expense_id);
      await startItemizing(ctx, expense);
      return;
    }
    // Asked already and still nothing specific: the split stands. Tab never
    // asks the same thing twice in a row (playground: it looped).
    if (askingWhatsUneven(ctx, m, expense)) return keepSplit(ctx, m, expense, false);
    await holdOpen(ctx, expense);
    const id = `clarify:${m.message_id}`;
    await tapback(ctx, m, "question", expense.expense_id);
    await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id, reply_to: m.message_id,
      text: T.whatsUneven(),
      expense_id: expense.expense_id,
    });
    addInvite(ctx, chatOf(m), { id, text: `${expense.description}: ${T.whatsUneven()}`, kind: "adjust_open", expense_id: expense.expense_id });
    return;
  }
  // A pinned amount can't exceed what was spent (the split math would fail).
  const base = expense.subtotal_cents ?? expense.total_cents;
  const pinned = result.fixed.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0);
  if (pinned > base) {
    const who = result.fixed.find((f) => f.amount_cents !== undefined)!;
    const name = activeMembers(ctx, expense.group_id).find((x) => x.phone === who.phone)?.name ?? "they";
    await holdOpen(ctx, expense);
    const id = `clarify:${m.message_id}`;
    const text = T.pinnedOverTotal({ total_cents: base, name });
    const sent = await say(ctx, {
      chat: chatOf(m),
      purpose: "clarifying_question",
      id, reply_to: m.message_id,
      text,
      expense_id: expense.expense_id,
    });
    if (sent) await tapback(ctx, m, "question", expense.expense_id);
    addInvite(ctx, chatOf(m), { id, text, kind: "adjust_open", expense_id: expense.expense_id });
    return;
  }
  // Only says what the split already is ("me and jordan had the other half"
  // right after Priya's half): nothing to change, so nothing to confirm.
  if (changesNothing(ctx, expense, result, text)) return keepSplit(ctx, m, expense, true);
  // Reopening a locked-in expense is always confirmed first.
  // A locked-in expense named outright, by someone the gate is sure about, just changes.
  if (opts.confirmOnly || (locked && !named)) {
    const question = locked
      ? T.reopenToChange(expense.description)
      : T.confirmSplitChange({ description: expense.description, ...whoIsLeft(ctx, expense, result, m.sender_phone) });
    await holdOpen(ctx, expense);
    const id = `clarify:${m.message_id}`;
    const sent = await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id, reply_to: m.message_id, text: question, expense_id: expense.expense_id });
    if (sent) await tapback(ctx, m, "question", expense.expense_id);
    addThread(ctx, chatOf(m), {
      id,
      text: question,
      expense_id: expense.expense_id,
      who: "asker",
      asker: m.sender_phone,
      data: { kind: "confirm", then: "adjustment", source: m, extraction: { result, problems }, expense_id: expense.expense_id, asked_at: ctx.now() },
    });
    return;
  }
  await tapback(ctx, m, "like", expense.expense_id);
  await applyAdjustment(ctx, expense, result);
}

// §7.5: while Tab is asking about a proposed split, it must not lock in
// under the question (Harjyot's playground: the bistro locked with Alex and
// Sam still on it, 6 seconds after "How much was Priya's 2 soft drinks?").
// Every caller then opens a thread about the expense, which tick sees
// (holdsLockIn); this also pushes the deadline past the answer.
async function holdOpen(ctx: BrainCtx, expense: Expense) {
  if (expense.status !== "proposed") return;
  const until = ctx.now().getTime() + ctx.timing.durations.OBJECTION_EXTENSION;
  if ((expense.objection_deadline?.getTime() ?? 0) >= until) return;
  await ctx.db.upsert_expense({ ...expense, objection_deadline: new Date(until) });
}

// "the other half" / "the rest": the first part already belongs to someone.
const COMPLEMENT = /\b(other half|the other|the rest|rest of it|remaining)\b/i;

function changesNothing(ctx: BrainCtx, e: Expense, result: ExpenseExtraction, text = ""): boolean {
  const shares = ctx.store.shares(e.expense_id);
  const share = (phone: string) => shares.find((s) => s.phone === phone);
  return (
    // Someone left out of "me and jordan had the other half" who already has
    // the first half (Priya's pinned $24) isn't being counted out.
    result.exclusions.every((p) => share(p)?.status === "opted_out" || (share(p)?.fixed_cents != null && COMPLEMENT.test(text))) &&
    result.fixed.every((f) => {
      const s = share(f.phone);
      // Fixed already, or what their even share already comes to ("me and
      // jordan had the other half" while the rest is split between them).
      return f.amount_cents !== undefined && s !== undefined && s.status !== "opted_out" &&
        (s.fixed_cents === f.amount_cents || (s.fixed_cents === undefined && s.amount_cents === f.amount_cents));
    })
  );
}

// "What's uneven?" (or "what's off?") about this expense, still open here.
function askingWhatsUneven(ctx: BrainCtx, m: Message, e: Expense): boolean {
  return openThreads(ctx, chatOf(m)).some((t) => t.data.kind === "adjust_open" && t.expense_id === e.expense_id);
}

// The split stands as proposed (§7.5): Tab likes the message and stops
// asking what's uneven. Someone who agreed has responded, the same as a 👍
// on the proposal from them (§6.2); "it just wasn't" changes nothing.
export async function keepSplit(ctx: BrainCtx, m: Message, e: Expense, agreed: boolean): Promise<void> {
  closeExpenseThreads(ctx, e.expense_id, ["adjust_open"]);
  await tapback(ctx, m, "like", e.expense_id);
  if (agreed && ctx.store.expense(e.expense_id)?.status === "proposed") await acceptSplit(ctx, e, m.sender_phone);
}

// "just me and priya", "only sam and alex went", "priya and I went, no one
// else", "jordan didn't come": who was there, said to an open split.
export const PRESENCE =
  /\b(just|only)\s+\w+\s+(and|&)\s+\w+|\b(no ?one|nobody) else\b|\b(didn'?t|did not|wasn'?t|weren'?t)\s+(go|come|there|in)\b|\bskipped\b/i;

// Words that say what to change (§7.5): who had what, who wasn't there,
// who owes more, or a plain "update it". "got it" is just agreement.
const CHANGE_WORDS =
  /\b(update|change|fix|redo|adjust|edit|recalc\w*|had|has|have|only|just|but|except|without|minus|instead|between|didn'?t|did not|wasn'?t|was not|weren'?t|isn'?t|not|uneven|wrong|off|skip(ped)?|left|out|mine|owes?|owed|paid|pay(ing)?|cover(ed|ing)?|more|less|extra|separate(ly)?|bucks?|dollars?)\b|\bgot\b(?!\s+(it|you|u)\b)|👎/i;
// A question or a pause is neither agreement nor a change.
const HESITANT = /\?|❓|^(what|why|how|who|wait|hold on|hang on|hm+|huh|idk|um+|uh+)\b|\b(wait|not sure|idk)\b/i;
const WAYS = /\b(?:split\s+)?(?:it\s+)?(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+ways\b/gi;
const COUNT: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether a message to an open split says something to change: a name, who
// was there, an amount or a fraction, or what someone had. "split 4 ways"
// says what it already is; "split 3 ways" doesn't.
export function changesSplit(ctx: BrainCtx, text: string, e: Expense): boolean {
  const live = liveShares(ctx, e.expense_id).length;
  const rest = text.replace(WAYS, (all, n: string) => ((Number(n) || COUNT[n.toLowerCase()]) === live ? " " : all));
  if (new RegExp(WAYS.source, "i").test(rest)) return true;
  if (/\d|\$/.test(rest) || PRESENCE.test(rest) || CHANGE_WORDS.test(rest) || fractionIn(rest)) return true;
  // "priyas" names Priya too.
  return activeMembers(ctx, e.group_id).some((x) => x.name && new RegExp(`\\b${escapeRe(x.name)}('?s)?\\b`, "i").test(rest));
}

// Agreement with an open split: anything with nothing to change that isn't
// a question ("yeah", "ok", "looks right", "even split", "nvm it's fine",
// "split 4 ways" when it is, 👍). Decided in code, whatever Grok read.
export function agreesWithSplit(ctx: BrainCtx, text: string, e: Expense): boolean {
  const t = text.trim();
  return t.length > 0 && !HESITANT.test(t) && !changesSplit(ctx, t, e);
}

// §7.5 fractional shares, read in code (P6): "half", "a third", "two
// thirds", "75%", "1/3". "the rest" and "the other half" are what's left
// after the fixed shares, for the people who said it.
type Fraction = { num: number; den: number } | "rest";
const DENOMINATOR: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
};
const NUMERATOR: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const REST = /\b(the\s+)?(rest|remainder|remaining|other\s+half|leftovers?)\b/i;
const PERCENT = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/i;
const SLASH = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/;
const PART = /\b(?:(a|an|one|two|three|four|\d)[\s-]+)?(half|halves|thirds?|quarters?|fourths?|fifths?)\b/i;

export function fractionIn(text: string): Fraction | undefined {
  if (REST.test(text)) return "rest";
  const pct = text.match(PERCENT);
  const slash = text.match(SLASH);
  const part = text.match(PART);
  const f = pct
    ? { num: Number(pct[1]), den: 100 }
    : slash
      ? { num: Number(slash[1]), den: Number(slash[2]) }
      : part
        ? { num: part[1] ? (NUMERATOR[part[1].toLowerCase()] ?? Number(part[1])) : 1, den: DENOMINATOR[part[2]!.toLowerCase()]! }
        : undefined;
  return f && f.num > 0 && f.den > 0 && f.num <= f.den ? f : undefined;
}

// Words that mean the whole expense ("half of the cost", "a third of it"),
// and the fraction words themselves.
const WHOLE = new Set(["it", "bill", "cost", "total", "check", "tab", "everything", "thing", "whole", "order", "price", "amount", "food", "share", "part", "portion", "lot"]);
const COUNTED = /^\s*(the\s+)?(a|an|one|two|three|four|five|six|both|\d+)\b/i;
const FRACTION_WORDS = new Set(["half", "halve", "third", "quarter", "fourth", "fifth", "percent", "rest", "remainder", "remaining", "other", "leftover"]);

// Whether what someone had is the expense itself, or a fraction of it:
// "half of the pizza" or "the pizzas" on Pizza, "half", "a third of it".
// Not "half of the fries" on Dinner, nor "the pizza" on "Pizza and wings":
// those need a price.
function ofTheExpense(item: string, description: string): boolean {
  const own = words(description);
  const said = words(item).filter((w) => !WHOLE.has(w) && !FRACTION_WORDS.has(w));
  if (!said.every((w) => own.includes(w))) return false;
  // "one pizza" may be one of several; "half of the pizza" is a share of it.
  if (said.length > 0 && !fractionIn(item) && COUNTED.test(item)) return false;
  const several = /\band\b|&|,|\+/.test(description);
  return said.length === 0 || !several || own.every((w) => said.includes(w));
}

// What a change says once code has priced it (§7.5): items from the
// receipt, fractions from the total. `answer` replies to "how much was
// Priya's …?" and may be a fraction of it all ("half of the cost", "50%").
export function priceChange(
  ctx: BrainCtx,
  expense: Expense,
  extracted: Extracted<ExpenseExtraction>,
  answer?: { text: string; problem?: Problem },
): Extracted<ExpenseExtraction> {
  return shareFractions(ctx, expense, priceFromReceipt(extracted, ctx.store.lineItems(expense.expense_id)), answer);
}

// A fraction of the expense is a fixed share of what was spent, computed
// here and never asked for (Harjyot's playground: "priyas fatass had half
// of the pizza" got "how much was Priya's half of the pizza?" three times).
// The rest splits evenly as usual; "me and jordan had the other half" gives
// it to exactly them, so anyone else still on the split had none of it.
function shareFractions(
  ctx: BrainCtx,
  expense: Expense,
  extracted: Extracted<ExpenseExtraction>,
  answer?: { text: string; problem?: Problem },
): Extracted<ExpenseExtraction> {
  const base = expense.subtotal_cents ?? expense.total_cents;
  const cents = (f: { num: number; den: number }) => Math.round((base * f.num) / f.den);
  const asked = answer?.problem?.kind === "missing_item_price" ? answer.problem.phone : undefined;
  const told = answer && ofTheExpense(answer.text, expense.description) ? fractionIn(answer.text) : undefined;
  const byAnswer = told && told !== "rest" ? told : undefined;
  const rest = new Set<string>();
  const priced = new Set<string>(); // phone|item, answered here
  const fixed: ExpenseExtraction["fixed"] = [];
  for (const f of extracted.result.fixed) {
    if (f.amount_cents !== undefined || !f.item) {
      fixed.push(f);
      continue;
    }
    const share = ofTheExpense(f.item, expense.description)
      ? (fractionIn(f.item) ?? { num: 1, den: 1 }) // "priya had the pizza": all of it
      : f.phone === asked
        ? byAnswer
        : undefined;
    if (!share) fixed.push(f);
    else if (share === "rest") rest.add(f.phone);
    else fixed.push({ phone: f.phone, item: f.item, amount_cents: cents(share) });
    if (share) priced.add(`${f.phone}|${f.item}`);
  }
  // The question's answer stands even if the re-read dropped who it was about.
  if (asked && byAnswer && !fixed.some((f) => f.phone === asked && f.amount_cents !== undefined))
    fixed.push({ phone: asked, amount_cents: cents(byAnswer) });
  if (priced.size === 0 && fixed.length === extracted.result.fixed.length) return extracted;
  const pinned = new Set(fixed.map((f) => f.phone));
  const leftOut =
    rest.size === 0
      ? []
      : liveShares(ctx, expense.expense_id)
          .map((s) => s.phone)
          .filter((p) => !pinned.has(p) && !rest.has(p));
  return {
    result: {
      ...extracted.result,
      fixed,
      exclusions: [...new Set([...extracted.result.exclusions.filter((p) => !pinned.has(p) && !rest.has(p)), ...leftOut])],
    },
    problems: extracted.problems.filter(
      (p) => !(p.kind === "missing_item_price" && (priced.has(`${p.phone}|${p.item}`) || (p.phone === asked && byAnswer))),
    ),
  };
}

// §7.5: "If an item is named without a price and a receipt exists, match it
// to a line item." Only one clear match counts; anything else is asked.
export function priceFromReceipt(
  extracted: Extracted<ExpenseExtraction>,
  items: LineItem[],
): Extracted<ExpenseExtraction> {
  if (items.length === 0) return extracted;
  const priced = new Map<string, number>();
  for (const f of extracted.result.fixed) {
    if (f.amount_cents !== undefined || !f.item) continue;
    const cents = receiptPrice(f.item, items);
    if (cents !== undefined) priced.set(`${f.phone}|${f.item}`, cents);
  }
  if (priced.size === 0) return extracted;
  return {
    result: {
      ...extracted.result,
      fixed: extracted.result.fixed.map((f) => {
        const cents = priced.get(`${f.phone}|${f.item}`);
        return cents === undefined ? f : { ...f, amount_cents: cents };
      }),
    },
    problems: extracted.problems.filter(
      (p) => !(p.kind === "missing_item_price" && priced.has(`${p.phone}|${p.item}`)),
    ),
  };
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, both: 2 };
// Filler and quantifiers never block a match: "both drinks", "all the
// drinks" and "those drinks" are all the drinks line (Harjyot's playground).
const STOP = new Set([
  "the", "a", "an", "of", "and", "my", "his", "her", "their", "our", "your", "x", "w", "with", "some",
  "all", "those", "these", "that", "this",
]);
// Leading filler before a quantity: "the 2 drinks", "all of the drinks".
const LEADING = /^((the|all|of|those|these|our|my|his|her|their)\s+)+/;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/@\s*\$?\d+(\.\d+)?/g, " ")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !(w in NUMBER_WORDS))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, ""));
}

// "2 soft drinks" against "2 x SOFT DRINK @ $2.99" ($5.98): the whole line.
// "a soft drink" against the same line: one of two, $2.99.
export function receiptPrice(item: string, items: LineItem[]): number | undefined {
  const match = receiptLine(item, items);
  if (!match) return undefined;
  const { line, qty, lineQty } = match;
  if (qty >= lineQty) return line.amount_cents;
  return Math.round((line.amount_cents * qty) / lineQty);
}

// The one receipt line an item names, and how many of it they said.
function receiptLine(item: string, items: LineItem[]): { line: LineItem; qty: number; lineQty: number } | undefined {
  const want = words(item);
  if (want.length === 0) return undefined;
  // Every word they said must be on the line, inside compounds too, so
  // "burger" matches both VEGGIE BURGER and CHEESEBURGER and gets asked
  // (Joe's review on #30).
  const matches = items.filter((line) => {
    const have = words(line.description);
    return want.every((w) => have.some((h) => h.includes(w)));
  });
  if (matches.length !== 1) return undefined;
  const line = matches[0]!;
  const lineQty = Math.max(line.quantity, Number(line.description.match(/^\s*(\d+)\s*x\b/i)?.[1] ?? 1));
  // "all the drinks" (no count after the filler) is the whole line.
  const asked = item.trim().toLowerCase().replace(LEADING, "").match(/^(\d+|a|an|one|two|three|four|five|six|both)\b/)?.[1];
  const qty = asked === undefined ? lineQty : Number(asked) || NUMBER_WORDS[asked]!;
  return { line, qty, lineQty };
}

// §7.5 item ownership: "Alex had both drinks" on a receipt means the drinks
// are Alex's and the rest is shared by everyone there, not that Alex had
// only the drinks (Harjyot's playground: Alex $7.23, Sam $39.84). The line
// items each "had" names, when every named item is a whole line on the
// receipt and nobody "only had" something; otherwise undefined, and the
// fixed amounts apply as a custom split.
function ownedLines(result: ExpenseExtraction, items: LineItem[]): { phone: string; item_id: string }[] | undefined {
  if (items.length === 0 || result.fixed.length === 0 || !result.fixed.every((f) => f.had && f.item)) return undefined;
  const owned: { phone: string; item_id: string }[] = [];
  for (const f of result.fixed) {
    const match = receiptLine(f.item!, items);
    if (!match || match.qty < match.lineQty) return undefined; // "a drink" of two: a pin
    owned.push({ phone: f.phone, item_id: match.line.item_id });
  }
  return owned;
}

// Approved or paid shares mean a transfer exists; those can't be undone.
export function moneyMoving(ctx: BrainCtx, e: Expense): boolean {
  return ctx.store.shares(e.expense_id).some((s) => s.status === "approved" || s.status === "paid");
}

// §7.7, finalized with nothing paid: back to proposed, so the module will
// recompute again. The old settle request stops covering it, and everyone
// gets a fresh objection window from the updated proposal.
export async function reopen(ctx: BrainCtx, e: Expense): Promise<Expense> {
  await ctx.db.upsert_expense({ ...e, status: "proposed", settle_message_id: undefined, finalized_at: undefined });
  for (const s of ctx.store.shares(e.expense_id).filter((x) => x.status === "locked" || x.status === "disputed"))
    await ctx.db.set_share({ ...s, status: "proposed", responded: false, followup_count: 0 });
  return ctx.store.expense(e.expense_id)!;
}

export async function applyAdjustment(
  ctx: BrainCtx,
  snapshot: Expense,
  result: ExpenseExtraction,
) {
  const current = ctx.store.expense(snapshot.expense_id) ?? snapshot;
  // Whatever Tab was asking about this split is answered now.
  closeExpenseThreads(ctx, current.expense_id, ["adjustment", "adjust_open"]);
  if (current.status === "finalized" && moneyMoving(ctx, current)) return;
  const expense = current.status === "finalized" ? await reopen(ctx, current) : current;
  const before = new Map(
    liveShares(ctx, expense.expense_id).map((s) => [s.phone, s.amount_cents]),
  );
  const shares = ctx.store.shares(expense.expense_id);
  const owned = ownedLines(result, ctx.store.lineItems(expense.expense_id));
  if (owned) {
    await applyOwnership(ctx, expense, result, owned);
  } else {
    await applyFixed(ctx, expense, result, shares);
  }
  // §7.5: post an updated proposal only if someone else's amount changed.
  const after = liveShares(ctx, expense.expense_id);
  const changed =
    after.some((s) => before.get(s.phone) !== s.amount_cents) ||
    after.length !== before.size;
  if (changed) await postProposal(ctx, expense.expense_id, true);
}

const extendedDeadline = (ctx: BrainCtx, e: Expense) =>
  new Date(Math.max(e.objection_deadline?.getTime() ?? 0, ctx.now().getTime()) + ctx.timing.durations.OBJECTION_EXTENSION);

// Opt-outs first, so nobody owns an item from outside the split.
async function optOut(ctx: BrainCtx, shares: Share[], exclusions: string[]) {
  for (const s of shares.filter((x) => exclusions.includes(x.phone) && x.status !== "opted_out"))
    await ctx.db.set_share({ ...s, status: "opted_out" });
}

// The items become claims on an itemized split (§8): unclaimed items split
// evenly among everyone still in, tax and tip in proportion. It stays
// proposed, so the group can still change it before it locks in.
async function applyOwnership(
  ctx: BrainCtx,
  expense: Expense,
  result: ExpenseExtraction,
  owned: { phone: string; item_id: string }[],
) {
  await optOut(ctx, ctx.store.shares(expense.expense_id), result.exclusions);
  await ctx.db.upsert_expense({ ...expense, split_mode: "itemized", objection_deadline: extendedDeadline(ctx, expense) });
  const live = new Set(liveShares(ctx, expense.expense_id).map((s) => s.phone));
  for (const o of owned.filter((x) => live.has(x.phone)))
    await ctx.db.add_claim({ item_id: o.item_id, phone: o.phone, source_message_id: expense.source_message_id });
}

// "Jake only had a $3 Diet Coke": a fixed amount, the rest split evenly
// (custom split).
async function applyFixed(ctx: BrainCtx, expense: Expense, result: ExpenseExtraction, shares: Share[]) {
  const fixedPhones = new Set(result.fixed.map((f) => f.phone));
  for (const s of shares) {
    const fixed = result.fixed.find((f) => f.phone === s.phone);
    const optOut = result.exclusions.includes(s.phone);
    if (!fixed && !optOut) continue;
    await ctx.db.set_share({
      expense_id: s.expense_id,
      phone: s.phone,
      role: s.role,
      status: optOut ? "opted_out" : s.status,
      fixed_cents: fixed?.amount_cents ?? s.fixed_cents,
      responded: s.responded,
      followup_count: s.followup_count,
      last_followup_at: s.last_followup_at,
    });
  }
  await ctx.db.upsert_expense({
    ...expense,
    split_mode:
      fixedPhones.size > 0 || expense.split_mode === "custom"
        ? "custom"
        : expense.split_mode,
    objection_deadline: extendedDeadline(ctx, expense),
  });
}

export function latestOpen(
  ctx: BrainCtx,
  group_id: string | undefined,
  statuses: Expense["status"][],
): Expense | undefined {
  return ctx.store
    .expenses()
    .filter(
      (e) =>
        (!group_id || e.group_id === group_id) && statuses.includes(e.status),
    )
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
}
