import type { Classify, ClassifyInput } from './types.js';

// A free local check in front of the classifier. Every Jev call costs money,
// and most group chat ("lol", "who's driving") has nothing to do with it. The
// pre-filter never picks an intent; it only answers "could this be money?".
// When unsure the answer is yes: a skipped money message is a missed expense,
// while a passed "lol" costs one call.

// Amounts and the words people use for money, paying, and Tab's own commands
// (balances, breakdowns, settling up, help).
const MONEY =
  /[$€£¥₹]|\d|💸|💰|💵|🧾|\b(pay|pays|paid|paying|payment|payback|owe|owes|owed|owing|iou|ious|venmo\w*|zelle\w*|zelled|cash ?app|paypal|apple ?pay|split\w*|cover|covers|covered|covering|bill|bills|tab|settle\w*|square|squared|tip|tips|tipped|refund\w*|cost|costs|price\w*|pricey|expensive|cheap|buck|bucks|dollar|dollars|cents?|usd|receipt\w*|charge|charged|charges|reimburs\w*|spot|spotted|front|fronted|expenses?|money|cash|card|debt|debts|balances?|breakdown|damage|total|deposit|fees?|rent|tax|loan|lend|lent|borrow\w*|chip in|pitch in|on me|my treat|bot|help)\b/i;

// Purchases often come without an amount ("grabbed dinner for everyone",
// "dinner was on jake", "I handled the airbnb").
const PURCHASE =
  /\b(got|bought|buy|buying|grabbed|picked up|ordered|treated|booked|rented|reserved|purchased|spent|spend|took care of|handled|sorted|dealt with|was on|it'?s on)\b/i;

// Things groups split. Most expenses posted in the chat are there to be split
// (Joe's review on #28), so naming one is enough to ask Jev.
const SHARED_COSTS =
  /\b(dinner|lunch|breakfast|brunch|drinks|groceries|grocery|uber|lyft|cab|taxi|gas|parking|airbnb|hotel|flight|flights|tickets|rent|utilities|wifi|internet|electric|electricity|takeout|delivery|doordash|ubereats|uber eats|instacart|coffee|pizza|bar)\b/i;

// Amounts spelled out ("uber was twenty"). "one" and "two" are left out:
// they're everywhere in chatter and rarely an amount on their own.
const NUMBER_WORDS =
  /\b(three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|half)\b/i;

// Questions about where a number came from, "are we even?", and how to use
// Tab ("how do we see the ledger?"), which is help.
const QUESTIONS =
  /\b(how much|where('?s| is| did| does)?\b.*\bfrom|are we (even|good|square)|we'?re even|close out|ledger|log|logged|how (do|does|can|should) (i|we|you|this|it))\b/i;

/** Values of GATE_PREFILTER that turn the pre-filter off; anything else (or unset) leaves it on. */
const OFF = new Set(['off', 'false', '0', 'no']);

export function prefilterEnabled(value: string | undefined): boolean {
  return !OFF.has((value ?? '').trim().toLowerCase());
}

/** Whether a message is waiting on something only the classifier can judge. */
function awaitingSender(item: ClassifyInput['open_items'][number]): boolean {
  // An item list (claims), a split that can still change (adjustments), or a
  // settle request (approval or dispute): replies like "even", "I wasn't
  // there", or "no" carry no money words.
  return (
    item.expense_status === 'itemizing' ||
    item.expense_status === 'proposed' ||
    (item.expense_status === 'finalized' && item.my_share_status === 'locked')
  );
}

/**
 * True when the message should go to the classifier. Only plain text with no
 * sign of money, outside any open question, item list, or settle request, is
 * turned away.
 */
export function mightBeMoney(input: ClassifyInput): boolean {
  const { message } = input;
  // Photos may be receipts; reactions and system events are routed by the
  // classifier itself without a model.
  if (message.kind !== 'text' || message.image_url) return true;
  // DMs are always to Tab, and so is an inline reply to one of Tab's
  // messages. Replies between people go through the rules below like any
  // other message (a reply about an open split or settle request still passes).
  if (message.is_dm || message.reply_to_tab) return true;
  // Tab is waiting on an answer in this chat; bystanders' inline answers
  // only count if the gate passes them.
  if (input.tab_question_open) return true;
  // Onboarding: an unnamed sender may be answering the name prompt.
  if (!input.members.find(m => m.phone === message.sender_phone)?.name) return true;
  if (input.open_items.some(awaitingSender)) return true;
  const text = message.text ?? '';
  return [MONEY, PURCHASE, SHARED_COSTS, NUMBER_WORDS, QUESTIONS].some(rule => rule.test(text));
}

/**
 * Wraps a classifier so messages that can't be about money come back as
 * `ignore` without calling it. `prefiltered` marks those results for logging.
 */
export function withPrefilter(classify: Classify): Classify {
  return async input => (mightBeMoney(input) ? classify(input) : { intent: 'ignore', confidence: 1, prefiltered: true });
}
