import type { Classify, Intent } from './types.js';
import { clearlyNotReceipt } from './photo.js';

const AMOUNT = /\$?\d+(?:\.\d{2})?/;

/**
 * Keyword rules for building and testing before Jev is wired in, or when it's
 * down. Deliberately conservative: anything unclear comes back with low
 * confidence, so the backend asks instead of guessing (P3).
 */
export const stubClassifier: Classify = async ({ message, context, open_items, open_questions, sender, chat_expenses }) => {
  if (message.kind === 'reaction' || message.kind === 'system') return { intent: 'ignore', confidence: 1 };
  const hit = (intent: Intent, confidence = 0.9) => ({ intent, confidence });
  // What Grok vision saw decides a photo. A bare photo is a receipt unless it
  // clearly isn't one (a meme or plain photo with no amounts in it).
  const seen = message.photo?.kind;
  if (seen === 'receipt' || seen === 'bill') return hit('receipt');
  if (seen === 'payment_screenshot') return hit('payment_reported');
  if (message.kind === 'image' && !message.text) return clearlyNotReceipt(message.photo) ? hit('ignore', 0.8) : hit('receipt');
  const text = (message.text ?? '').trim().toLowerCase();
  const has = (status: string) => open_items.some(i => i.expense_status === status);
  const splitOpen = has('proposed') || (chat_expenses ?? []).some(e => e.status === 'proposed');

  if (/^@?tab\b.*\b(help|what can you do)\b|^what can you do/.test(text)) return hit('help');
  if (/\bwho owes|what do i owe|how much do i owe\b/.test(text)) return hit('balance_query');
  if (/\bsettle (us |everyone |it |things )?up\b|\bsquare (us|everyone) up\b|\bclose out the tab\b/.test(text)) return hit('settle_up');
  if (/\bbreakdown\b|what'?s the \$?\d+(\.\d{1,2})? (from|for)\b|\bwhy do (i|we) owe\b/.test(text)) return hit('breakdown_request');
  if (/^(what|how|who|which|when|did|does|was|were|is|are|has|have)\b/.test(text) && /\b(receipt|spend|spent|cost|costs|paid|split|total|settle|price|charged?|how much)\b/.test(text)) return hit('money_question');
  if (/\b(sent|paid) you\b.*\b(venmo|cash ?app|zelle)\b/.test(text)) return hit('payment_reported');
  if (has('finalized') && /^(yes|yep|yeah|we'?re chill|pay it|ok|okay)\b/.test(text)) return hit('approval', 0.92);
  if (has('finalized') && /^(no|nope)\b|didn'?t (get|have|eat)|\bwrong\b|only had/.test(text)) return hit('dispute');
  if (has('itemizing') && (/^[\d\s,and&]+$/.test(text) || /^even$|same as|we all split/.test(text))) return hit('claim');
  if (message.reply_to_id && /\bactually\b/.test(text) && AMOUNT.test(text)) return hit('correction');
  // Not a reply, but "actually the uber was $30 not $24" names an open expense
  // and reads as a correction; never "another uber" or "gas too" (Joe on #44).
  const named = open_items.some(i => (i.description.toLowerCase().match(/[a-z]+/g) ?? [])
    .some(w => w.length >= 4 && !['team', 'house', 'group', 'everyone', 'with', 'from', 'that', 'this', 'some'].includes(w) && new RegExp(`\\b${w}s?\\b`).test(text)));
  if (named && /\b(?:was|is|were)\s+(?:actually\s+|really\s+|only\s+)?\$?\d|\bnot\s+\$?\d/.test(text) && !/\b(another|again|too|also|second|more)\b/.test(text)) return hit('correction');
  if (/\bnot even\b|\bonly had\b|\bwasn'?t (at|there)\b/.test(text)) return hit('split_adjustment');
  // "just me and priya" said to an open split: who was there, never a name.
  if (splitOpen && /^(just|only) \w+ (and|&) \w+/.test(text)) return hit('split_adjustment');
  // While Tab waits on a question: a bare yes/no, "each", or just an amount.
  // Anything wordier is left to Jev, and the backend's own checks.
  if (open_questions?.length && (/^(yes|yep|yeah|yup|sure|ok|okay|no|nope|nah|each)\b\D{0,30}$/.test(text) || /^\$?\d+(\.\d{1,2})?%?$/.test(text))) return hit('answer', 0.7);
  if (/\bowes? me\b|^system:|\bmark (every|all)\b/.test(text)) return hit('ignore', 0.6);
  // Confident only for first-person purchases; "remember when we paid…" or "log $300" just get a question.
  if (/^(i |just |i just )?(got|paid|bought|grabbed|covered|spent)\b.*\d|\bvenmo me for\b/.test(text)) return hit('expense');
  if (AMOUNT.test(text) && /\$|\bwas\b/.test(text)) return hit('expense', 0.6);
  // Only right after Tab asked for names; otherwise every "ok" or "lmao" would look like a name.
  // The backend says outright whether Tab is still waiting on this sender's name.
  const askedForName = sender
    ? sender.name_requested
    : context.some(m => m.sender_phone === 'tab' && /first name|your name/i.test(m.text ?? ''));
  if (askedForName && /^(it'?s |i'?m )?[a-z]+( here)?$/.test(text) && text.length <= 20) return hit('name_reply');
  return hit('ignore', 0.7);
};
