// SPEC §11.1 processing loop and §11.2 scheduler.
import type { Intent } from "@tab/gate";
import { decide } from "../gate/decide.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatKey, chatOf, inWords, type Pending, perExpense, say, tapback } from "./context.js";
import { applyAdjustment, groupFor, handleAdjustment, handleExpense, proposeNew } from "./expense.js";
import { extractInput } from "./inputs.js";
import { claimFollowups, handleClaim, handleReceipt, proposeReceipt } from "./receipt.js";
import {
  announceSettlements,
  approvalFollowups,
  dispute,
  disputeTargets,
  finalize,
  routeReaction,
  settleUp,
  textApproval,
} from "./settle.js";
import {
  handleBalanceQuery,
  handleBreakdown,
  handleHelp,
  handleNameReply,
  onboardNewGroups,
} from "./talk.js";
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
  return text?.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
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
      const input = { ...extractInput(ctx, m), tab_question_open: ctx.memory.pending.has(chatKey(chatOf(m))) };
      const result = await ctx.classify(input);
      intent = result.intent;
      confidence = result.confidence;
      const decision = decide(result, input);
      const moneyRelated = decision !== "ignore" && MONEY_INTENTS.has(intent);
      ctx.log("classified", {
        message_id: m.message_id, group_id: m.group_id, intent, confidence, decision,
        prefiltered: result.prefiltered === true,
      });

      const answered = (await mayAnswerPending(ctx, m, decision !== "ignore")) && (await answerPending(ctx, m));
      // "why?" right after Tab's balance reply: the short explanation.
      const why = !answered && WHY.test((m.text ?? "").trim()) && lastTabPurpose(ctx, m) === "balance_reply";
      if (why) await handleBreakdown(ctx, m);
      keep = answered || moneyRelated || why;
      if (!keep) intent = "ignore";
      if (!answered && !why) {
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
    // Not built yet: correction (§7.7). payment_reported is ignored in the
    // MVP; ignore needs nothing.
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
  await tapback(ctx, m, "question");
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id: `clarify:${m.message_id}`, reply_to: m.message_id,
    text: question,
  });
  ctx.memory.pending.set(chatKey(chatOf(m)), {
    kind: "confirm",
    then: "expense",
    source: m,
    asked_at: ctx.now(),
  });
}

// If Tab asked something in this chat, try the message as the answer. An
// answer is accepted only if it actually resolves something; otherwise the
// message is classified normally.
// Who may answer (Harjyot's review on #14): the person Tab asked, since
// their reply answers Tab's own money question. Anyone else only by
// replying inline to that question, and only if the gate passed it; a
// bystander's "uber was $30, I paid" is their own expense, not an answer.
async function mayAnswerPending(ctx: BrainCtx, m: Message, passed: boolean): Promise<boolean> {
  const p = ctx.memory.pending.get(chatKey(chatOf(m)));
  if (!p) return false;
  // The settle-mode question is answered by anyone, by regex only (no Grok).
  if (p.kind === "settle_mode" || m.sender_phone === p.source.sender_phone) return true;
  return passed && (p.kind === "expense" || p.kind === "adjustment") && repliesToQuestion(ctx, m);
}

