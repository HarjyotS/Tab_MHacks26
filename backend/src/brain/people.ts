// SPEC §19: STOP, START, and "delete my data", handled before the gate. They
// are commands, not chat, so they never reach Jev or Grok, and their text
// isn't kept. Someone who texted STOP gets no more DMs (the module skips
// them), is left out of new splits, and Tab ignores what they say until they
// text START. What's already on the tab stays.
import * as T from "../copy/templates.js";
import type { Message } from "../store/types.js";
import { type BrainCtx, chatOf, say } from "./context.js";

const STOP = /^(?:stop|stop ?all|unsubscribe|stop texting me|stop messaging me)[\s.!]*$/i;
const START = /^(?:start|unstop|resume)[\s.!]*$/i;
const DELETE_REQUEST =
  /^(?:(?:please|pls|can you|could you)\s+)?(?:delete|erase|remove|wipe)\s+(?:all\s+(?:of\s+)?)?my\s+(?:data|info|information|stuff|account|number|everything)\b[\s\S]*$|^forget me[\s.!]*$/i;
const DELETE_CONFIRM = /^delete[\s.!]*$/i;
// "@tab stop", "tab, stop", "hey tab stop".
const TO_TAB = /^(?:hey\s+)?@?tab\b[\s,:]*/i;

// How long "reply DELETE to confirm" stays open.
const CONFIRM_WINDOW_MS = 2 * 60 * 60 * 1000;

export const optedOut = (ctx: BrainCtx, phone: string): boolean => ctx.store.person(phone)?.opted_out ?? false;

// In a DM everything is to Tab. In the group, only "@tab stop" or a reply
// to one of Tab's messages counts: a bare "STOP 😭" is a friend laughing.
function command(ctx: BrainCtx, m: Message): string | undefined {
  const text = (m.text ?? "").trim();
  if (m.kind !== "text" || !text) return undefined;
  if (!m.group_id) return text.replace(TO_TAB, "");
  if (TO_TAB.test(text)) return text.replace(TO_TAB, "");
  const toTab = m.reply_to_id && ctx.store.outbox().some((o) => o.sent_photon_id === m.reply_to_id);
  return toTab ? text : undefined;
}

// The DM that asked "reply DELETE to confirm", if it's still open.
function askedToConfirm(ctx: BrainCtx, phone: string): boolean {
  const now = ctx.now().getTime();
  return ctx.store
    .outbox()
    .some((o) => o.action_id.startsWith(`forget_ask:${phone}:`) && o.status !== "cancelled" && now - o.created_at.getTime() <= CONFIRM_WINDOW_MS);
}

// True when the message was a STOP, START, or deletion command, or came from
// someone who opted out: either way nothing else should look at it.
export async function handlePersonCommand(ctx: BrainCtx, m: Message): Promise<boolean> {
  if (m.kind === "system") return false;
  const phone = m.sender_phone;
  const text = command(ctx, m);
  const reply = (id: string, words: string, private_ = false) =>
    say(ctx, {
      chat: private_ ? { dm_phone: phone } : chatOf(m),
      purpose: "opt_out",
      id,
      text: words,
      reply_to: private_ && m.group_id ? undefined : m.message_id,
    });

  if (text !== undefined && STOP.test(text)) {
    if (!optedOut(ctx, phone)) {
      await ctx.db.set_opt_out({ phone, opted_out: true });
      await reply(`opt_out:${m.message_id}`, m.group_id ? T.optedOutInGroup() : T.optedOut());
    }
    ctx.log("opted_out", { message_id: m.message_id, group_id: m.group_id });
    return true;
  }
  if (text !== undefined && START.test(text)) {
    if (optedOut(ctx, phone)) {
      await ctx.db.set_opt_out({ phone, opted_out: false });
      await reply(`opt_in:${m.message_id}`, T.optedIn());
      ctx.log("opted_in", { message_id: m.message_id, group_id: m.group_id });
      return true;
    }
    return !m.group_id; // a stray "start" in a DM needs nothing else either
  }
  if (text !== undefined && DELETE_REQUEST.test(text)) {
    // The details go by DM, even when asked in the group.
    await reply(`forget_ask:${phone}:${m.message_id}`, T.confirmDeletion(), true);
    if (m.group_id) await reply(`forget_ask_ack:${m.message_id}`, T.deletionByDm());
    ctx.log("deletion_requested", { message_id: m.message_id, group_id: m.group_id });
    return true;
  }
  if (!m.group_id && text !== undefined && DELETE_CONFIRM.test(text) && askedToConfirm(ctx, phone)) {
    await ctx.db.forget_person({ phone });
    await reply(`forgotten:${m.message_id}`, T.dataDeleted(), true);
    ctx.log("person_forgotten", { message_id: m.message_id });
    return true;
  }
  // They texted STOP: Tab leaves what they say alone until START.
  return optedOut(ctx, phone);
}
