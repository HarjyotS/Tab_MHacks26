// SPEC §11.1 processing loop and §11.2 scheduler.
import type { Intent } from "@tab/gate";
import { decide } from "../gate/decide.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatKey, chatOf, inWords, type Pending, say, tapback } from "./context.js";
import { applyAdjustment, groupFor, handleAdjustment, handleExpense, proposeNew } from "./expense.js";
import { extractInput } from "./inputs.js";
import { claimFollowups, handleClaim, handleReceipt, proposeReceipt } from "./receipt.js";
import {
  announceSettlements,
  approve,
  dispute,
  finalize,
  routeReaction,
  settleTarget,
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
  approval: "Want to pay your part?",
};

export async function processMessage(ctx: BrainCtx, m: Message): Promise<void> {
  await ctx.db.set_message_result({
    message_id: m.message_id,
    status: "processing",
  });
  try {
    let intent: Intent | undefined;
    let confidence: number | undefined;

    if (m.kind === "reaction") {
      await routeReaction(ctx, m); // §6.2: never classified
    } else {
      ctx.memory.observeStyle(m); // flags only, no text
      // The gate sees every message; Grok only sees what the gate passes
      // (§19, §16.3). Memory, and so all later context, holds only
      // money-related messages.
      const input = extractInput(ctx, m);
      const result = await ctx.classify(input);
      intent = result.intent;
      confidence = result.confidence;
      const decision = decide(result, input);
      const moneyRelated = decision !== "ignore" && MONEY_INTENTS.has(intent);
      ctx.log("classified", { message_id: m.message_id, group_id: m.group_id, intent, confidence, decision });

      const answered = (await mayAnswerPending(ctx, m, moneyRelated)) && (await answerPending(ctx, m));
      // "why?" right after Tab's balance reply: the short explanation.
      const why = !answered && WHY.test((m.text ?? "").trim()) && lastTabPurpose(ctx, m) === "balance_reply";
      if (why) await handleBreakdown(ctx, m);
      if (answered || moneyRelated || why) ctx.memory.remember(m);
      if (!answered && !why) {
        if (decision === "act") await act(ctx, m, intent);
        else if (decision === "clarify") await clarify(ctx, m, intent);
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
      return handleAdjustment(ctx, m, m.text ?? "", boundIf("proposed"));
    case "name_reply":
      return handleNameReply(ctx, m);
    case "approval": {
      // decide() already required >= 0.90 and an open settle request (P7).
      const e = boundIf("finalized") ?? settleTarget(ctx, m);
      return e ? approve(ctx, m, e) : undefined;
    }
    case "dispute": {
      const e = boundIf("finalized") ?? settleTarget(ctx, m);
      return e ? dispute(ctx, m, e) : undefined;
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
  const question = CONFIRM_QUESTION[intent];
  if (!question) return; // e.g. a possible name: never guess (P3), stay quiet (P1)
  await tapback(ctx, m, "question");
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id: `clarify:${m.message_id}`,
    text: question,
  });
  ctx.memory.pending.set(chatKey(chatOf(m)), {
    kind: "confirm",
    then: intent === "expense" ? "expense" : "approval",
    source: m,
    asked_at: ctx.now(),
  });
}

// If Tab asked something in this chat, try the message as the answer. An
// answer is accepted only if it actually resolves something; otherwise the
// message is classified normally.
// An open question is answered by the person Tab asked, or by anyone whose
// message the gate itself judged money-related.
async function mayAnswerPending(ctx: BrainCtx, m: Message, moneyRelated: boolean): Promise<boolean> {
  const p = ctx.memory.pending.get(chatKey(chatOf(m)));
  return Boolean(p) && (m.sender_phone === p!.source.sender_phone || moneyRelated);
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

  const answerer =
    m.sender_phone === p.source.sender_phone
      ? m.text
      : `${nameOf(ctx, m)}: ${m.text}`;
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
        id: `clarify:${m.message_id}`,
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
  else if (p.then === "approval") {
    const e = settleTarget(ctx, p.source);
    if (e) await approve(ctx, { ...m }, e);
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
  for (const e of ctx.store
    .expenses()
    .filter((x) => x.status === "proposed" && x.objection_deadline)) {
    const deadline = e.objection_deadline!;
    if (now >= deadline) {
      await finalize(ctx, e);
      continue;
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
  }
  await claimFollowups(ctx);
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
    await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id: `clarify:${m.message_id}`, text: "What was the total?" });
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
  const tip = /^(none|no tip|nothing|zero|didn'?t|no)\b/i.test(text) ? 0 : answerCents(text);
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

// "22", "$18.50", "it was 30": the first amount typed.
function answerCents(text: string): number | undefined {
  const match = text.match(/\$?(\d{1,6}(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1]) * 100) : undefined;
}
