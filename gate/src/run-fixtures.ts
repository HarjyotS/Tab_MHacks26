import 'dotenv/config';
import { loadFixtures, passes, toInput, wronglyActs } from './fixtures.js';
import { jevClassifier } from './jev.js';
import { stubClassifier } from './stub.js';
import type { ClassifyResult } from './types.js';

// npm run fixtures -- [jev|stub] [fixture file name] [runs]
//   e.g. npm run fixtures -- jev messages-extended 3   (jev needs TYPESAFE_API_KEY)
const [which = 'jev', file = 'messages', runsArg = '1'] = process.argv.slice(2);
const runs = Math.max(1, Number(runsArg));
const apiKey = process.env.TYPESAFE_API_KEY;
if (which === 'jev' && !apiKey) throw new Error('TYPESAFE_API_KEY is required for the jev classifier');
const classify = which === 'jev' ? jevClassifier({ apiKey: apiKey! }) : stubClassifier;
const { members, fixtures } = loadFixtures(file);

type Run = { result: ClassifyResult; ms: number };
const results = new Map<number, Run[]>();
for (let run = 0; run < runs; run++) {
  // Five at a time keeps us well under the API's rate limit.
  for (let i = 0; i < fixtures.length; i += 5) {
    await Promise.all(fixtures.slice(i, i + 5).map(async f => {
      const started = performance.now();
      const result = await classify(toInput(f, members));
      results.set(f.id, [...(results.get(f.id) ?? []), { result, ms: performance.now() - started }]);
    }));
  }
}

let passed = 0, total = 0, dangerous = 0;
const latencies: number[] = [];
for (const f of fixtures) {
  const rs = results.get(f.id)!;
  const ok = rs.map(r => passes(f, r.result));
  const bad = rs.filter(r => wronglyActs(f, r.result)).length;
  passed += ok.filter(Boolean).length;
  total += rs.length;
  dangerous += bad;
  latencies.push(...rs.map(r => r.ms));
  const flaky = new Set(rs.map(r => r.result.intent)).size > 1;
  const mark = bad ? '🚨' : ok.every(Boolean) ? '✅' : '❌';
  const want = f.expect.not_acted_as ? `not ${f.expect.not_acted_as}` : f.expect.one_of?.join(' or ') ?? f.expect.intent;
  const got = rs.map(r => `${r.result.intent} ${r.result.confidence.toFixed(2)}`).join(', ');
  if (mark !== '✅' || flaky || runs === 1) {
    console.log(`${mark} #${f.id} ${JSON.stringify(f.message.text)} want ${want}: ${got}${flaky ? '  (flip-flops)' : ''}`);
  }
}
latencies.sort((a, b) => a - b);
const pct = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]!);
console.log(`\n${which} on ${file}: ${passed}/${total} pass over ${runs} run(s) of ${fixtures.length} cases`);
console.log(`wrong and confident enough to act: ${dangerous}`);
console.log(`latency: median ${pct(0.5)} ms, p95 ${pct(0.95)} ms`);
process.exitCode = passed === total ? 0 : 1;
