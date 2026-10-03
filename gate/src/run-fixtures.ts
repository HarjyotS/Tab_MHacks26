import 'dotenv/config';
import { fixtures, passes, toInput } from './fixtures.js';
import { jevClassifier } from './jev.js';
import { stubClassifier } from './stub.js';

// npm run fixtures -w gate -- [jev|stub]   (jev needs TYPESAFE_API_KEY)
const which = process.argv[2] ?? 'jev';
const apiKey = process.env.TYPESAFE_API_KEY;
if (which === 'jev' && !apiKey) throw new Error('TYPESAFE_API_KEY is required for the jev classifier');
const classify = which === 'jev' ? jevClassifier({ apiKey: apiKey! }) : stubClassifier;

const results = await Promise.all(fixtures.map(async f => ({ f, r: await classify(toInput(f)) })));
let passed = 0;
for (const { f, r } of results) {
  const ok = passes(f, r);
  if (ok) passed++;
  const want = f.expect.not_acted_as ? `not ${f.expect.not_acted_as} ≥0.85` : `${f.expect.intent}${f.expect.min_confidence ? ` ≥${f.expect.min_confidence}` : ''}`;
  console.log(`${ok ? '✅' : '❌'} #${String(f.id).padEnd(2)} ${JSON.stringify(f.message.text).padEnd(56)} ${r.intent.padEnd(18)} ${r.confidence.toFixed(2)}  (want ${want})`);
}
console.log(`\n${which}: ${passed}/${fixtures.length} fixtures pass`);
process.exitCode = passed === fixtures.length ? 0 : 1;
