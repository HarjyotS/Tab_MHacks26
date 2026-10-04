// SPEC §11.1 processing loop and §11.2 scheduler.
import type { ClassifyInput, ClassifyResult, Intent } from "@tab/gate";
import { thresholds } from "../config.js";
import { decide, type Decision } from "../gate/decide.js";
import type { AnswerResolution, OpenThread } from "../extraction/types.js";
import type { Expense, Message } from "../store/types.js";
import { type BrainCtx, chatOf, type Pending, perExpense, say, tapback } from "./context.js";
import { agreesWithSplit, applyAdjustment, groupFor, handleAdjustment, handleExpense, keepSplit, latestOpen, PRESENCE, priceChange, proposeNew } from "./expense.js";
import { describePhotos, extractInput, gateInput, remember, repliedExpense } from "./inputs.js";
import { askReceipt, askWhichItems, claimFollowups, claimTargets, handleClaim, handleReceipt, proposeReceipt } from "./receipt.js";
import {
  acceptSplit,
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
import { askWhichCorrection, clearlyCorrects, correctionCandidates, handleCorrection } from "./correction.js";
import { handleLedger } from "./ledger.js";
import { BREAKDOWN_COMMAND, handleBreakdownCommand, handleShortWhy, hintBreakdown, whyOweTarget } from "./breakdown.js";
import {
  handleHelp,
  handleNameReply,
  onboardNewGroups,
} from "./talk.js";
import { answerQuestion } from "./ask.js";
import { answerWhatItWas, handleBalance, handleBreakdownQuestion, historyFallback, referentExpense } from "./history.js";
import { addInvite, addThread, closeThread, holdsLockIn, INVITES, isAsker, mayAnswer, openThreads, type Thread, threadForReply } from "./threads.js";
import * as T from "../copy/templates.js";

// Intents whose messages are about money: the only ones kept as context and
// the only ones (besides answers from the person Tab asked) sent to Grok.
// `answer` is kept only once it actually answers one of Tab's questions.
const MONEY_INTENTS = new Set<Intent>([
  "expense", "receipt", "split_adjustment", "claim", "correction",
  "approval", "dispute", "payment_reported", "balance_query", "breakdown_request",
  "answer", "money_question",
]);

// A question about an amount that already exists, not a new expense.
const AMOUNT_QUESTION = /^(why|what'?s|whats|how|where)\b.*\d|\b(from|for)\?\s*$/i;
const WHY = /^(why|how|how come|how so|wdym|what'?s that( from| for)?)\b/i;

// Intents that ask Tab something rather than tell it.
const ASKING = new Set<Intent>(["help", "balance_query", "breakdown_request", "money_question"]);

const YES =
  /^(yes|yep|yeah|ya|yup|sure|ok|okay|correct|right|do it|go ahead|that's right)\b/i;
const NO = /^(no|nope|nah|wrong|not right)\b/i;

// Questions Tab asks when the gate is unsure (§6.4 clarify band). Intents
// that only read data are answered directly; names are never guessed.
// Never silence on money talk (Harjyot's playground on #35): every money
// intent Tab can act on has a question here or its own handler in clarify().
const CONFIRM_QUESTION: Partial<Record<Intent, string>> = {
  expense: T.confirmExpense(),
  correction: T.confirmCorrection(),
  dispute: T.confirmDispute(),
  settle_up: T.confirmSettleUp(),
  // An unsure photo: ask before the receipt read, never go quiet (§6.4).
  receipt: T.confirmReceipt(),
};

// Intents that only read data or point to the 👍: answered even when unsure.
// Not `receipt`: an unsure photo gets a question, not the receipt read (§19).
const ANSWER_ANYWAY = new Set<Intent>(["help", "balance_query", "breakdown_request", "money_question", "approval"]);

// iPhones type curly quotes ("I’m", "didn’t"); every parser expects ASCII.
export function normalizeText(text: string | undefined): string | undefined {
  return text?.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
}

// Counts what handlers write (outbox rows and money state), so the last
// resort below knows when a message got neither a reply nor a change.
function trackWrites(base: BrainCtx): { ctx: BrainCtx; wrote: () => boolean } {
  let writes = 0;
  const db = new Proxy(base.db, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver) as unknown;
      if (typeof v !== "function" || key === "set_message_result") return v;
      return (...args: unknown[]) => {
        writes++;
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { ctx: { ...base, db }, wrote: () => writes > 0 };
}

// Intents that make an unanswered message worth a last-resort look by the
// money brain. "answer" is the open-threads intent (#35).
const FALLBACK_INTENTS = new Set<string>([...MONEY_INTENTS, "answer"]);
const FALLBACK_MIN_CONFIDENCE = 0.3;

// Why a message that got no reply and changed nothing should still get one
// (Harjyot: "it just gives up"), or undefined to stay quiet (P1). Chatter
// never qualifies: an ignore, or a non-money guess with nothing open.
// A message the gate decided to ignore (below the clarify bar) only gets
// here with open money context in the chat: one of Tab's questions open, or
// an inline reply to Tab (Joe's review on #38, §19).
export function fallbackReason(
  m: Message,
  result: { intent: Intent; confidence: number; prefiltered?: boolean },
  decision: Decision,
  input: ClassifyInput,
  threadsOpen: boolean,
): string | undefined {
  if (m.kind !== "text" || !m.text?.trim() || result.prefiltered || result.intent === "ignore") return undefined;
  if (result.confidence < FALLBACK_MIN_CONFIDENCE) return undefined;
  if (decision === "ignore" && !threadsOpen && !input.message.reply_to_tab) return undefined;
  if (FALLBACK_INTENTS.has(result.intent)) return `unsure_${result.intent}`;
  if (input.message.reply_to_tab) return "reply_to_tab";
  if (input.tab_question_open) return "open_question";
  const open = input.open_items.some(
    (o) => o.expense_status === "proposed" || o.expense_status === "itemizing" || (o.expense_status === "finalized" && o.my_share_status === "locked"),
  );
  return open ? "open_split" : undefined;
}

export async function processMessage(base: BrainCtx, raw: Message): Promise<void> {
  const { ctx, wrote } = trackWrites(base);
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
      // Photos are described by Grok vision first (§7.4, user-authorized),
      // so the gate can tell a receipt from a meme.
      await describePhotos(ctx, m);
      const input = { ...gateInput(ctx, m), tab_question_open: openThreads(ctx, chatOf(m)).length > 0 };
      remember(ctx, m); // the gate's 15-minute raw transcript, memory only
      const result = await ctx.classify(input);
      intent = result.intent;
      confidence = result.confidence;
      const decision = decide(result, input);
      const moneyRelated = decision !== "ignore" && MONEY_INTENTS.has(intent) && intent !== "answer";
      ctx.log("classified", {
        message_id: m.message_id, group_id: m.group_id, intent, confidence, decision,
        prefiltered: result.prefiltered === true,
      });

      // "@Tab breakdown" (§7.8): the full trace of where amounts come from,
      // checked before anything else so an open question can't swallow it.
      // "why do I owe Priya" is the same thing for one person.
      const whyOwe = whyOweTarget(m);
      const breakdown = BREAKDOWN_COMMAND.test((m.text ?? "").trim()) || whyOwe !== undefined;
      if (breakdown) await handleBreakdownCommand(ctx, whyOwe ? { ...m, text: `@tab breakdown ${whyOwe}` } : m);
      const reply: Reply = breakdown ? { answered: false } : await answerThreads(ctx, m, result, decision);
      const answered = reply.answered;
      // "why?" right after Tab's balance reply: the short answer (Joe's rule).
      // A full question the gate passed ("how much did we spend on food?")
      // is answered as itself.
      const why =
        !breakdown && !answered && !(decision !== "ignore" && intent === "money_question") &&
        WHY.test((m.text ?? "").trim()) && lastTabPurpose(ctx, m) === "balance_reply";
      // With nothing open, "why?" says what "it" was or their last payment (§7.8 History).
      if (why) await handleShortWhy(ctx, m, () => historyFallback(ctx, m));
      // "@tab ledger" (§12.3): addressed to Tab, or a question the gate passed.
      const ledger = !breakdown && !answered && !why && wantsLedger(m, intent, decision);
      if (ledger) await handleLedger(ctx, m);
      keep = breakdown || answered || moneyRelated || why || ledger;
      // Stored as an answer, so it stays in later context (§19 keeps it).
      if (answered) intent = "answer";
      if (!keep) intent = "ignore";
      let failed: unknown;
      if (!breakdown && !answered && !why && !ledger) {
        try {
          if (decision === "act") await act(ctx, m, result.intent);
          else if (decision === "clarify") await clarify(ctx, m, result.intent, undefined, result.confidence);
        } catch (err) {
          failed = err; // still worth a last-resort answer below
        }
      } else if (reply.rest) {
        // The same message also said something else ("yep, and I got gas $30").
        if (reply.rest.decision === "act") await act(ctx, m, reply.rest.intent);
        else await clarify(ctx, m, reply.rest.intent, `clarify:${m.message_id}:rest`);
      }
      // Last resort: a money-ish message that got no reply and changed
      // nothing goes to the money brain, which answers or asks one specific
      // question. It only writes text. Anything that already replied
      // (including another fallback) wins.
      // #35's own fallbacks (a clarify question, a follow-up) write, so
      // they win; a reply already queued for this message wins too.
      const replied = ctx.store.outbox().some((o) => o.target_message_id === m.message_id);
      const reason = !wrote() && !replied
        ? fallbackReason(m, result, decision, input, openThreads(ctx, chatOf(m)).length > 0)
        : undefined;
      // A bare "yeah" / "ok" / "bet" right after a split is agreement, not a
      // question for the money brain (playground: "yeah" after the payer's 👍
      // got the proposal posted again). Tab likes it; an open split counts it.
      const agreed = reason && ctx.ask && !m.is_dm ? recentSplit(ctx, m) : undefined;
      if (agreed) {
        await tapback(ctx, m, "like", agreed.expense_id);
        if (agreed.status === "proposed") await acceptSplit(ctx, agreed, m.sender_phone);
        keep = true;
        ctx.log("agreement_liked", { message_id: m.message_id, group_id: m.group_id, expense_id: agreed.expense_id });
      } else if (reason && (await answerWhatItWas(ctx, m))) {
        // "what was it for" right after one of Tab's messages is answered
        // from that message's records, no Grok needed (§7.8 History).
        ctx.log("fallback_history", { message_id: m.message_id, group_id: m.group_id, reason });
        keep = true;
        intent = result.intent;
      } else if (reason && ctx.ask) {
        ctx.log("fallback_ask", { message_id: m.message_id, group_id: m.group_id, reason, intent: result.intent, confidence: result.confidence });
        const about = repliedExpense(ctx, m) ?? latestOpen(ctx, groupFor(ctx, m), ["proposed", "itemizing"]);
        // Kept (§19) only if Tab actually answered it.
        if (await answerQuestion(ctx, m, "fallback", about, result.intent)) {
          keep = true;
          intent = result.intent;
        }
      }
      if (failed) throw failed;
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
const READ_INTENTS = new Set<Intent>(["help", "balance_query", "breakdown_request", "money_question"]);

function wantsLedger(m: Message, intent: Intent, decision: string): boolean {
  const text = (m.text ?? "").trim();
  if (!LEDGER_ASK.test(text)) return false;
  return TO_TAB.test(text) || m.group_id === undefined || (decision !== "ignore" && READ_INTENTS.has(intent));
}

// Lives in inputs.ts now, which also shows the gate the bound expense.
export { repliedExpense };

async function act(ctx: BrainCtx, m: Message, intent: Intent) {
  const bound = repliedExpense(ctx, m);
  const boundIf = (...statuses: Expense["status"][]) => (bound && statuses.includes(bound.status) ? bound : undefined);
  switch (intent) {
    case "expense": {
      // A captioned photo ("dinner, i paid") is still a receipt.
      if (m.kind === "image") return handleReceipt(ctx, m);
      // "actually the uber was $30 not $24": a correction to the open Uber, not
      // a second one. The gate said new expense, so only when it clearly is one.
      const candidates = clearlyCorrects(m.text ?? "") ? correctionCandidates(ctx, m) : [];
      if (candidates.length > 1) return askWhichCorrection(ctx, m);
      return candidates[0] ? handleCorrection(ctx, m, candidates[0]) : handleExpense(ctx, m);
    }
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
    // Balances and breakdowns are templates: deterministic, and instant
    // (Joe's review on #38), with the sender's history when nothing is open
    // (§7.8 History). Anything else about money goes to the money brain
    // (§7.8 Questions), with the expense an inline reply points at, or the
    // one "that" points back to in Tab's recent messages.
    case "balance_query":
      return handleBalance(ctx, m);
    case "breakdown_request":
      // Free-form ("what's the $90.70 from?"): the command answers, unless
      // it's "what was it for" or the sender has nothing open (history.ts).
      return handleBreakdownQuestion(ctx, m);
    case "money_question":
      if (await answerWhatItWas(ctx, m)) return;
      return void (await answerQuestion(ctx, m, "money_question", bound ?? referentExpense(ctx, m)));
    case "help":
      return handleHelp(ctx, m);
    case "receipt":
      return handleReceipt(ctx, m);
    case "claim": {
      // "i got both drinks and jordan got the cheesecake" on an even receipt
      // nobody is itemizing yet: price what they named from the receipt.
      const receipt = claimTargets(ctx, m).length === 0 && !boundIf("itemizing") ? receiptToSplit(ctx, m) : undefined;
      return receipt ? handleAdjustment(ctx, m, m.text ?? "", receipt) : handleClaim(ctx, m, boundIf("itemizing"));
    }
    case "correction": {
      if (bound && bound.status !== "void") return handleCorrection(ctx, m, bound);
      const candidates = correctionCandidates(ctx, m);
      if (candidates.length > 1) return askWhichCorrection(ctx, m);
      return handleCorrection(ctx, m, candidates[0]);
    }
    case "answer":
      return; // Not an answer to anything still open (answerThreads): stay quiet (P1).
    // payment_reported is ignored in the MVP; ignore needs nothing.
    default:
      ctx.log("intent_not_handled", { message_id: m.message_id, intent });
  }
}

// `id` differs when the same message also answered one of Tab's questions,
// which may have asked something already.
// Fairly sure it's an expense, just short of the act bar: after "yes" the
// sender is the payer, so Tab asks one question, not two.
const FAIRLY_SURE = 0.75;

async function clarify(ctx: BrainCtx, m: Message, intent: Intent, id = `clarify:${m.message_id}`, confidence = 0) {
  // A possible name is acted on only right after Tab asked an unnamed sender
  // for theirs; otherwise never guess a name (P3).
  if (intent === "name_reply") return answeringNamePrompt(ctx, m) ? act(ctx, m, intent) : undefined;
  if (ANSWER_ANYWAY.has(intent)) return act(ctx, m, intent);
  if (intent === "claim") {
    // An open item list: ask which. An even receipt: confirm the change.
    const bound = repliedExpense(ctx, m);
    const list = bound?.status === "itemizing" ? bound : claimTargets(ctx, m)[0];
    if (list) return askWhichItems(ctx, m, list);
    const receipt = receiptToSplit(ctx, m);
    if (receipt) return handleAdjustment(ctx, m, m.text ?? "", receipt, { confirmOnly: true });
    return ctx.log("no_handler", { message_id: m.message_id, intent });
  }
  // Unsure, but it reads as a correction to an open expense it names: ask
  // "change uber to $30?" and apply only on yes (Joe's review on #44), never
  // "want me to split that?" about a duplicate.
  const candidates = intent === "expense" || intent === "correction" ? correctionCandidates(ctx, m) : [];
  if (candidates.length > 1) return askWhichCorrection(ctx, m);
  if (candidates[0]) return confirmCorrectionOf(ctx, m, candidates[0], id);
  // "whats the $90.70 from?" asks about a balance; offering to split it as a
  // new expense would be wrong. Point to the command instead (live run).
  if (intent === "expense" && AMOUNT_QUESTION.test(m.text ?? "")) return hintBreakdown(ctx, m);
  // §6.4: an unsure adjustment is about an open expense, so ask rather than
  // stay silent: explain what's wrong, or confirm before applying.
  if (intent === "split_adjustment") {
    const bound = repliedExpense(ctx, m);
    const target = bound?.status === "proposed" || bound?.status === "finalized" ? bound : undefined;
    return handleAdjustment(ctx, m, m.text ?? "", target, { confirmOnly: true });
  }
  // When a yes will also mean "I paid", the question says so (P3, audit of
  // #57): "you got that? want me to split it?", never a silent assumption.
  const senderPaid = intent === "expense" && confidence >= FAIRLY_SURE;
  const question = senderPaid ? T.confirmYourExpense() : CONFIRM_QUESTION[intent];
  if (!question) return ctx.log("no_handler", { message_id: m.message_id, intent });
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
    data: intent === "expense"
      ? { kind: "confirm", then: "expense", source: m, sender_paid: senderPaid, asked_at: ctx.now() }
      : { kind: "confirm", then: "act", intent, source: m, asked_at: ctx.now() },
  });
}

async function confirmCorrectionOf(ctx: BrainCtx, m: Message, e: Expense, id: string) {
  const { result } = await ctx.extract.correction(extractInput(ctx, m));
  const text = T.confirmCorrectionTo(e.description, result.new_amount_cents);
  await tapback(ctx, m, "question", e.expense_id);
  await say(ctx, { chat: chatOf(m), purpose: "clarifying_question", id, reply_to: m.message_id, text, expense_id: e.expense_id });
  addThread(ctx, chatOf(m), {
    id, text, who: "asker", asker: m.sender_phone, expense_id: e.expense_id,
    data: { kind: "confirm", then: "act", intent: "correction", source: m, asked_at: ctx.now() },
  });
}

// The proposed receipt a message about items is about: the one it replies
// to, else the newest in the group with line items.
function receiptToSplit(ctx: BrainCtx, m: Message): Expense | undefined {
  const bound = repliedExpense(ctx, m);
  if (bound) return bound.status === "proposed" && ctx.store.lineItems(bound.expense_id).length > 0 ? bound : undefined;
  return ctx.store
    .expenses()
    .filter((e) => e.group_id === groupFor(ctx, m) && e.status === "proposed" && ctx.store.lineItems(e.expense_id).length > 0)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
}

type Reply = {
  answered: boolean;
  // What else the message does, handled as if it had come on its own.
  rest?: { intent: Intent; decision: "act" | "clarify" };
};

// Tab's open questions in this chat (threads.ts), tried before normal
// handling. An answer is accepted only if it actually resolves something;
// otherwise the message is handled as if nothing were open.
// Who may answer (Harjyot's review on #14): a question about the sender's
// own money only the person Tab asked; a missing fact, or a reply Tab
// invited, anyone. A bystander's "uber was $30, I paid" is their own
// expense, not an answer: Grok says so, and it's handled as one.
async function answerThreads(ctx: BrainCtx, m: Message, result: ClassifyResult, decision: Decision): Promise<Reply> {
  const no: Reply = { answered: false };
  if (m.kind !== "text" || !m.text) return no;
  const mine = openThreads(ctx, chatOf(m)).filter((t) => mayAnswer(t, m));
  if (mine.length === 0) return no; // nothing open: exactly as before
  const passed = decision !== "ignore";
  // An inline reply picks its question for certain, but lowers no bar.
  const replied = threadForReply(ctx, m, mine);
  const pool = replied ? [replied] : mine;

  // 1. Today's parsers, for a plain answer to exactly one question: no Grok
  //    call. The settle-mode question takes a parser answer only when it's
  //    the only question open, or replied to inline: a "nah" to anything else
  //    must not switch the group's mode (Joe's review on #35). And a question
  //    Tab asked the sender themselves comes first: their "no" to a large
  //    amount, "no tip", or "no" to a receipt total answers it.
  const hits = pool.flatMap((t) => {
    if (t.data.kind === "settle_mode" && t !== replied && mine.length > 1) return [];
    const apply = quickAnswer(ctx, m, t);
    return apply ? [{ t, apply }] : [];
  });
  const own = hits.filter((h) => h.t.who === "asker" && isAsker(h.t, m));
  const hit = own.length === 1 ? own[0] : hits.length === 1 ? hits[0] : undefined;
  if (hit) {
    await hit.apply();
    return { answered: true };
  }
  // 2. A question about an expense, answered by the person Tab asked (or
  //    inline by someone the gate passed): read it again with the answer.
  const reask = pool.find(
    (t) => (t.data.kind === "expense" || t.data.kind === "adjustment") && (isAsker(t, m) || (t === replied && passed)),
  );
  if (reask && (await answerExpense(ctx, m, reask, isAsker(reask, m) ? m.text : inThirdPerson(m.text, nameOf(ctx, m)))))
    return { answered: true };

  // "just me and priya" to an open split (Harjyot's playground: Jev called
  // it name_reply at 0.41 and Tab said nothing). Taken as a change to that
  // split unless the gate is sure it's something else or plain chatter;
  // short of the act bar Tab confirms first.
  const split = pool.find((t) => t.data.kind === "split_open");
  const elsewhere = decision === "act" && result.intent !== "split_adjustment" && result.intent !== "answer";
  // Anything the gate called chatter stays out of Grok (§19), however unsure.
  const chatter = result.intent === "ignore";
  if (split && PRESENCE.test(m.text) && !elsewhere && !chatter) {
    const e = threadExpense(ctx, split, "proposed");
    if (e) {
      const sure = decision === "act" && result.confidence >= thresholds.act;
      await handleAdjustment(ctx, m, m.text, e, { confirmOnly: !sure });
      return { answered: true };
    }
  }

  // A message that clearly answers one of Tab's questions but can't be used
  // gets one short follow-up, never silence (Harjyot's playground: "its on
  // the receipt" got nothing, and its text was cleared). Clearly: the gate
  // passed it as an answer, or it replies inline to that question; a
  // question of their own is answered as one instead.
  const clearly = (t: Thread | undefined) =>
    t && !INVITES.has(t.data.kind) && passed && !ASKING.has(result.intent) && (result.intent === "answer" || t === replied)
      ? t
      : undefined;
  const stuck = clearly(reask) ?? clearly(replied);
  const grok = await askGrok(ctx, m, result, decision, pool.filter((t) => t !== reask));
  if (grok.answered) return grok;
  // Grok matched a question it couldn't read an answer to, or the parsers
  // and the re-read couldn't.
  const unresolved = grok.matched && !INVITES.has(grok.matched.data.kind) ? grok.matched : stuck;
  return unresolved ? followUp(ctx, m, unresolved) : no;
}

// "its on the receipt" when it isn't: say so once and ask again, keeping
// the question open. The message counts as an answer (kept, §19).
async function followUp(ctx: BrainCtx, m: Message, t: Thread): Promise<Reply> {
  ctx.log("answer_unresolved", { message_id: m.message_id, group_id: m.group_id, kind: t.data.kind });
  if (t.followed_up) return { answered: true }; // asked again once already: quiet (P1)
  t.followed_up = true;
  const onReceipt = /\breceipt\b/i.test(m.text ?? "") && Boolean(t.expense_id && ctx.store.lineItems(t.expense_id).length > 0);
  await say(ctx, {
    chat: chatOf(m),
    purpose: "clarifying_question",
    id: `followup:${m.message_id}`,
    reply_to: m.message_id,
    text: T.answerFollowup(t.text, onReceipt),
    expense_id: t.expense_id,
  });
  return { answered: true };
}

// Step 3 of answerThreads.
async function askGrok(
  ctx: BrainCtx,
  m: Message,
  result: ClassifyResult,
  decision: Decision,
  offered: Thread[],
): Promise<Reply & { matched?: Thread }> {
  const no: Reply = { answered: false };

  // 3. Grok, for everything the parsers can't read. Only a money message or
  //    an answer the gate acts on ever reaches it (§19, §16.3). For invites
  //    alone the gate's own intent already reaches the same handler ("2" to
  //    the item list is a claim), so it isn't asked then unless the gate
  //    called it an answer. A dispute takes only a clear amount, which the
  //    parsers read already.
  // The settle-mode question stays open for hours after onboarding; the
  // parsers read most answers to it, so it alone doesn't send every new
  // expense to Grok.
  const asked = offered.filter((t) => !INVITES.has(t.data.kind) && t.data.kind !== "settle_mode" && t.data.kind !== "dispute");
  // Only a message the gate is sure is about money, or an answer (Joe's
  // review on #35: not the clarify band, not settle_up or name_reply).
  const sure = decision === "act" && MONEY_INTENTS.has(result.intent);
  // A question of their own ("what do i owe", "how do we settle up?") is
  // answered as one, never read as an answer.
  if (offered.length === 0 || !sure || ASKING.has(result.intent)) return no;
  if (result.intent !== "answer" && asked.length === 0) return no;
  let r: AnswerResolution;
  try {
    r = await ctx.extract.answer(extractInput(ctx, m), offered.map((t) => threadView(ctx, m, t)));
  } catch (err) {
    ctx.log("answer_failed", { message_id: m.message_id, group_id: m.group_id, error: String(err) });
    return no;
  }
  const t = offered.find((x) => x.id === r.thread_id);
  ctx.log("answer_resolved", { message_id: m.message_id, group_id: m.group_id, kind: t?.data.kind, relevance: r.relevance, also_new: r.also_new });
  // 4. Low relevance: handled as before. Relevant but nothing usable: the
  //    caller follows up.
  if (!t || r.relevance < 0.5) return no;
  if (!(await applyAnswer(ctx, m, t, r, result, decision))) return { answered: false, matched: t };
  return { answered: true, rest: restOf(t, r, result, decision) };
}

// What each kind of question expects, for the resolver's prompt.
const EXPECTS: Record<Thread["data"]["kind"], string> = {
  expense: "the missing fact (who paid, how much, or who was in): restated",
  adjustment: "the missing fact about the split (who someone is, what an item cost): restated",
  confirm: "yes or no: yes_no",
  receipt: "",
  which: "a numbered choice: choice",
  settle_mode: "how the group wants to settle: settle_mode",
  split_open: 'a change to the split (who wasn\'t there, who had what): restated; or yes_no "no" only if they say nothing needs changing',
  adjust_open: "what is uneven, or what someone actually had: restated",
  dispute: "what their share should be, in dollars: amount_cents",
  claims_open: 'which items they had (numbers, item names, "even", or "same as" someone)',
  settle_open: 'yes_no "yes" if they agree to pay; yes_no "no" and restated if something is wrong with what they owe',
};

const RECEIPT_EXPECTS = {
  confirm_total: "yes or no, is the total Tab read right: yes_no",
  total: "the total in dollars: amount_cents",
  tip: 'the tip they left: amount_cents, percent, or yes_no "no" for none',
} as const;

function threadView(ctx: BrainCtx, m: Message, t: Thread): OpenThread {
  const d = t.data;
  const g = groupFor(ctx, m);
  const name = (g && ctx.store.members(g).find((x) => x.phone === t.asker)?.name) || "the person Tab asked";
  return {
    id: t.id,
    question: t.text,
    expects: d.kind === "receipt" ? RECEIPT_EXPECTS[d.stage] : EXPECTS[d.kind],
    ...(d.kind === "which" ? { choices: d.expense_ids.length } : {}),
    // A dispute that already has an amount is waiting on "Which one?".
    ...(d.kind === "dispute" && d.amount_cents !== undefined
      ? { expects: "a numbered choice: choice", choices: d.expense_ids.length }
      : {}),
    who: t.who === "anyone" ? "anyone" : name,
  };
}

// The resolver's fields, applied with the same handlers a message would
// reach (plan §5.5). False when they don't answer this kind of question.
async function applyAnswer(
  ctx: BrainCtx,
  m: Message,
  t: Thread,
  r: AnswerResolution,
  result: ClassifyResult,
  decision: Decision,
): Promise<boolean> {
  const d = t.data;
  // An unsure gate confirms a change to a split instead of applying it (§6.4).
  const confirmOnly = decision !== "act" || result.confidence < thresholds.act;
  switch (d.kind) {
    case "confirm":
      if (!r.yes_no) return false;
      await answerConfirm(ctx, m, t, d, r.yes_no === "yes");
      return true;
    case "receipt": {
      const { receipt } = d.read;
      const answer: ReceiptAnswer | undefined =
        d.stage === "confirm_total"
          ? r.yes_no ? r.yes_no === "yes" : undefined
          : d.stage === "total"
            ? r.amount_cents
            : r.percent !== undefined
              ? Math.round(((receipt.subtotal_cents ?? receipt.total_cents ?? 0) * r.percent) / 100) // computed in code (P6)
              : (r.amount_cents ?? (r.yes_no === "no" ? 0 : undefined));
      if (answer === undefined) return false;
      await answerReceipt(ctx, m, t, d, answer);
      return true;
    }
    case "which":
      if (!r.choice || !d.expense_ids[r.choice - 1]) return false;
      await answerWhich(ctx, m, t, d, r.choice);
      return true;
    case "settle_mode":
      if (!r.settle_mode || !m.group_id) return false;
      await answerSettleMode(ctx, m, t, r.settle_mode);
      return true;
    case "expense":
    case "adjustment": {
      // The asker's own words; anyone else's in the third person, rewritten
      // in code so "I did" from Kian can only ever mean Kian (Joe's review
      // on #35: never Grok's choice of name).
      return m.text ? answerExpense(ctx, m, t, isAsker(t, m) ? m.text : inThirdPerson(m.text, nameOf(ctx, m))) : false;
    }
    case "split_open": {
      const e = threadExpense(ctx, t, "proposed");
      if (!e) return false;
      // Agreement is never an objection: "yeah", "nope, looks right" and
      // "split 4 ways" change nothing, whatever yes_no Grok read (Harjyot's
      // playground: "yeah" got "ok what was uneven?"). Only a change goes on.
      if (agreesWithSplit(ctx, m.text ?? "", e)) return splitLooksRight(ctx, m, t, e);
      // The proposal stays open to everyone else's changes.
      await handleAdjustment(ctx, m, m.text ?? "", e, { confirmOnly });
      return true;
    }
    case "dispute": {
      // Only a clear amount of money (disputeCents: "I had 2 beers" is a
      // count, Joe on #29), or a number from "Which one?". Anything else
      // ("I wasn't there") goes through normal handling.
      const open = stillDisputed(ctx, m.sender_phone, d.expense_ids);
      if (d.amount_cents !== undefined) {
        const target = r.choice ? open.find((e) => e.expense_id === d.expense_ids[r.choice! - 1]) : undefined;
        if (!target) return false;
        await answerDispute(ctx, m, t, d, open, d.amount_cents, target);
        return true;
      }
      const amount = disputeCents(m.text ?? "");
      if (open.length === 0 || amount === undefined || amount <= 0 || r.amount_cents !== amount) return false;
      await answerDispute(ctx, m, t, d, open, amount);
      return true;
    }
    case "adjust_open": {
      const e = threadExpense(ctx, t, "proposed", "finalized");
      if (!e) return false;
      // "split 4 ways", "nvm it's even": even after all, so the split stands
      // and the question is answered (playground: Tab asked it again).
      if (agreesWithSplit(ctx, m.text ?? "", e)) {
        await keepSplit(ctx, m, e, true);
        return true;
      }
      // "oh just $10" after "What did Jake actually have?" needs the name.
      await handleAdjustment(ctx, m, r.restated ?? m.text ?? "", e, { confirmOnly });
      closeThread(ctx, chatOf(m), t);
      return true;
    }
    case "claims_open": {
      const e = threadExpense(ctx, t, "itemizing");
      const share = e && ctx.store.shares(e.expense_id).find((s) => s.phone === m.sender_phone);
      // A claim locks their share: the normal act bar (§6.4), not the answer one.
      if (!e || !share || share.status === "opted_out" || result.confidence < thresholds.act) return false;
      await handleClaim(ctx, m, e);
      return true;
    }
    case "settle_open": {
      const owed = disputeTargets(ctx, m);
      if (owed.length === 0) return false; // only someone who owes answers it
      // Only a clear yes or no: "will send it tonight" is neither (Joe's review on #35).
      if (r.yes_no === "yes") await textApproval(ctx, m); // never pays (P7)
      else if (r.yes_no === "no") await dispute(ctx, m, owed); // disputed, then asks what's off
      else return false;
      return true;
    }
  }
}

function threadExpense(ctx: BrainCtx, t: Thread, ...statuses: Expense["status"][]): Expense | undefined {
  const ids = t.expense_ids ?? (t.expense_id ? [t.expense_id] : []);
  const open = ids.map((id) => ctx.store.expense(id)).filter((e): e is Expense => Boolean(e && statuses.includes(e.status)));
  return open.length === 1 ? open[0] : undefined;
}

// "nope, looks right" to "Anything uneven?": that person is fine with it,
// as with their 👍 on the proposal (§6.2), and it locks in once everyone
// is. Unlike the payer's 👍, the payer's typed "yeah" doesn't lock it in.
async function splitLooksRight(ctx: BrainCtx, m: Message, t: Thread, e: Expense): Promise<boolean> {
  const share = ctx.store.shares(e.expense_id).find((s) => s.phone === m.sender_phone);
  if (!share || share.status === "opted_out") return false;
  await tapback(ctx, m, "like", e.expense_id);
  await acceptSplit(ctx, e, m.sender_phone);
  if (ctx.store.expense(e.expense_id)?.status !== "proposed") closeThread(ctx, chatOf(m), t);
  return true;
}

// Intents an answer to each kind of question already covers, so the gate
// seeing one of them is not a second thing to do.
const COVERS: Record<Thread["data"]["kind"], Intent[]> = {
  expense: ["expense", "receipt", "correction"],
  adjustment: ["split_adjustment", "correction"],
  confirm: ["expense", "split_adjustment", "correction", "settle_up", "approval"],
  receipt: ["expense", "receipt", "correction"],
  which: ["claim"],
  settle_mode: ["settle_up"],
  split_open: ["split_adjustment", "correction", "dispute", "approval"],
  adjust_open: ["split_adjustment", "correction", "dispute"],
  dispute: ["dispute", "correction"],
  claims_open: ["claim"],
  settle_open: ["approval", "dispute", "split_adjustment"],
};

// Plan §5.6: the rest of the message, when Grok says it also says something
// else, or the gate read a money intent the answer didn't cover. The gate's
// decision still sets the bar: below act, Tab asks instead.
function restOf(t: Thread, r: AnswerResolution, result: ClassifyResult, decision: Decision): Reply["rest"] {
  const gate =
    decision !== "ignore" && result.intent !== "answer" && MONEY_INTENTS.has(result.intent) && !COVERS[t.data.kind].includes(result.intent)
      ? result.intent
      : undefined;
  const intent = gate ?? (r.also_new ? r.also_intent : undefined);
  if (!intent) return undefined;
  // Acting needs the gate's own read at the full bar; an `answer` at 0.6
  // only asks first ("yeah, also I didn't have the wine" confirms, Joe's
  // review on #35).
  const sure = decision === "act" && result.intent !== "answer" && result.confidence >= thresholds.act;
  return { intent, decision: sure ? "act" : "clarify" };
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
  const extracted = await ctx.extract.expense(
    extractInput(ctx, { ...p.source, text }),
    mode,
  );
  // "it's the cheesecake on the receipt": an item named in the answer is
  // priced from the receipt, and "half of the cost" from the total, as in
  // the first message (§7.5).
  const expense = p.kind === "adjustment" ? ctx.store.expense(p.expense_id) : undefined;
  const retry = expense ? priceChange(ctx, expense, extracted, { text: answer, problem: p.problems[0] }) : extracted;
  if (retry.problems.length >= p.problems.length) return false; // didn't help
  closeThread(ctx, chatOf(m), t);
  if (p.kind === "adjustment") {
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
  if (p.then === "expense") await handleExpense(ctx, m, p.source.text ?? "", p.source, { senderPaid: p.sender_paid && m.sender_phone === p.source.sender_phone });
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
  } else if (p.then === "act" && p.intent) {
    await act(ctx, p.source, p.intent);
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
      if (askingAbout(ctx, e)) return;
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
      // "anything else?" reopens the split for replies.
      addInvite(ctx, { group_id: e.group_id }, { id, text: `${e.description}: ${T.objectionReminder()}`, kind: "split_open", expense_id: e.expense_id });
    }
  });
  await claimFollowups(ctx);
  await approvalFollowups(ctx);
  await announceSettlements(ctx);
}

// An unexpired question from Tab about this expense (threads.ts).
function askingAbout(ctx: BrainCtx, e: Expense): boolean {
  return openThreads(ctx, { group_id: e.group_id }).some((t) => t.expense_id === e.expense_id && holdsLockIn(t));
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
    const question = T.whatWasTotal();
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

// "yeah", "ok", "bet", "sounds good", 👍: a short message that only agrees.
const BARE_AGREEMENT = /^(?:y(?:ea+h?|es+|ep|up|a)|ok(?:ay)?|k+|kk|cool|bet|word|facts|perfect|sounds? good|looks? (?:good|right)|all good|that'?s right|correct|true|fair|for sure|fs|deal|done|👍|👌|💯)[\s!.]*$/iu;

// How soon after Tab's message a bare "yeah" still reads as agreeing to it.
const AGREEMENT_WINDOW_MS = 10 * 60_000;

// The split a bare agreement is about. Only when it's clearly about that
// split (audit of #52: a "yeah" to "movies tonight?" locked in a split):
// an inline reply to the split (Tab's message about it, or the message
// that logged it), or the very next message after Tab's last message,
// which is about that split, within a few minutes. A reply to anything
// else never counts.
function recentSplit(ctx: BrainCtx, m: Message): Expense | undefined {
  if (!m.group_id || !BARE_AGREEMENT.test((m.text ?? "").trim())) return undefined;
  const open = (e: Expense | undefined) => (e && (e.status === "proposed" || e.status === "finalized") ? e : undefined);
  if (m.reply_to_id) return open(repliedExpense(ctx, m));
  const tab = ctx.store
    .outbox()
    .filter((o) => o.group_id === m.group_id && o.kind !== "reaction" && o.status !== "cancelled" && o.created_at <= m.received_at)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  if (!tab?.expense_id || m.received_at.getTime() - tab.created_at.getTime() > AGREEMENT_WINDOW_MS) return undefined;
  const between = ctx.store
    .messages()
    // Others agreeing in a row ("yeah", "same") don't break the chain;
    // anything else said in between does. Cleared text (chatter) counts too.
    .some((x) => x.group_id === m.group_id && x.message_id !== m.message_id && x.kind !== "reaction" && x.received_at > tab.created_at && x.received_at <= m.received_at && !BARE_AGREEMENT.test((x.text ?? "").trim()));
  return between ? undefined : open(ctx.store.expense(tab.expense_id));
}

