// SPEC §11.1 processing loop and §11.2 scheduler.
import type { Intent } from "@tab/gate";
import { decide } from "../gate/decide.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatOf, type Pending, perExpense, say, tapback } from "./context.js";
import { applyAdjustment, groupFor, handleAdjustment, handleExpense, proposeNew } from "./expense.js";
import { extractInput } from "./inputs.js";
import { askReceipt, claimFollowups, handleClaim, handleReceipt, proposeReceipt } from "./receipt.js";
import {
  announceSettlements,
  approvalFollowups,
  dispute,
  disputeTargets,
  finalize,
  resolveDispute,
  routeReaction,
  settleUp,
  stillDisputed,
  textApproval,
  whichDisputed,
} from "./settle.js";
import { handleCorrection } from "./correction.js";
import { handleLedger } from "./ledger.js";
import {
  handleBalanceQuery,
  handleBreakdown,
  handleHelp,
  handleNameReply,
  onboardNewGroups,
} from "./talk.js";
import { addThread, closeThread, isAsker, mayAnswer, openThreads, type Thread, threadForReply } from "./threads.js";
import * as T from "../copy/templates.js";

// Intents whose messages are about money: the only ones kept as context and
// the only ones (besides answers from the person Tab asked) sent to Grok.
const MONEY_INTENTS = new Set<Intent>([
  "expense", "receipt", "split_adjustment", "claim", "correction",
  "approval", "dispute", "payment_reported", "balance_query", "breakdown_request",
]);

