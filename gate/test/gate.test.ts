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

  it('labels message text as data and includes context, members, and open items', () => {
    const state = buildState(toInput(byId(6)));
    expect(state).toContain('NEW MESSAGE:\nPriya: same as Jake');
    expect(state).toContain('Jake: 2 and 3');
    expect(state).toContain("Frita Batidos: expense itemizing, sender's share awaiting_claim");
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

  it('requires 0.90 for a text approval', () => {
    expect(passes(byId(10), { intent: 'approval', confidence: 0.89 })).toBe(false);
  });
});

describe('stub classifier', () => {
  it('passes the spec fixtures it is meant to cover', async () => {
    const results = await Promise.all(fixtures.map(async f => passes(f, await stubClassifier(toInput(f)))));
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(15);
  });
});
