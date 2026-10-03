// Runs Grok extraction from the command line, with no database.
//   npx tsx scripts/extract.ts                        run every fixture
//   npx tsx scripts/extract.ts --only spec            run fixtures whose id starts with "spec"
//   npx tsx scripts/extract.ts expense "got groceries, $63" --sender Joe
import { parseArgs } from "node:util";
import { grokConfig } from "../src/config.js";
import { createXaiClient, type ChatClient } from "../src/grok/structured.js";
import { extractExpense } from "../src/extraction/expense.js";
import { resolveClaim } from "../src/extraction/claim.js";
import { extractCorrection } from "../src/extraction/correction.js";
import { CASES, FRITA_ITEMS, fresh, PHONES, type Case } from "./extraction-cases.js";

function matches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "string") {
    return (
      typeof actual === "string" &&
      actual.toLowerCase().includes(expected.toLowerCase())
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      return false;
    if (expected.every((e) => typeof e === "string")) {
      return (
        [...expected].sort().join() === [...actual].map(String).sort().join()
      );
    }
    return expected.every((e, i) => matches(e, actual[i]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([k, v]) =>
      matches(v, (actual as Record<string, unknown>)[k]),
    );
  }
  return expected === actual;
}

async function run(client: ChatClient, model: string, c: Case) {
  if (c.kind === "expense")
    return extractExpense(client, model, c.input, c.mode);
  if (c.kind === "claim") return resolveClaim(client, model, c.input, c.items);
  return extractCorrection(client, model, c.input);
}

async function runFixtures(client: ChatClient, model: string, only?: string) {
  const cases = CASES.filter((c) => !only || c.id.startsWith(only));
  const results = await Promise.all(
    cases.map(async (c) => {
      const start = Date.now();
      try {
        const out = await run(client, model, c);
        const problemKinds = out.problems.map((p) => p.kind);
        const ok =
          matches(c.expect, out.result) &&
          [...new Set(problemKinds)].sort().join() ===
            [...new Set(c.problems)].sort().join();
        return { c, out, ok, ms: Date.now() - start };
      } catch (err) {
        return { c, ok: false, ms: Date.now() - start, error: String(err) };
      }
    }),
  );
  for (const r of results) {
    console.log(
      `${r.ok ? "✓" : "✗"} ${r.c.id.padEnd(28)} ${String(r.ms).padStart(5)}ms  "${r.c.input.message.text}"`,
    );
    if (!r.ok) {
      console.log(
        `    want ${JSON.stringify(r.c.expect)} problems=${JSON.stringify(r.c.problems)}`,
      );
      console.log(
        `    got  ${"error" in r ? r.error : `${JSON.stringify(r.out!.result)} problems=${JSON.stringify(r.out!.problems)}`}`,
      );
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const spec = results.filter((r) => r.c.id.startsWith("spec"));
  console.log(
    `\n${passed}/${results.length} passed (SPEC §6.6: ${spec.filter((r) => r.ok).length}/${spec.length})`,
  );
  if (passed !== results.length) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string" },
      sender: { type: "string", default: "Joe" },
    },
  });
  const cfg = grokConfig();
  const client = createXaiClient(cfg.apiKey, cfg.baseURL);
  const [kind, text] = positionals;
  if (!kind) return runFixtures(client, cfg.model, values.only);
  if (!text)
    throw new Error(
      'usage: extract.ts <expense|adjustment|claim|correction> "message" [--sender Name]',
    );

  const sender = PHONES[values.sender as keyof typeof PHONES];
  if (!sender)
    throw new Error(
      `--sender must be one of ${Object.keys(PHONES).join(", ")}`,
    );
  const input = fresh(text, sender);
  const out =
    kind === "expense" || kind === "adjustment"
      ? await extractExpense(
          client,
          cfg.model,
          input,
          kind === "expense" ? "new" : "adjustment",
        )
      : kind === "claim"
        ? await resolveClaim(client, cfg.model, input, FRITA_ITEMS)
        : kind === "correction"
          ? await extractCorrection(client, cfg.model, input)
          : null;
  if (!out) throw new Error(`unknown kind ${kind}`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
