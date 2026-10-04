import { describe, expect, it, vi } from 'vitest';
import { loadFixtures, passes, toInput } from '../src/fixtures.js';
import { buildState, jevClassifier } from '../src/jev.js';
import { stubClassifier } from '../src/stub.js';
import type { ChatExpense, ClassifyInput, PhotoNote } from '../src/types.js';

const { members, fixtures } = loadFixtures('messages-context');
const input = (id: number) => toInput(fixtures.find(f => f.id === id)!, members);

const MEME: PhotoNote = { kind: 'meme', description: 'A dog in a burning room.', transcription: 'THIS IS FINE', money_related: false };

function jevReturning(choice: string, probability: number) {
  return vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify({ answers: { intent: { choice, probabilities: { [choice]: probability } } } })),
  );
}

describe('Jev state: the new sections', () => {
  it('shows open expenses with payer, split, time left, items, and the sender\'s part', () => {
    const state = buildState(input(301));
    expect(state).toContain('Open expenses in this chat, newest first:\n- THE BISTRO: Priya paid $47.07, split evenly 4 ways; split proposed, can still change (for 3h more).');
    expect(state).toContain('Items: 1. BURGER DELUXE $14.99; 2. CAESAR SALAD $9.99; 3. 2 x SOFT DRINK @ $2.99 $5.98; 4. CHEESECAKE $7.99.');
    expect(state).toContain('The sender is on it (share proposed).');
  });

  it('shows the sender facts, Tab\'s last message, and how the group settles', () => {
    const state = buildState(input(301));
    expect(state).toContain("Sender: Kian. Has a name: yes. Tab is waiting for the sender's name: no");
    expect(state).toContain("Tab's last message: a split proposal for THE BISTRO, 40s ago");
    expect(state).toContain('Settling: the group keeps a running tab and settles when someone says settle up; no settle request is open');
    expect(buildState(input(310))).toContain("a settle request is open; the sender owes on it and has not 👍'd it");
  });

  it('shows photos as kind, description, and the text in them, in context and as the new message', () => {
    expect(buildState(input(301))).toContain('Priya: [photo: receipt] A restaurant receipt from THE BISTRO totaling $47.07. text in photo: "THE BISTRO BURGER DELUXE');
    expect(buildState(input(308))).toContain('NEW MESSAGE:\nJoe: [photo: receipt] A restaurant receipt from Frita Batidos totaling $102.00. text in photo: "FRITA BATIDOS');
    expect(buildState(input(308))).toContain('caption: "dinner, i got it"');
  });

  it('shows who and what any reply answers, and the expense it is bound to', () => {
    expect(buildState(input(309))).toContain(
      'Kian (replying to Joe: "got the uber, $30"; that is about Uber, split proposed, can still change): i wasn\'t even in that one',
    );
  });

  it('labels the raw transcript as off-topic context', () => {
    const state = buildState(input(303));
    expect(state).toContain('Recent chat, including off-topic messages (last 15 minutes, oldest first; context only):');
    expect(state).toContain('Kian (30s ago): john only had one slice tho, like 5 bucks');
    // Kept context comes first, the new message last.
    expect(state.indexOf('Recent messages')).toBeLessThan(state.indexOf('Recent chat'));
    expect(state.trimEnd().endsWith('NEW MESSAGE:\nKian: update it')).toBe(true);
  });

  it('leaves the old state unchanged when the backend sends none of it', () => {
    const base: ClassifyInput = { message: { sender_phone: '+1', is_dm: false, kind: 'text', text: 'hi' }, context: [], members: [], open_items: [] };
    expect(buildState(base)).toBe(
      'Chat: the group chat\n\nMembers: unknown\n\nOpen items for the sender:\n- none\n\nSettle request open for the sender: no\n\nRecent messages, oldest first:\n(none)\n\nNEW MESSAGE:\nmember ending +1: hi',
    );
  });
});

describe('Jev state: caps', () => {
  const big = input(301);
  const expense = big.chat_expenses![0]!;

  it('shows at most 4 expenses and 15 items each', () => {
    const many: ChatExpense[] = Array.from({ length: 10 }, (_, i) => ({
      ...expense,
      expense_id: `e${i}`,
      description: `Dinner ${i}`,
      items: Array.from({ length: 30 }, (_, k) => ({ position: k + 1, description: `Item ${k + 1}`, quantity: 1, amount_cents: 100 })),
    }));
    const state = buildState({ ...big, chat_expenses: many });
    expect(state).toContain('Dinner 3');
    expect(state).not.toContain('Dinner 4');
    expect(state).toContain('- and 6 older');
    expect(state).toContain('15. Item 15 $1.00; and 15 more.');
    expect(state).not.toContain('16. Item 16');
  });

  it('cuts long photo text and keeps the last 12 transcript lines', () => {
    const long: PhotoNote = { ...MEME, description: 'd'.repeat(1000), transcription: 't'.repeat(5000) };
    const state = buildState({
      ...big,
      message: { ...big.message, kind: 'image', text: undefined, photo: long },
      raw_transcript: Array.from({ length: 20 }, (_, i) => ({ sender_phone: '+15555550104', text: `line ${i}`, seconds_ago: 100 - i })),
    });
    expect(state).not.toContain('line 7');
    expect(state).toContain('line 8');
    expect(state).toContain('line 19');
    const newMessage = state.slice(state.indexOf('NEW MESSAGE'));
    expect(newMessage.match(/t+/g)!.sort((a, b) => b.length - a.length)[0]!.length).toBeLessThanOrEqual(600);
    expect(newMessage.match(/d+/g)!.sort((a, b) => b.length - a.length)[0]!.length).toBeLessThanOrEqual(240);
    expect(state.length).toBeLessThan(6000);
  });
});

describe('photos at the gate', () => {
  it('asks Jev about a described non-receipt photo, and keeps the free receipt shortcut', async () => {
    const fetch = jevReturning('ignore', 0.95);
    const classify = jevClassifier({ apiKey: 'key', fetch: fetch as typeof globalThis.fetch });
    expect(await classify(input(304))).toEqual({ intent: 'ignore', confidence: 0.95 });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).state).toContain('[photo: meme]');
    expect((await classify(input(306))).intent).toBe('receipt');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lets the stub read photo kinds and sender facts', async () => {
    expect((await stubClassifier(input(304))).intent).toBe('ignore');
    expect((await stubClassifier(input(305))).intent).toBe('payment_reported');
    expect((await stubClassifier(input(306))).intent).toBe('receipt');
    expect((await stubClassifier(input(301))).intent).toBe('split_adjustment');
    expect((await stubClassifier(input(311))).intent).not.toBe('name_reply');
  });

  it('passes the context fixtures the stub is meant to cover', async () => {
    const covered = [301, 304, 305, 306, 311];
    for (const id of covered) expect(passes(fixtures.find(f => f.id === id)!, await stubClassifier(input(id)))).toBe(true);
  });
});
