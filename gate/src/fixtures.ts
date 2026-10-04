import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChatExpense, ClassifyInput, ClassifyResult, ExpenseStatus, GateMessage, Intent, PhotoNote } from './types.js';

/** SPEC 11.3 ACT_THRESHOLD and APPROVAL_TEXT_THRESHOLD. */
export const ACT_THRESHOLD = 0.85;

type FixtureMessage = {
  from: string;
  text?: string;
  reply?: boolean;
  reply_to_tab?: string;
  dm?: boolean;
  unnamed?: boolean;
  /** A photo, as Grok vision described it; `text` is then its caption. */
  photo?: PhotoNote;
  /** What an inline reply answers: `from` is a member's name or "Tab". */
  reply_to?: { from: string; text?: string; photo?: PhotoNote; expense?: { description: string; status: ExpenseStatus } };
};

/** An open expense as a fixture writes it: names instead of phones, seconds instead of ms. */
type FixtureExpense = Omit<ChatExpense, 'expense_id' | 'payer_phone' | 'closes_in_ms'> & {
  expense_id?: string;
  payer?: string;
  closes_in_s?: number;
};

export interface Fixture {
  id: number;
  note?: string;
  context: FixtureMessage[];
  open_items: ClassifyInput['open_items'];
  /** Questions Tab is waiting on, newest first: `who` is "anyone" or a member's name. */
  open_questions?: { text: string; who: string }[];
  /** Open expenses anywhere in the chat, newest first. */
  chat_expenses?: FixtureExpense[];
  /** Defaults to: named unless `message.unnamed`; waiting for a name if unnamed and Tab asked for names. */
  sender?: ClassifyInput['sender'];
  tab_last?: ClassifyInput['tab_last'];
  settle?: ClassifyInput['settle'];
  /** The Jev-only raw transcript, oldest first. */
  transcript?: { from: string; text?: string; photo?: PhotoNote; seconds_ago: number }[];
  message: FixtureMessage;
  /**
   * The intent that must win, or any of `one_of` (either reaches the same
   * handler), or an intent that must never be acted on.
   */
  expect: { intent?: Intent; one_of?: Intent[]; min_confidence?: number; not_acted_as?: Intent };
}

type FixtureFile = { members: { name: string; phone: string }[]; fixtures: Fixture[] };

/** Loads `fixtures/<name>.json` from the repo root. */
export function loadFixtures(name = 'messages'): FixtureFile {
  const path = fileURLToPath(new URL(`../../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureFile;
}

const data = loadFixtures();
export const fixtures = data.fixtures;

/** Turns a fixture into the input the backend would pass to `classify` (SPEC 6.3). */
export function toInput(f: Fixture, members = data.members): ClassifyInput {
  const phone = (name: string) => members.find(m => m.name === name)?.phone ?? name;
  const msg = (m: FixtureMessage): GateMessage => ({
    sender_phone: phone(m.from),
    is_dm: !!m.dm,
    kind: m.photo ? 'image' : 'text',
    text: m.text,
    ...(m.photo ? { photo: m.photo } : {}),
    ...(m.reply || m.reply_to_tab || m.reply_to ? { reply_to_id: 'previous-message' } : {}),
    ...(m.reply_to_tab ? { reply_to_tab: m.reply_to_tab } : {}),
    ...(m.reply_to ? { reply_target: { ...m.reply_to, sender_phone: phone(m.reply_to.from) } } : {}),
  });
  const askedForName = f.context.some(c => c.from === 'Tab' && /first name|your name/i.test(c.text ?? ''));
  return {
    message: msg(f.message),
    context: f.context.map(msg),
    // A member who hasn't answered the name prompt has no name yet.
    members: members.map(m => (f.message.unnamed && m.name === f.message.from ? { phone: m.phone } : m)),
    open_items: f.open_items,
    ...(f.open_questions ? { open_questions: f.open_questions.map((q, i) => ({ id: `q${i + 1}`, text: q.text, who_may_answer: q.who })) } : {}),
    // The backend always sends the sender facts, so every fixture does too.
    sender: f.sender ?? { named: !f.message.unnamed, name_requested: !!f.message.unnamed && askedForName },
    ...(f.chat_expenses
      ? {
          chat_expenses: f.chat_expenses.map(({ payer, closes_in_s, ...e }, i) => ({
            ...e,
            expense_id: e.expense_id ?? `e${i + 1}`,
            ...(payer ? { payer_phone: phone(payer) } : {}),
            ...(closes_in_s === undefined ? {} : { closes_in_ms: closes_in_s * 1000 }),
          })),
        }
      : {}),
    ...(f.tab_last ? { tab_last: f.tab_last } : {}),
    ...(f.settle ? { settle: f.settle } : {}),
    ...(f.transcript ? { raw_transcript: f.transcript.map(({ from, ...t }) => ({ ...t, sender_phone: phone(from) })) } : {}),
  };
}

const wanted = (f: Fixture, intent: Intent) => (f.expect.one_of ? f.expect.one_of.includes(intent) : intent === f.expect.intent);

/**
 * The dangerous failure: a wrong intent confident enough that the backend would act
 * on it (SPEC 6.4), or an approval acted on below the 0.90 money bar.
 */
export function wronglyActs(f: Fixture, result: ClassifyResult): boolean {
  if (f.expect.not_acted_as) return result.intent === f.expect.not_acted_as && result.confidence >= ACT_THRESHOLD;
  const bar = result.intent === 'approval' ? 0.9 : ACT_THRESHOLD;
  return !wanted(f, result.intent) && result.confidence >= bar;
}

export function passes(f: Fixture, result: ClassifyResult): boolean {
  if (f.expect.not_acted_as) return result.intent !== f.expect.not_acted_as || result.confidence < ACT_THRESHOLD;
  return wanted(f, result.intent) && result.confidence >= (f.expect.min_confidence ?? 0);
}
