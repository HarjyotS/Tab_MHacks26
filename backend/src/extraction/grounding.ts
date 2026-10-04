// SPEC §9.1 "ground every amount": an amount Grok extracts must be readable
// from the message itself. This returns every amount (in cents) a message can
// plausibly mean, so a hallucinated number never becomes a debt.

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };

const isNumberWord = (w: string) =>
  w in UNITS || w in TENS || w in SCALES || w === "a";

// Parses a well-formed run like "sixty three", "a hundred twenty", "two thousand
// four hundred". Returns null for runs that aren't one number ("two fifty").
function parseWords(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let last: "none" | "unit" | "teen" | "tens" | "scale" = "none";
  for (const [i, w] of words.entries()) {
    if (w === "a") {
      if (i !== 0 || !(words[1]! in SCALES)) return null;
      current = 1;
      last = "unit";
    } else if (w in TENS) {
      if (last === "unit" || last === "teen" || last === "tens") return null;
      current += TENS[w]!;
      last = "tens";
    } else if (w in UNITS) {
      const v = UNITS[w]!;
      if (last === "unit" || last === "teen") return null;
      if (last === "tens" && v >= 10) return null;
      current += v;
      last = v >= 10 ? "teen" : "unit";
    } else if (w === "hundred") {
      if (last === "none" || last === "scale") return null;
      current = (current || 1) * 100;
      last = "scale";
    } else if (w === "thousand") {
      if (last === "none") return null;
      total += (current || 1) * 1000;
      current = 0;
      last = "scale";
    } else return null;
  }
  return last === "none" ? null : total + current;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

function wordAmounts(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/[^a-z]+/)
    .filter((t) => t && t !== "and");
  const out: number[] = [];
  let run: string[] = [];
  const flush = () => {
    // Every contiguous sub-run, so "like forty" or "it was sixty three" both work.
    for (let i = 0; i < run.length; i++) {
      for (let j = i + 1; j <= run.length; j++) {
        const whole = parseWords(run.slice(i, j));
        if (whole !== null) out.push(toCents(whole));
        // Spoken dollars and cents: "thirty two fifty" is $32.50.
        for (let k = i + 1; k < j; k++) {
          const dollars = parseWords(run.slice(i, k));
          const cents = parseWords(run.slice(k, j));
          if (dollars !== null && cents !== null && cents > 0 && cents < 100) {
            out.push(toCents(dollars) + cents);
          }
        }
      }
    }
    run = [];
  };
  for (const t of tokens) {
    if (isNumberWord(t)) run.push(t);
    else flush();
  }
  flush();
  return out;
}

function digitAmounts(text: string): { values: number[]; products: number[] } {
  const values: number[] = [];
  for (const m of text.matchAll(
    /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g,
  )) {
    values.push(toCents(Number(m[0].replace(/,/g, ""))));
  }
  // "4 x 25", "2 × $14", "3*12.50"
  const products: number[] = [];
  for (const m of text.matchAll(
    /(\d+)\s*(?:x|×|\*)\s*\$?(\d+(?:\.\d{1,2})?)/gi,
  )) {
    products.push(toCents(Number(m[1]) * Number(m[2])));
  }
  return { values, products };
}

export function amountCandidates(text: string): Set<number> {
  const { values, products } = digitAmounts(text);
  return new Set<number>([...values, ...wordAmounts(text), ...products]);
}

export function isGrounded(cents: number, text: string): boolean {
  return amountCandidates(text).has(cents);
}
