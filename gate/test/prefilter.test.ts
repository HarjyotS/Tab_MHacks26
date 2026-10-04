import { describe, expect, it, vi } from 'vitest';
import { loadFixtures, toInput } from '../src/fixtures.js';
import { mightBeMoney, prefilterEnabled, withPrefilter } from '../src/prefilter.js';
import type { ClassifyInput } from '../src/types.js';

const members = [
  { phone: 'tab', name: 'Tab' },
  { phone: '+15555550101', name: 'Joe' },
  { phone: '+15555550102', name: 'Kian' },
];
const say = (text: string, extra: Partial<ClassifyInput> = {}, message: Partial<ClassifyInput['message']> = {}): ClassifyInput => ({
  members,
  context: [],
  open_items: [],
  message: { sender_phone: '+15555550102', is_dm: false, kind: 'text', text, ...message },
  ...extra,
});
const item = (expense_status: ClassifyInput['open_items'][number]['expense_status'], my_share_status?: ClassifyInput['open_items'][number]['my_share_status']) =>
  [{ expense_id: 'e1', description: 'Frita Batidos', expense_status, my_share_status }];

// Everyday group chat with nothing to do with money.
const CHATTER = [
  'lol', 'lmao', 'omw', 'who\'s driving', 'who\'s home tonight', 'that movie was so good', 'anyone up',
  'ok', 'sounds good', 'yes', 'nah', 'haha true', 'wait what', 'can\'t wait for this weekend', 'where are you guys',
  'just landed', 'running late sorry', 'did anyone see the game', 'I\'m so tired', 'what time works for everyone',
  'happy birthday!!', 'miss you guys', 'send pics', 'that\'s hilarious', 'who has my charger', 'brb',
  'love that for you', 'same', 'no way', 'what are we doing tonight', 'anyone want to get boba', 'good morning',
  'I\'m outside', 'let me know when you\'re here', 'the wifi password is on the fridge', 'who left the door open',
  'can someone feed the cat', 'goodnight', 'congrats!!', 'ugh mondays', 'we should hike sometime', 'thoughts?',
  'ok I\'m down', 'agreed', 'it\'s raining again', 'is the gym open', 'text me when you leave', 'see you there',
];

describe('pre-filter', () => {
  it('never turns away a fixture whose message is about money, in either fixture file', () => {
    const misses: string[] = [];
    for (const file of ['messages', 'messages-extended']) {
      const data = loadFixtures(file);
      for (const f of data.fixtures) {
        if (!f.expect.intent || f.expect.intent === 'ignore') continue;
        if (!mightBeMoney(toInput(f, data.members))) misses.push(`${file} #${f.id} ${f.message.text}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('skips most everyday chatter', () => {
    const skipped = CHATTER.filter(text => !mightBeMoney(say(text)));
    expect(skipped.length / CHATTER.length).toBeGreaterThanOrEqual(0.9);
  });

  it('passes amounts, money words, purchases, and questions for Tab with no state at all', () => {
    for (const text of [
      'got groceries, $63', 'uber was twenty', 'dinner\'s on me', 'grabbed tacos for everyone', 'I picked up the pizza',
      'can you venmo me', 'I\'ll cover it', 'who owes what', 'what\'s the damage', 'breakdown pls', 'let\'s settle up',
      'square us up', 'paid priya back on cashapp', 'zelled you for the uber', 'Tab help', 'how does this bot work',
      'where do I see the ledger?', 'where\'d that come from', 'are we even?', 'booked the airbnb', 'ordered food',
      'how much was it', 'I spotted you at lunch', 'meet at 7',
    ]) expect(mightBeMoney(say(text)), text).toBe(true);
  });

  it('passes anything while the sender has a list, a proposed split, or a settle request open', () => {
    expect(mightBeMoney(say('just the fries', { open_items: item('itemizing', 'awaiting_claim') }))).toBe(true);
    expect(mightBeMoney(say('I wasn\'t there', { open_items: item('proposed', 'proposed') }))).toBe(true);
    expect(mightBeMoney(say('nope', { open_items: item('finalized', 'locked') }))).toBe(true);
    // An approved share has nothing left to answer, so chatter is still skipped.
    expect(mightBeMoney(say('lol', { open_items: item('finalized', 'approved') }))).toBe(false);
  });

  it('passes anything while Tab is waiting on an answer in the chat', () => {
    expect(mightBeMoney(say('the second one', { tab_question_open: true }))).toBe(true);
    expect(mightBeMoney(say('the second one', { tab_question_open: false }))).toBe(false);
  });

  it('passes replies to Tab, DMs, photos, and unnamed senders, but not a reply between people', () => {
    expect(mightBeMoney(say('lol ok thanks', {}, { reply_to_id: 'p1', reply_to_tab: 'Logged pizza' }))).toBe(true);
    expect(mightBeMoney(say('lol', {}, { reply_to_id: 'p1' }))).toBe(false);
    expect(mightBeMoney(say('hey', {}, { is_dm: true }))).toBe(true);
    expect(mightBeMoney(say('', {}, { kind: 'image', image_url: 'https://x/receipt.jpg' }))).toBe(true);
    expect(mightBeMoney(say('Kian', { members: [{ phone: '+15555550102' }] }))).toBe(true);
  });

  it('leaves reactions and system events to the classifier, which routes them without a model', () => {
    expect(mightBeMoney(say('', {}, { kind: 'reaction' }))).toBe(true);
    expect(mightBeMoney(say('', {}, { kind: 'system' }))).toBe(true);
  });
});

describe('withPrefilter', () => {
  it('answers chatter as ignore without calling the classifier, and marks it', async () => {
    const inner = vi.fn(async () => ({ intent: 'expense' as const, confidence: 0.97 }));
    const classify = withPrefilter(inner);
    expect(await classify(say('who\'s driving'))).toEqual({ intent: 'ignore', confidence: 1, prefiltered: true });
    expect(inner).not.toHaveBeenCalled();
    expect(await classify(say('got groceries, $63'))).toEqual({ intent: 'expense', confidence: 0.97 });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('prefilterEnabled', () => {
  it('is on unless GATE_PREFILTER says off', () => {
    for (const value of [undefined, '', 'on', 'true', '1', 'yes']) expect(prefilterEnabled(value)).toBe(true);
    for (const value of ['off', 'false', '0', 'no', ' OFF ']) expect(prefilterEnabled(value)).toBe(false);
  });
});
