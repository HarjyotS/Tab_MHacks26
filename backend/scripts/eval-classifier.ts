// Runs the Grok classifier over a labeled split and prints a report.
//   npx tsx scripts/eval-classifier.ts --split eval --model grok-4.3 --concurrency 8
//   npx tsx scripts/eval-classifier.ts --model grok-4.3,grok-4.20-0309-non-reasoning
// Writes every prediction to backend/eval-runs/ so runs can be diffed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { grokConfig } from "../src/config.js";
import {
  loadSplit,
  type Example,
  type Split,
} from "../src/classifier/dataset.js";
import {
  createGrokClassifier,
  createXaiClient,
} from "../src/classifier/grok.js";
import { decide, type Decision } from "../src/classifier/decide.js";
import { TEXT_INTENTS, type TextIntent } from "../src/classifier/intents.js";
import type { ClassifyResult } from "../src/classifier/types.js";

// Intents whose handlers write money-related state.
const MONEY_WRITES = new Set<TextIntent>([
  "expense",
  "correction",
  "claim",
  "split_adjustment",
  "approval",
  "dispute",
]);

type Outcome = {
  example: Example;
  result?: ClassifyResult;
  decision?: Decision;
  correct: boolean;
  dangerous: boolean;
  ms: number;
  error?: string;
};

const { values } = parseArgs({
  options: {
    split: { type: "string", default: "eval" },
    model: { type: "string" },
    concurrency: { type: "string", default: "8" },
    limit: { type: "string" },
    tag: { type: "string" },
  },
});

async function pool<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const pct = (a: number, b: number) =>
  b === 0 ? "  n/a" : `${((100 * a) / b).toFixed(1).padStart(5)}%`;
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

function isDangerous(ex: Example, r: ClassifyResult, d: Decision): boolean {
  if (d !== "act" || ex.acceptable.includes(r.intent)) return false;
  if (r.intent === "approval") return true;
  return ex.expected === "ignore" && MONEY_WRITES.has(r.intent);
}

function report(model: string, split: Split, outcomes: Outcome[]) {
  const ok = outcomes.filter((o) => o.result);
  const errors = outcomes.filter((o) => o.error);
  const correct = ok.filter((o) => o.correct).length;
  console.log(`\n══ ${model} on ${split} (${outcomes.length} examples) ══`);
  console.log(
    `accuracy           ${pct(correct, ok.length)}  (${correct}/${ok.length})`,
  );

  const acted = ok.filter((o) => o.decision === "act");
  const actedCorrect = acted.filter((o) => o.correct).length;
  console.log(
    `acted-on accuracy  ${pct(actedCorrect, acted.length)}  (${actedCorrect}/${acted.length}; coverage ${pct(acted.length, ok.length)})`,
  );

  const danger = ok.filter((o) => o.dangerous);
  console.log(`DANGEROUS errors   ${danger.length}`);
  for (const o of danger) {
    console.log(
      `  ✗ ${o.example.id}: expected ${o.example.expected}, got ${o.result!.intent} @${o.result!.confidence} — "${o.example.input.message.text}"`,
    );
  }
  if (errors.length) {
    console.log(`call errors        ${errors.length}`);
    for (const o of errors.slice(0, 5))
      console.log(`  ! ${o.example.id}: ${o.error}`);
  }

  console.log(`\nper intent          prec   recall   n`);
  for (const intent of TEXT_INTENTS) {
    const predicted = ok.filter((o) => o.result!.intent === intent);
    const actual = ok.filter((o) => o.example.expected === intent);
    if (!predicted.length && !actual.length) continue;
    const tpPred = predicted.filter((o) =>
      o.example.acceptable.includes(intent),
    ).length;
    const tpAct = actual.filter((o) => o.correct).length;
    console.log(
      `  ${intent.padEnd(18)} ${pct(tpPred, predicted.length)} ${pct(tpAct, actual.length)}  ${actual.length}`,
    );
  }

  console.log(`\ncalibration (stated confidence → actual accuracy)`);
  for (const [lo, hi] of [
    [0, 0.5],
    [0.5, 0.7],
    [0.7, 0.85],
    [0.85, 0.9],
    [0.9, 0.95],
    [0.95, 1.01],
  ] as const) {
    const b = ok.filter(
      (o) => o.result!.confidence >= lo && o.result!.confidence < hi,
    );
    if (b.length)
      console.log(
        `  ${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}  ${pct(b.filter((o) => o.correct).length, b.length)}  n=${b.length}`,
      );
  }

  const ms = ok.map((o) => o.ms);
  console.log(
    `\nlatency            p50 ${quantile(ms, 0.5)}ms  p95 ${quantile(ms, 0.95)}ms`,
  );

  const wrong = ok.filter((o) => !o.correct);
  if (wrong.length) {
    console.log(`\nmisses (${wrong.length})`);
    for (const o of wrong) {
      console.log(
        `  ${o.example.id}\n    "${o.example.input.message.text}" → ${o.result!.intent} @${o.result!.confidence} (want ${o.example.acceptable.join("|")})\n    ${o.result!.reason}`,
      );
    }
  }
}

async function main() {
  const split = values.split as Split;
  const cfg = grokConfig();
  const models = (values.model ?? cfg.model).split(",");
  const fewshots = loadSplit("fewshot");
  let examples = loadSplit(split);
  if (values.tag)
    examples = examples.filter((e) =>
      e.tags.some((t) => t.startsWith(values.tag!)),
    );
  if (values.limit) examples = examples.slice(0, Number(values.limit));

  const client = createXaiClient(cfg.apiKey, cfg.baseURL);
  const runsDir = join(dirname(fileURLToPath(import.meta.url)), "../eval-runs");
  mkdirSync(runsDir, { recursive: true });

  for (const model of models) {
    const classify = createGrokClassifier({ client, model, fewshots });
    const outcomes = await pool(
      examples,
      Number(values.concurrency),
      async (example): Promise<Outcome> => {
        const start = Date.now();
        try {
          const result = await classify(example.input);
          const decision = decide(result, example.input);
          return {
            example,
            result,
            decision,
            correct: example.acceptable.includes(result.intent),
            dangerous: isDangerous(example, result, decision),
            ms: Date.now() - start,
          };
        } catch (err) {
          return {
            example,
            correct: false,
            dangerous: false,
            ms: Date.now() - start,
            error: String(err),
          };
        }
      },
    );
    report(model, split, outcomes);
    const file = join(
      runsDir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${split}-${model}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify(
        outcomes.map((o) => ({ id: o.example.id, ...o, example: undefined })),
        null,
        2,
      ),
    );
    console.log(`\nsaved ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
