import type { Classify, Intent } from './types.js';

const AMOUNT = /\$?\d+(?:\.\d{2})?/;

/**
 * Keyword rules for building and testing before Jev is wired in, or when it's
 * down. Deliberately conservative: anything unclear comes back with low
 * confidence, so the backend asks instead of guessing (P3).
 */
export const stubClassifier: Classify = async ({ message, open_items }) => {
  if (message.kind === 'reaction' || message.kind === 'system') return { intent: 'ignore', confidence: 1 };
  if (message.kind === 'image' && !message.text) return { intent: 'receipt', confidence: 0.9 };
  const text = (message.text ?? '').trim().toLowerCase();
  const has = (status: string) => open_items.some(i => i.expense_status === status);
  const hit = (intent: Intent, confidence = 0.9) => ({ intent, confidence });

  if (/^@?tab\b.*\b(help|what can you do)\b|^what can you do/.test(text)) return hit('help');
  if (/\bwho owes|what do i owe|how much do i owe\b/.test(text)) return hit('balance_query');
  if (/\bbreakdown\b|what'?s the \$?\d+ from/.test(text)) return hit('breakdown_request');
  if (/\b(sent|paid) you\b.*\b(venmo|cash ?app|zelle)\b/.test(text)) return hit('payment_reported');
  if (has('finalized') && /^(yes|yep|yeah|we'?re chill|pay it|ok|okay)\b/.test(text)) return hit('approval', 0.92);
  if (has('finalized') && /^(no|nope)\b|didn'?t (get|have)/.test(text)) return hit('dispute');
  if (has('itemizing') && (/^[\d\s,and&]+$/.test(text) || /^even$|same as|we all split/.test(text))) return hit('claim');
  if (message.reply_to_id && /\bactually\b/.test(text) && AMOUNT.test(text)) return hit('correction');
  if (/\bnot even\b|\bonly had\b|\bwasn'?t (at|there)\b/.test(text)) return hit('split_adjustment');
  if (/\bowes? me\b/.test(text)) return hit('ignore', 0.6);
  if (/\b(got|paid|bought|grabbed)\b.*\d|\bvenmo me for\b/.test(text)) return hit('expense');
  if (AMOUNT.test(text) && /\$|\bwas\b/.test(text)) return hit('expense', 0.6);
  if (/^[a-z]+$/.test(text) && text.length <= 12) return hit('name_reply', 0.6);
  return hit('ignore', 0.7);
};