function repliesToQuestion(ctx: BrainCtx, m: Message): boolean {
  if (!m.reply_to_id) return false;
  const chat = chatOf(m);
  const last = ctx.store
    .outbox()
    .filter((o) => o.purpose === "clarifying_question" && (chat.group_id ? o.group_id === chat.group_id : o.to_phone === chat.dm_phone))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  return last?.sent_photon_id === m.reply_to_id;
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

async function answerPending(ctx: BrainCtx, m: Message): Promise<boolean> {
  const key = chatKey(chatOf(m));
  const p = ctx.memory.pending.get(key);
  if (!p || m.kind !== "text" || !m.text) return false;
  if (
    ctx.now().getTime() - p.asked_at.getTime() >
    ctx.timing.durations.PENDING_QUESTION_TTL
  ) {
    ctx.memory.pending.delete(key);
    return false;
  }
  if (p.kind === "confirm") return answerConfirm(ctx, m, p, key);
  if (p.kind === "receipt") return answerReceipt(ctx, m, p, key);
  if (p.kind === "which") return answerWhich(ctx, m, p, key);
  if (p.kind === "settle_mode") return answerSettleMode(ctx, m, key);

  const answerer =
    m.sender_phone === p.source.sender_phone
      ? m.text
      : inThirdPerson(m.text, nameOf(ctx, m));
  const text = `${p.text}\n${answerer}`;
  const mode = p.kind === "expense" ? "new" : "adjustment";
  const retry = await ctx.extract.expense(
    extractInput(ctx, { ...p.source, text }),
    mode,
  );
  if (retry.problems.length >= p.problems.length) return false; // didn't help
  ctx.memory.pending.delete(key);
  if (p.kind === "adjustment") {
    const expense = ctx.store.expense(p.expense_id);
    if (!expense) return true;
    if (retry.problems.length > 0) {
      ctx.memory.pending.set(key, {
        ...p,
        text,
        problems: retry.problems,
        asked_at: ctx.now(),
      });
      await say(ctx, {
        chat: chatOf(m),
        purpose: "clarifying_question",
        id: `clarify:${m.message_id}`, reply_to: m.message_id,
        text: T.clarifyingQuestion(retry.problems[0]!, {
          description: expense.description,
          people: [],
        }),
        expense_id: expense.expense_id,
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
  p: Extract<Pending, { kind: "confirm" }>,
  key: string,
) {
  const text = (m.text ?? "").trim();
  if (m.sender_phone !== p.source.sender_phone) return false;
  if (NO.test(text)) {
    ctx.memory.pending.delete(key);
    await tapback(ctx, m, "like");
    return true;
  }
  if (!YES.test(text)) return false;
  ctx.memory.pending.delete(key);
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
  }
  return true;
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



// §7.4: only the payer answers questions about their receipt.
async function answerReceipt(ctx: BrainCtx, m: Message, p: Extract<Pending, { kind: "receipt" }>, key: string): Promise<boolean> {
  if (m.sender_phone !== p.source.sender_phone) return false;
  const text = (m.text ?? "").trim();
  const { receipt } = p.read;
  if (p.stage === "confirm_total") {
    if (YES.test(text)) {
      ctx.memory.pending.delete(key);
      await tapback(ctx, m, "like");
      // The items didn't add up, so split the confirmed total evenly.
      await proposeReceipt(ctx, p.source, p.read, { itemsTrusted: false });
      return true;
    }
    if (!NO.test(text)) return false;
    ctx.memory.pending.set(key, { ...p, stage: "total", asked_at: ctx.now() });
    await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id: `clarify:${m.message_id}`, reply_to: m.message_id, text: "What was the total?" });
    return true;
  }
  if (p.stage === "total") {
    const total = answerCents(text);
    if (total === undefined || total <= 0) return false;
    ctx.memory.pending.delete(key);
    await tapback(ctx, m, "like");
    await proposeReceipt(ctx, p.source, { ...p.read, receipt: { ...receipt, total_cents: total } }, { itemsTrusted: false });
    return true;
  }
  // stage "tip"
  const tip = /^(none|no tip|nothing|zero|didn'?t|no)\b/i.test(text)
    ? 0
    : answerPercent(text, receipt.subtotal_cents ?? receipt.total_cents ?? 0) ?? answerCents(text);
  if (tip === undefined) return false;
  ctx.memory.pending.delete(key);
  await tapback(ctx, m, "like");
  const withTip = { ...receipt, tip_cents: tip, total_cents: (receipt.total_cents ?? 0) + tip };
  await proposeReceipt(ctx, p.source, { ...p.read, receipt: withTip, tip_line_blank: false }, { itemsTrusted: true });
  return true;
}

async function answerWhich(ctx: BrainCtx, m: Message, p: Extract<Pending, { kind: "which" }>, key: string): Promise<boolean> {
  if (m.sender_phone !== p.source.sender_phone) return false;
  const n = Number((m.text ?? "").trim().replace(/^#/, ""));
  const id = Number.isInteger(n) ? p.expense_ids[n - 1] : undefined;
  const target = id ? ctx.store.expense(id) : undefined;
  if (!target) return false;
  ctx.memory.pending.delete(key);
  await handleClaim(ctx, p.source, target);
  return true;
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

async function answerSettleMode(ctx: BrainCtx, m: Message, key: string): Promise<boolean> {
  const text = (m.text ?? "").trim();
  const mode = EACH.test(text) ? "per_expense" : LEDGER.test(text) ? "ledger" : undefined;
  if (!m.group_id || !mode) return false;
  ctx.memory.pending.delete(key);
  ctx.memory.settleMode.set(m.group_id, mode);
  await say(ctx, {
    chat: chatOf(m),
    purpose: "other",
    id: `settle_mode_set:${m.group_id}`,
    reply_to: m.message_id,
    text: T.settleModeSet(mode),
  });
  return true;
}
