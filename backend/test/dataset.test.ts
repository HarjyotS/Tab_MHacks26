import { describe, expect, it } from "vitest";
import { INTENT_RULES, TEXT_INTENTS } from "../src/classifier/intents.js";
import { loadSplit, type Split } from "../src/classifier/dataset.js";

const SPLITS: Split[] = ["fewshot", "eval", "test"];
const all = SPLITS.flatMap((s) =>
  loadSplit(s).map((ex) => ({ ...ex, split: s })),
);

describe("classifier dataset", () => {
  it("parses every split against the schema", () => {
    for (const s of SPLITS) expect(loadSplit(s).length).toBeGreaterThan(0);
  });

  it("has unique ids across all splits", () => {
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every text intent in eval and test", () => {
    for (const s of ["eval", "test"] as const) {
      const seen = new Set(loadSplit(s).map((e) => e.expected));
      expect([...TEXT_INTENTS].filter((i) => !seen.has(i))).toEqual([]);
    }
  });

  it("includes the expected label in each example's acceptable list", () => {
    for (const e of all) expect(e.acceptable).toContain(e.expected);
  });

  it("uses only 555 fixture phone numbers", () => {
    const phones = all.flatMap((e) => [
      e.input.message.sender,
      ...e.input.members.map((m) => m.phone),
      ...e.input.context.map((c) => c.from).filter((f) => f !== "tab"),
    ]);
    for (const p of phones) expect(p).toMatch(/^\+1555555\d{4}$/);
  });

  it("never repeats an eval or test message in the few-shot prompt", () => {
    const key = (e: (typeof all)[number]) => JSON.stringify(e.input);
    const fewshot = new Set(all.filter((e) => e.split === "fewshot").map(key));
    const leaked = all.filter(
      (e) => e.split !== "fewshot" && fewshot.has(key(e)),
    );
    expect(leaked.map((e) => e.id)).toEqual([]);
  });

  it("never quotes an eval or test message verbatim in the intent rules", () => {
    // "yes", "no", and "even" are keywords SPEC defines, not leaked examples.
    const allowed = new Set(["yes", "no", "even"]);
    const quoted = Object.values(INTENT_RULES)
      .flatMap((rule) =>
        [...rule.matchAll(/'([^']+)'/g)].map((m) => m[1]!.toLowerCase()),
      )
      .filter((q) => !allowed.has(q));
    const texts = new Set(
      all
        .filter((e) => e.split !== "fewshot")
        .map((e) => e.input.message.text.toLowerCase()),
    );
    expect(quoted.filter((q) => texts.has(q))).toEqual([]);
  });

  it("puts every SPEC §6.6 fixture in the frozen test split", () => {
    const spec = all.filter((e) => e.tags.includes("spec"));
    expect(spec).toHaveLength(18);
    expect(spec.every((e) => e.split === "test")).toBe(true);
  });
});
