// When nobody answers (SPEC §7.3, ghosting): Tab's questions expire after
// PENDING_QUESTION_TTL, which used to leave an expense missing who paid or
// how much sitting on the ledger forever. Now it gets one more ask the next
// morning, and if nobody knows by NEEDS_INFO_DROP_AFTER it's dropped quietly
// (the re-ask says so). Settle-ups list what's still open (settle.ts).
import * as T from "../copy/templates.js";
import type { Problem } from "../extraction/types.js";
import type { Expense } from "../store/types.js";
import { activeMembers, alreadyQueued, type BrainCtx, perExpense, say } from "./context.js";
import { addThread, openThreads } from "./threads.js";

const MORNING_HOUR = 10;

function localHour(at: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(at));
}

// The first 10:00 in the group's timezone at least REASK_AFTER after it was
// logged: an expense from last night is asked about this morning. In
// DEMO_MODE (no quiet hours) just the scaled delay.
export function reaskAt(ctx: BrainCtx, e: Expense, timezone: string): Date {
  const earliest = new Date(e.created_at.getTime() + ctx.timing.durations.NEEDS_INFO_REASK_AFTER);
  if (!ctx.timing.quietHours) return earliest;
  const t = new Date(earliest);
  t.setMinutes(0, 0, 0);
  if (t < earliest) t.setTime(t.getTime() + 3_600_000);
  for (let i = 0; i < 48 && localHour(t, timezone) !== MORNING_HOUR; i++) t.setTime(t.getTime() + 3_600_000);
  return t;
}

// What's missing, as the question Tab would ask: who paid, then how much.
function missing(e: Expense): Problem[] {
  return [...(!e.payer_phone ? [{ kind: "missing_payer" as const }] : []), ...(e.total_cents === 0 ? [{ kind: "missing_amount" as const }] : [])];
}

export async function staleExpenses(ctx: BrainCtx) {
  const now = ctx.now();
  const d = ctx.timing.durations;
  await perExpense(ctx, ctx.store.expenses().filter((e) => e.status === "needs_info"), async (e) => {
    // Never under a question Tab is still waiting on.
    if (openThreads(ctx, { group_id: e.group_id }).some((t) => t.expense_id === e.expense_id || t.expense_ids?.includes(e.expense_id))) return;
    if (now.getTime() - e.created_at.getTime() >= d.NEEDS_INFO_DROP_AFTER) {
      await ctx.db.cancel_outbox({ expense_id: e.expense_id });
      await ctx.db.upsert_expense({ ...e, status: "void" });
      ctx.log("needs_info_dropped", { expense_id: e.expense_id, group_id: e.group_id });
      return;
    }
    const id = `reask:${e.expense_id}`;
    const timezone = ctx.store.group(e.group_id)?.timezone ?? "America/Detroit";
    if (alreadyQueued(ctx, id) || now < reaskAt(ctx, e, timezone)) return;
    const problems = missing(e);
    const source = ctx.store.messages().find((m) => m.message_id === e.source_message_id);
    if (problems.length === 0 || !source?.text) return;
    const people = activeMembers(ctx, e.group_id).map((m) => ({ phone: m.phone, name: m.name }));
    const question = T.clarifyingQuestion(problems[0]!, { description: e.description === "Expense" ? undefined : e.description, people });
    await say(ctx, {
      chat: { group_id: e.group_id },
      purpose: "clarifying_question",
      id,
      text: T.reAsk(question),
      expense_id: e.expense_id,
      reply_to: source.message_id,
    });
    // A fresh question, so whoever knows can answer it like the first one.
    addThread(ctx, { group_id: e.group_id }, {
      id,
      text: question,
      expense_id: e.expense_id,
      who: "anyone",
      asker: source.sender_phone,
      data: { kind: "expense", source, text: source.text, problems, expense_id: e.expense_id, asked_at: now },
    });
  });
}
