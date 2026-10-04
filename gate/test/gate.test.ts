import { describe, expect, it, vi } from 'vitest';
import { fixtures, passes, toInput } from '../src/fixtures.js';
import { buildState, INTENT_CRITERIA, jevClassifier } from '../src/jev.js';
import { stubClassifier } from '../src/stub.js';
import { INTENTS } from '../src/types.js';

const byId = (id: number) => fixtures.find(f => f.id === id)!;

function jevReturning(choice: string, probability: number) {
  return vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { intent: { type: 'choice', choice, confidence: 0.5, probabilities: { [choice]: probability } } },
    })),
  );
}

describe('Jev gate', () => {
  it('asks one choice question over every intent and returns the chosen probability as confidence', async () => {
    const fetch = jevReturning('claim', 0.97);
    const result = await jevClassifier({ apiKey: 'key', fetch: fetch as typeof globalThis.fetch })(toInput(byId(5)));
    expect(result).toEqual({ intent: 'claim', confidence: 0.97 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer key');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.questions.intent.type).toBe('choice');
    expect(Object.keys(body.questions.intent.criteria).sort()).toEqual([...INTENTS].sort());
  });

  it('adds up the question intents\' probabilities, since the backend answers them all the same way', async () => {
    const probabilities = { balance_query: 0.5, money_question: 0.38, breakdown_request: 0.05, help: 0.07 };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ answers: { intent: { choice: 'balance_query', probabilities } } })));
    const result = await jevClassifier({ apiKey: 'key', fetch: fetch as unknown as typeof globalThis.fetch })(toInput(byId(5)));
    expect(result.intent).toBe('balance_query');
    expect(result.confidence).toBeCloseTo(0.93);
  });

  it('labels message text as data and includes context, members, and open items', () => {
    const state = buildState(toInput(byId(6)));
    expect(state).toContain('NEW MESSAGE:\nPriya: same as Jake');
    expect(state).toContain('Jake: 2 and 3');
    expect(state).toContain('Frita Batidos: an item list is open; Tab is waiting for the sender to say which items they had');
    expect(state).toContain('Settle request open for the sender: no');
    expect(state).toContain('Members: Tab, Joe, Kian, Priya, Jake, John');
  });

  it('never calls Jev for reactions, system events, or bare photos', async () => {
    const fetch = jevReturning('expense', 1);
    const classify = jevClassifier({ apiKey: 'key', fetch: fetch as typeof globalThis.fetch });
    const base = toInput(byId(3));
    expect(await classify({ ...base, message: { ...base.message, kind: 'reaction' } })).toEqual({ intent: 'ignore', confidence: 1 });
    expect((await classify({ ...base, message: { ...base.message, kind: 'image', text: undefined } })).intent).toBe('receipt');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tells Jev plainly when a settle request is open, so agreement words only count then', () => {
    expect(buildState(toInput(byId(10)))).toContain('Settle request open for the sender: yes');
  });

  it("lists Tab's open questions only when it is waiting on one", () => {
    const plain = toInput(byId(3));
    expect(buildState(plain)).not.toContain('Tab is waiting on');
    const state = buildState({
      ...plain,
      open_questions: [
        { id: 'q1', text: 'How much was\nthe Uber?', who_may_answer: 'Kian' },
        { id: 'q2', text: 'Got a trip coming up?', who_may_answer: 'anyone' },
      ],
    });
    expect(state).toContain('Tab is waiting on, newest first:\n- "How much was the Uber?" (only Kian may answer)\n- "Got a trip coming up?" (anyone may answer)');
  });

  it('gives up on a hung Jev request instead of stalling the backend', async () => {
    const hang = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(jevClassifier({ apiKey: 'key', timeoutMs: 20, fetch: hang as typeof globalThis.fetch })(toInput(byId(3))))
      .rejects.toThrow('aborted');
  });

  it('rejects an answer outside the intent list instead of guessing', async () => {
    const fetch = jevReturning('refund', 0.9);
    await expect(jevClassifier({ apiKey: 'key', fetch: fetch as typeof globalThis.fetch })(toInput(byId(3)))).rejects.toThrow();
  });

  it('writes every criterion as a rule, not a one-word synonym', () => {
    for (const rule of Object.values(INTENT_CRITERIA)) expect(rule.split(' ').length).toBeGreaterThan(6);
  });
});

describe('fixture scoring', () => {
  it('never lets the prompt-injection fixture through as an actionable expense', () => {
    const f = byId(13);
    expect(passes(f, { intent: 'expense', confidence: 0.9 })).toBe(false);
    expect(passes(f, { intent: 'expense', confidence: 0.6 })).toBe(true);
    expect(passes(f, { intent: 'ignore', confidence: 0.99 })).toBe(true);
  });

  it('never counts a typed approval as acting on money, whatever the confidence', () => {
    // Approvals are tap-only (SPEC P7); a typed one is classified but never moves money.
    expect(passes(byId(10), { intent: 'approval', confidence: 0.6 })).toBe(true);
  });
});

describe('stub classifier', () => {
  it('treats a one-word message as a name only right after the name prompt', async () => {
    const plain = toInput(byId(3));
    expect((await stubClassifier({ ...plain, message: { ...plain.message, text: 'ok' } })).intent).toBe('ignore');
    expect((await stubClassifier(toInput(byId(14)))).intent).toBe('name_reply');
  });

  it('reads a bare yes or an amount as an answer only while Tab is waiting on a question', async () => {
    const plain = toInput(byId(3));
    const say = (text: string, waiting: boolean) =>
      stubClassifier({
        ...plain,
        message: { ...plain.message, text },
        ...(waiting ? { open_questions: [{ id: 'q1', text: 'Want me to split that?', who_may_answer: 'Joe' }] } : {}),
      });
    expect((await say('yeah lock it in', true)).intent).toBe('answer');
    expect((await say('22', true)).intent).toBe('answer');
    expect((await say('yeah lock it in', false)).intent).toBe('ignore');
    expect((await say('who is driving tonight', true)).intent).toBe('ignore');
  });

  it('reads questions about the group\'s money as money_question, but not purchases or balances', async () => {
    const plain = toInput(byId(3));
    const intent = async (text: string) => (await stubClassifier({ ...plain, message: { ...plain.message, text } })).intent;
    for (const text of ['what was on the bistro receipt?', 'how much did we spend on food?', 'who paid for the uber?', 'how was the pizza split', 'what\'s left to settle', 'what have i paid this week', 'when did alex pay me back', 'show my history'])
      expect(await intent(text), text).toBe('money_question');
    expect(await intent('why do i owe jake 12')).toBe('breakdown_request');
    expect(await intent('what do i owe')).toBe('balance_query');
    expect(await intent('paid 48 for pizza for everyone')).toBe('expense');
  });

  it('passes the spec fixtures it is meant to cover', async () => {
    const results = await Promise.all(fixtures.map(async f => passes(f, await stubClassifier(toInput(f)))));
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(15);
  });
});