const WHY = /^(why|how|how come|how so|wdym|what'?s that( from| for)?)\b/i;

const YES =
  /^(yes|yep|yeah|ya|yup|sure|ok|okay|correct|right|do it|go ahead|that's right)\b/i;
const NO = /^(no|nope|nah|wrong|not right)\b/i;

// Questions Tab asks when the gate is unsure (§6.4 clarify band). Intents
// that only read data are answered directly; names are never guessed.
const CONFIRM_QUESTION: Partial<Record<Intent, string>> = {
  expense: "Want me to split that?",
};

// iPhones type curly quotes ("I’m", "didn’t"); every parser expects ASCII.
export function normalizeText(text: string | undefined): string | undefined {
  return text?.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
}

export async function processMessage(ctx: BrainCtx, raw: Message): Promise<void> {
  const m: Message = { ...raw, text: normalizeText(raw.text) };
  await ctx.db.set_message_result({
    message_id: m.message_id,
    status: "processing",
  });
  // Whether the text may stay in the database (§19): only money-related
  // messages, answers to Tab, and "why?" after a balance reply.
  let keep = false;
  try {
    let intent: Intent | undefined;
    let confidence: number | undefined;

    if (m.kind === "reaction") {
      await routeReaction(ctx, m); // §6.2: never classified
    } else {
      ctx.memory.observeStyle(m); // flags only, no text
      // The gate sees every message; Grok only sees what the gate passes
      // (§19, §16.3). Anything not money-related is reported as `ignore`, so
      // the module clears its text and later context never includes it.
      // An open question tells the pre-filter to pass even "the 2nd one",
      // since a bystander's inline answer only counts if the gate passes it.
      const input = { ...extractInput(ctx, m), tab_question_open: openThreads(ctx, chatOf(m)).length > 0 };
      const result = await ctx.classify(input);
      intent = result.intent;
      confidence = result.confidence;
      const decision = decide(result, input);
      const moneyRelated = decision !== "ignore" && MONEY_INTENTS.has(intent);
      ctx.log("classified", {
        message_id: m.message_id, group_id: m.group_id, intent, confidence, decision,
        prefiltered: result.prefiltered === true,
      });

      const answered = await answerThreads(ctx, m, decision !== "ignore");
      // "why?" right after Tab's balance reply: the short explanation.
      const why = !answered && WHY.test((m.text ?? "").trim()) && lastTabPurpose(ctx, m) === "balance_reply";
      if (why) await handleBreakdown(ctx, m);
      // "@tab ledger" (§12.3): addressed to Tab, or a question the gate passed.
      const ledger = !answered && !why && wantsLedger(m, intent, decision);
      if (ledger) await handleLedger(ctx, m);
      keep = answered || moneyRelated || why || ledger;
      if (!keep) intent = "ignore";
      if (!answered && !why && !ledger) {
        if (decision === "act") await act(ctx, m, result.intent);
        else if (decision === "clarify") await clarify(ctx, m, result.intent);
      }
    }
    await ctx.db.set_message_result({
      message_id: m.message_id,
      intent,
      confidence,
      status: "done",
    });
  } catch (err) {
    ctx.log("message_failed", {
      message_id: m.message_id,
      group_id: m.group_id,
      error: String(err),
    });
    await ctx.db.set_message_result({
      message_id: m.message_id,
      // A failure before the message proved money-related clears its text.
      intent: keep || m.kind === "reaction" ? undefined : "ignore",
      status: "error",
      error: String(err).slice(0, 500),
    });
  }
}

const LEDGER_ASK = /\bledger\b/i;
const TO_TAB = /^@?tab\b/i;
const READ_INTENTS = new Set<Intent>(["help", "balance_query", "breakdown_request"]);

function wantsLedger(m: Message, intent: Intent, decision: string): boolean {
  const text = (m.text ?? "").trim();
  if (!LEDGER_ASK.test(text)) return false;
  return TO_TAB.test(text) || m.group_id === undefined || (decision !== "ignore" && READ_INTENTS.has(intent));
}

// An inline reply binds a message to one expense (Harjyot's review on #14,
// like §6.2 for tapbacks): a reply to Tab's message about an expense, or to
// the message that created it. Used to pick the target, never to lower a bar.
export function repliedExpense(ctx: BrainCtx, m: Message): Expense | undefined {
  if (!m.reply_to_id) return undefined;
  const tab = ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id && o.expense_id);
  const id = tab?.expense_id ?? ctx.store.expenses().find((e) => e.source_message_id === m.reply_to_id)?.expense_id;
  return id ? ctx.store.expense(id) : undefined;
}

async function act(ctx: BrainCtx, m: Message, intent: Intent) {
  const bound = repliedExpense(ctx, m);
  const boundIf = (...statuses: Expense["status"][]) => (bound && statuses.includes(bound.status) ? bound : undefined);
  switch (intent) {
    case "expense":
      // A captioned photo ("dinner, i paid") is still a receipt.
      return m.kind === "image" ? handleReceipt(ctx, m) : handleExpense(ctx, m);
    case "split_adjustment":
      return handleAdjustment(ctx, m, m.text ?? "", boundIf("proposed", "finalized"));
    case "name_reply":
      return handleNameReply(ctx, m);
    case "approval":
      // Text never moves money (P7, SPEC #15): point to the 👍.
      return textApproval(ctx, m);
    case "settle_up":
      return settleUp(ctx, m);
    case "dispute": {
      const e = boundIf("finalized");
      return dispute(ctx, m, e ? [e] : disputeTargets(ctx, m));
    }
    case "balance_query":
      return handleBalanceQuery(ctx, m);
    case "breakdown_request":
      return handleBreakdown(ctx, m);
    case "help":
      return handleHelp(ctx, m);
    case "receipt":
      return handleReceipt(ctx, m);
    case "claim":
      return handleClaim(ctx, m, boundIf("itemizing"));
    case "correction":
      return handleCorrection(ctx, m, bound && bound.status !== "void" ? bound : undefined);
    // payment_reported is ignored in the MVP; ignore needs nothing.
    default:
      ctx.log("intent_not_handled", { message_id: m.message_id, intent });
  }
}

async function clarify(ctx: BrainCtx, m: Message, intent: Intent) {
  // A possible name is acted on only right after Tab asked an unnamed sender
  // for theirs; otherwise never guess a name (P3).
  if (intent === "name_reply") return answeringNamePrompt(ctx, m) ? act(ctx, m, intent) : undefined;
  // §6.4: an unsure adjustment is about an open expense, so ask rather than
  // stay silent: explain what's wrong, or confirm before applying.
  if (intent === "split_adjustment") {
    const bound = repliedExpense(ctx, m);
    const target = bound?.status === "proposed" || bound?.status === "finalized" ? bound : undefined;
    return handleAdjustment(ctx, m, m.text ?? "", target, { confirmOnly: true });
  }
  const question = CONFIRM_QUESTION[intent];
  if (!question) return; // e.g. a possible name: never guess (P3), stay quiet (P1)
  const id = `clarify:${m.message_id}`;
  await tapback(ctx, m, "question");
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id, reply_to: m.message_id,
    text: question,
  });
  addThread(ctx, chatOf(m), {
    id,
    text: question,
    who: "asker",
    asker: m.sender_phone,
    data: { kind: "confirm", then: "expense", source: m, asked_at: ctx.now() },
  });
}

