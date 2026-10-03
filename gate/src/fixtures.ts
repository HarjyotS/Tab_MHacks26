import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClassifyInput, ClassifyResult, GateMessage, Intent } from './types.js';

/** SPEC 11.3 ACT_THRESHOLD and APPROVAL_TEXT_THRESHOLD. */
export const ACT_THRESHOLD = 0.85;

type FixtureMessage = { from: string; text?: string; reply?: boolean; dm?: boolean; unnamed?: boolean };
export interface Fixture {
  id: number;
  note?: string;
  context: FixtureMessage[];
  open_items: ClassifyInput['open_items'];
  message: FixtureMessage;
  /** Either the intent that must win, or an intent that must never be acted on. */
  expect: { intent?: Intent; min_confidence?: number; not_acted_as?: Intent };
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
    kind: 'text',
    text: m.text,
    ...(m.reply ? { reply_to_id: 'previous-message' } : {}),
  });
  return {
    message: msg(f.message),
    context: f.context.map(msg),
    // A member who hasn't answered the name prompt has no name yet.
    members: members.map(m => (f.message.unnamed && m.name === f.message.from ? { phone: m.phone } : m)),
    open_items: f.open_items,
  };
}

/**
 * The dangerous failure: a wrong intent confident enough that the backend would act
 * on it (SPEC 6.4), or an approval acted on below the 0.90 money bar.
 */
export function wronglyActs(f: Fixture, result: ClassifyResult): boolean {
  if (f.expect.not_acted_as) return result.intent === f.expect.not_acted_as && result.confidence >= ACT_THRESHOLD;
  const bar = result.intent === 'approval' ? 0.9 : ACT_THRESHOLD;
  return result.intent !== f.expect.intent && result.confidence >= bar;
}

export function passes(f: Fixture, result: ClassifyResult): boolean {
  if (f.expect.not_acted_as) return result.intent !== f.expect.not_acted_as || result.confidence < ACT_THRESHOLD;
  return result.intent === f.expect.intent && result.confidence >= (f.expect.min_confidence ?? 0);
}