// Tab's open questions in this chat (threads.ts), tried before normal
// handling. An answer is accepted only if it actually resolves something;
// otherwise the message is handled as if nothing were open.
// Who may answer (Harjyot's review on #14): a question about the sender's
// own money only the person Tab asked; a missing fact anyone, but someone
// else only by replying inline to that question, and only if the gate passed
// it; a bystander's "uber was $30, I paid" is their own expense, not an answer.
async function answerThreads(ctx: BrainCtx, m: Message, passed: boolean): Promise<boolean> {
  if (m.kind !== "text" || !m.text) return false;
  const mine = openThreads(ctx, chatOf(m)).filter((t) => mayAnswer(t, m));
  if (mine.length === 0) return false;
  const replied = threadForReply(ctx, m, mine);
  const pool = replied ? [replied] : mine;

  // Today's parsers, for a plain answer to exactly one question: no Grok call.
  const hits = pool.flatMap((t) => {
    const apply = quickAnswer(ctx, m, t);
    return apply ? [apply] : [];
  });
  if (hits.length === 1) {
    await hits[0]!();
    return true;
  }
  // A question about an expense: read it again with the answer appended.
  const reask = pool.find(
    (t) => (t.data.kind === "expense" || t.data.kind === "adjustment") && (isAsker(t, m) || (t === replied && passed)),
  );
  if (!reask) return false;
  return answerExpense(ctx, m, reask, isAsker(reask, m) ? m.text : inThirdPerson(m.text, nameOf(ctx, m)));
}

// Someone else's answer is read as the asker's message, so "I" and "me"
// would mean the asker. Name the speaker instead: "me" from Joe is Joe.
export function inThirdPerson(text: string, name: string): string {
  return text
    .replace(/\bI'm\b/gi, `${name} is`)
    .replace(/\bI've\b/gi, `${name} has`)
    .replace(/\bI'd\b/gi, `${name} would`)
    .replace(/\bmy\b/gi, `${name}'s`)
    .replace(/\b(I|me|myself)\b/gi, name);
}

// A bare yes or no ("yeah lock it in", "nope"). Anything longer, or with a
// number in it, may say a second thing, so the regex doesn't decide it.
function yesNo(text: string): boolean | undefined {
  if (/\d/.test(text) || text.split(/\s+/).length > 6) return undefined;
  return NO.test(text) ? false : YES.test(text) ? true : undefined;
}

// What the regex parsers make of the message as an answer to `t`, as a
// thunk that applies it; undefined when they can't tell.
function quickAnswer(ctx: BrainCtx, m: Message, t: Thread): (() => Promise<void>) | undefined {
  const text = (m.text ?? "").trim();
  const d = t.data;
  switch (d.kind) {
    case "confirm": {
      const yes = yesNo(text);
      return yes === undefined ? undefined : () => answerConfirm(ctx, m, t, d, yes);
    }
    case "receipt": {
      const answer = receiptAnswer(text, d);
      return answer === undefined ? undefined : () => answerReceipt(ctx, m, t, d, answer);
    }
    case "which": {
      const n = Number(text.replace(/^#/, ""));
      return Number.isInteger(n) && d.expense_ids[n - 1] ? () => answerWhich(ctx, m, t, d, n) : undefined;
    }
    case "settle_mode": {
      const mode = EACH.test(text) ? "per_expense" : LEDGER.test(text) ? "ledger" : undefined;
      return mode && m.group_id ? () => answerSettleMode(ctx, m, t, mode) : undefined;
    }
    case "dispute":
      return disputeAnswer(ctx, m, t, d, text);
    default:
      return undefined;
  }
}

async function answerExpense(ctx: BrainCtx, m: Message, t: Thread, answer: string): Promise<boolean> {
  const p = t.data;
  if (p.kind !== "expense" && p.kind !== "adjustment") return false;
  const text = `${p.text}\n${answer}`;
  const mode = p.kind === "expense" ? "new" : "adjustment";
  const retry = await ctx.extract.expense(
    extractInput(ctx, { ...p.source, text }),
    mode,
  );
  if (retry.problems.length >= p.problems.length) return false; // didn't help
  closeThread(ctx, chatOf(m), t);
  if (p.kind === "adjustment") {
    const expense = ctx.store.expense(p.expense_id);
    if (!expense) return true;
    if (retry.problems.length > 0) {
      const id = `clarify:${m.message_id}`;
      const question = T.clarifyingQuestion(retry.problems[0]!, {
        description: expense.description,
        people: [],
      });
      await say(ctx, {
        chat: chatOf(m),
        purpose: "clarifying_question",
        id, reply_to: m.message_id,
        text: question,
        expense_id: expense.expense_id,
      });
      addThread(ctx, chatOf(m), {
        ...t,
        id,
        text: question,
        data: { ...p, text, problems: retry.problems, asked_at: ctx.now() },
      });
      return true;
    }
    await applyAdjustment(ctx, expense, retry.result);
    await tapback(ctx, m, "like", expense.expense_id);
    return true;
  }
  await handleExpense(ctx, m, text, p.source);
  return true;
}

async function answerConfirm(
  ctx: BrainCtx,
  m: Message,
  t: Thread,
  p: Extract<Pending, { kind: "confirm" }>,
  yes: boolean,
): Promise<void> {
  closeThread(ctx, chatOf(m), t);
  if (!yes) {
    await tapback(ctx, m, "like");
    return;
  }
  if (p.then === "expense") await handleExpense(ctx, m, p.source.text ?? "", p.source);
  else if (p.then === "adjustment" && p.extraction && p.expense_id) {
    const expense = ctx.store.expense(p.expense_id);
    if (expense?.status === "proposed" || expense?.status === "finalized") {
      await tapback(ctx, m, "like", expense.expense_id);
      await applyAdjustment(ctx, expense, p.extraction.result);
    }
  } else if (p.then === "large_amount" && p.extraction) {
    const group_id = groupFor(ctx, p.source);
    const rest = p.extraction.problems.filter((x) => x.kind !== "large_amount");
    if (group_id && rest.length === 0)
      await proposeNew(ctx, {
        group_id,
        source: p.source,
        extracted: { ...p.extraction, problems: [] },
      });
  } else if (p.then === "finalize_and_settle") {
    // Unclaimed items split evenly (§7.5), then one request for everything.
    // Safe to do on anyone's yes: only each payer's 👍 moves money (P7).
    for (const id of t.expense_ids ?? []) {
      const e = ctx.store.expense(id);
      if (e?.status === "itemizing") await finalize(ctx, e, { request: false });
    }
    await settleUp(ctx, m);
  }
}

function answeringNamePrompt(ctx: BrainCtx, m: Message): boolean {
  if (!m.group_id) return false;
  const me = ctx.store.members(m.group_id).find((x) => x.phone === m.sender_phone);
  if (!me || me.name) return false;
  const lastTab = ctx.store
    .outbox()
    .filter((o) => o.group_id === m.group_id && o.kind !== "reaction" && o.status !== "cancelled" && o.created_at <= m.received_at)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  // The intro, name prompt, and contact card go out together; any of them counts.
  return lastTab?.purpose === "name_prompt" || lastTab?.purpose === "onboarding_intro";
}

function lastTabPurpose(ctx: BrainCtx, m: Message): string | undefined {
  const chat = chatOf(m);
  return ctx.store
    .outbox()
    .filter((o) => o.kind !== "reaction" && o.created_at <= m.received_at && (chat.group_id ? o.group_id === chat.group_id : o.to_phone === chat.dm_phone))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0]?.purpose;
}

function nameOf(ctx: BrainCtx, m: Message): string {
  const g = groupFor(ctx, m);
  return (
    (g && ctx.store.members(g).find((x) => x.phone === m.sender_phone)?.name) ||
    "someone"
  );
}

// §11.2: due work is generated from current state on every tick, so it is
// always fresh and needs no cancellation bookkeeping.
export async function tick(ctx: BrainCtx): Promise<void> {
  const now = ctx.now();
  await onboardNewGroups(ctx);
  await perExpense(ctx, ctx.store.expenses().filter((x) => x.status === "proposed" && x.objection_deadline), async (e) => {
    const deadline = e.objection_deadline!;
    if (now >= deadline) {
      // §7.5: never lock in under one of Tab's own open questions about it.
      if (askingAbout(ctx, e.expense_id)) return;
      await finalize(ctx, e);
      return;
    }
    const remindAt =
      deadline.getTime() - ctx.timing.durations.OBJECTION_REMINDER_BEFORE;
    const id = `objection_reminder:${e.expense_id}`;
    if (
      now.getTime() >= remindAt &&
      !ctx.store.outbox().some((o) => o.action_id === id)
    ) {
      await say(ctx, {
        chat: { group_id: e.group_id },
        purpose: "objection_reminder",
        id,
        text: T.objectionReminder(),
        expense_id: e.expense_id,
      });
    }
  });
  await claimFollowups(ctx);
  await approvalFollowups(ctx);
  await announceSettlements(ctx);
}

// An unexpired question from Tab about this expense: an open thread about
// it, or a question that set none (holdOpen).
function askingAbout(ctx: BrainCtx, expense_id: string): boolean {
  const held = ctx.memory.holds.get(expense_id);
  if (held && ctx.now().getTime() - held.getTime() <= ctx.timing.durations.PENDING_QUESTION_TTL) return true;
  const e = ctx.store.expense(expense_id);
  return Boolean(e && openThreads(ctx, { group_id: e.group_id }).some((t) => t.expense_id === expense_id));
}

// A receipt answer: yes or no to the total Tab read, else cents.
type ReceiptAnswer = boolean | number;

function receiptAnswer(text: string, p: Extract<Pending, { kind: "receipt" }>): ReceiptAnswer | undefined {
  if (p.stage === "confirm_total") return yesNo(text);
  // One amount and little else: "60, and I got gas for 30" says two things.
  if ((text.match(/\d+(?:[.,]\d+)*/g) ?? []).length > 1 || text.split(/\s+/).length > 6) return undefined;
  if (p.stage === "total") {
    const total = answerCents(text);
    return total !== undefined && total > 0 ? total : undefined;
  }
  const { receipt } = p.read;
  return /^(none|no tip|nothing|zero|didn'?t|no)\b/i.test(text)
    ? 0
    : answerPercent(text, receipt.subtotal_cents ?? receipt.total_cents ?? 0) ?? answerCents(text);
}

// §7.4: only the payer answers questions about their receipt (mayAnswer).
async function answerReceipt(
  ctx: BrainCtx,
  m: Message,
  t: Thread,
  p: Extract<Pending, { kind: "receipt" }>,
  answer: ReceiptAnswer,
): Promise<void> {
  const { receipt } = p.read;
  closeThread(ctx, chatOf(m), t);
  if (p.stage === "confirm_total") {
    if (answer === true) {
      await tapback(ctx, m, "like");
      // The items didn't add up, so split the confirmed total evenly.
      await proposeReceipt(ctx, p.source, p.read, { itemsTrusted: false });
      return;
    }
    const id = `clarify:${m.message_id}`;
    const question = "What was the total?";
    await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id, reply_to: m.message_id, text: question });
    askReceipt(ctx, p.source, { id, text: question, read: p.read, stage: "total" });
    return;
  }
  if (typeof answer !== "number") return;
  await tapback(ctx, m, "like");
  if (p.stage === "total") {
    await proposeReceipt(ctx, p.source, { ...p.read, receipt: { ...receipt, total_cents: answer } }, { itemsTrusted: false });
    return;
  }
  const withTip = { ...receipt, tip_cents: answer, total_cents: (receipt.total_cents ?? 0) + answer };
  await proposeReceipt(ctx, p.source, { ...p.read, receipt: withTip, tip_line_blank: false }, { itemsTrusted: true });
}

async function answerWhich(ctx: BrainCtx, m: Message, t: Thread, p: Extract<Pending, { kind: "which" }>, n: number): Promise<void> {
  closeThread(ctx, chatOf(m), t);
  const target = ctx.store.expense(p.expense_ids[n - 1]!);
  if (target) await handleClaim(ctx, p.source, target);
}

// §7.6: the disputer answers "What's off?" with what they had ("I only had
// $10"). Several disputed expenses: ask which one, then take a number. Only
// the disputer answers (an asker-only thread); anything without a clear
// amount goes through normal handling (e.g. "I wasn't there" is an adjustment).
function disputeAnswer(ctx: BrainCtx, m: Message, t: Thread, p: Extract<Pending, { kind: "dispute" }>, text: string) {
  const open = stillDisputed(ctx, m.sender_phone, p.expense_ids);
  if (open.length === 0) return undefined;
  if (p.amount_cents !== undefined) {
    // Numbered from the "Which one?" list, which is p.expense_ids.
    const n = Number(text.replace(/^#/, ""));
    const id = Number.isInteger(n) ? p.expense_ids[n - 1] : undefined;
    const target = open.find((e) => e.expense_id === id);
    const amount = p.amount_cents;
    return target ? () => answerDispute(ctx, m, t, p, open, amount, target) : undefined;
  }
  const amount = disputeCents(text);
  if (amount === undefined || amount <= 0) return undefined;
  return () => answerDispute(ctx, m, t, p, open, amount);
}

async function answerDispute(
  ctx: BrainCtx,
  m: Message,
  t: Thread,
  p: Extract<Pending, { kind: "dispute" }>,
  open: Expense[],
  amount: number,
  chosen?: Expense,
): Promise<void> {
  const chat = chatOf(m);
  closeThread(ctx, chat, t);
  const again = (id: string, text: string, expense_ids: string[], amount_cents?: number) =>
    addThread(ctx, chat, { ...t, id, text, expense_ids, data: { ...p, expense_ids, amount_cents, asked_at: ctx.now() } });
  if (!chosen && open.length > 1) {
    const id = `clarify:${m.message_id}`;
    const text = whichDisputed(ctx, m.sender_phone, open);
    await say(ctx, { chat, purpose: "clarifying_question", id, reply_to: m.message_id, text });
    again(id, text, open.map((e) => e.expense_id), amount);
    return;
  }
  const target = chosen ?? open[0]!;
  if (await resolveDispute(ctx, m, target, amount)) {
    // Anything else they disputed is still open to an answer.
    const rest = open.filter((e) => e.expense_id !== target.expense_id).map((e) => e.expense_id);
    if (rest.length > 0) again(t.id, t.text, rest);
  } else {
    // Too much for the payer's share to absorb: Tab asked again.
    again(`clarify:${m.message_id}`, t.text, [target.expense_id]);
  }
}

// A reply to "What's off?" is usually a description, and "I had 2 beers" or
// "only 1 slice" is a count, not $2 or $1 (Joe's review on #29). So only a
// clear amount of money counts: "$4", "4.50", "4 bucks", "4 dollars", or a
// message that is just a number ("4", "$4"). Anything else goes through
// normal handling, which asks and confirms.
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{1,6})`;
const CLEAR_MONEY = [
  new RegExp(String.raw`^\$?\s*(${NUM}(?:\.\d{1,2})?)$`), // the whole message
  new RegExp(String.raw`\$\s*(${NUM}(?:\.\d{1,2})?)`), // $4, $ 4.50
  new RegExp(String.raw`(?<![\d.])(${NUM}\.\d{2})(?![\d.])`), // 4.50 (cents, so "1.5 slices" isn't money)
  new RegExp(String.raw`(?<![\d.])(${NUM}(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)\b`, "i"), // 4 bucks
];
export function disputeCents(text: string): number | undefined {
  const t = text.trim();
  for (const re of CLEAR_MONEY) {
    const match = t.match(re);
    if (match) return answerCents(match[1]!);
  }
  return undefined;
}

// "22", "$18.50", "it was 30", "1,240": the first amount typed.
export function answerCents(text: string): number | undefined {
  const match = text.match(/\$?(\d{1,3}(?:,\d{3})+|\d{1,6})(\.\d{1,2})?/);
  return match ? Math.round(Number(match[1]!.replace(/,/g, "") + (match[2] ?? "")) * 100) : undefined;
}

// "20%", "18 percent": a tip as a share of the subtotal, computed in code (P6).
export function answerPercent(text: string, base_cents: number): number | undefined {
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*(%|percent)/i);
  return match ? Math.round((base_cents * Number(match[1])) / 100) : undefined;
}

// SPEC #15: "each" switches the group to per-expense settling. A clear
// "no trip, keep a tab" reply ("nah we're just adding friend expenses in the
// long run", Harjyot's playground test) keeps the default. Either way Tab
// confirms in one line. Anything else goes through normal handling.
const EACH = /^(each|every time|after (each|every))\b/i;
const LEDGER = /^(nah|no|nope|not really)\b|\b(running tab|long run|at the end|keep a tab)\b/i;

async function answerSettleMode(ctx: BrainCtx, m: Message, t: Thread, mode: "ledger" | "per_expense"): Promise<void> {
  if (!m.group_id) return;
  closeThread(ctx, chatOf(m), t);
  await ctx.db.set_settle_mode({ group_id: m.group_id, settle_mode: mode });
  await say(ctx, {
    chat: chatOf(m),
    purpose: "other",
    id: `settle_mode_set:${m.group_id}`,
    reply_to: m.message_id,
    text: T.settleModeSet(mode),
  });
}
