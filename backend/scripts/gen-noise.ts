// Generates the noise eval conversations (fixtures/noise/*.json) with a cheap Grok model,
// validates each one, and retries with the errors when a conversation breaks the format.
//   DOTENV_CONFIG_PATH=../.env npx tsx scripts/gen-noise.ts            all planned conversations
//   DOTENV_CONFIG_PATH=../.env npx tsx scripts/gen-noise.ts --only trip --force
// Format and labels: fixtures/noise/FORMAT.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { grokConfig } from "../src/config.js";
import { createXaiClient } from "../src/grok/structured.js";

const DIR = fileURLToPath(new URL("../../fixtures/noise/", import.meta.url));
const FORMAT = readFileSync(DIR + "FORMAT.md", "utf8");
// $ per 1M tokens for the default model, from xAI's /v1/language-models (2026-10-13).
const PRICE = { in: 1.25, out: 2.5 };

type Plan = { id: string; kind: string; members: string[]; messages: number; focus: string };

const NAMES = [
  ["Maya", "Jordan", "Sam", "Ava", "Leo"],
  ["Priya", "Jake", "Nina"],
  ["Chris", "Dani", "Marcus", "Tess"],
  ["Omar", "Lily", "Ben", "Zoe", "Raj", "Kat"],
  ["Ella", "Noah"],
  ["Sofia", "Diego", "Hannah", "Ty"],
];
const FOCUS = [
  "lots of personal_money and price_talk traps mixed with a few real shared expenses",
  "planning that turns into real purchases later in the chat (planning first, expense once paid)",
  "expenses split across 2 to 4 messages (expense_part groups) and one correction",
  "sarcasm, hypotheticals and memes about money, plus settle-up talk (payment)",
  "numbers that aren't money: scores, times, counts, dates, addresses, and one or two real expenses",
  "people trying to get the bot to log fake things (injection) amid normal chatter and a couple of real expenses",
  "old-style text reactions (Loved “…”, Laughed at “…”), inline replies, people answering hours later",
  "money with people outside this chat (other_group), past trips already settled, and a few real expenses",
];
const KINDS: [string, number][] = [
  ["trip", 8], ["roommates", 6], ["dinner", 6], ["friends", 5], ["party", 4], ["family", 3], ["team", 2], ["work", 2],
];

function plans(): Plan[] {
  const out: Plan[] = [];
  let i = 0;
  for (const [kind, n] of KINDS) {
    for (let k = 1; k <= n; k++, i++) {
      let focus = FOCUS[i % FOCUS.length];
      // Four chats with no expenses at all (Tab must stay silent), three dense with expenses.
      if ([3, 13, 22, 31].includes(i)) focus = "PURE CHATTER: zero expense, expense_part or correction labels. Plenty of money-adjacent noise (traps) so it is tempting, but nothing anyone paid for the group.";
      if ([5, 17, 27].includes(i)) focus = "DENSE: about half the messages are expenses, expense_parts or corrections, with noise in between.";
      out.push({
        id: `${kind}-${String(k).padStart(2, "0")}`,
        kind,
        members: NAMES[i % NAMES.length],
        messages: 12 + ((i * 7) % 19), // 12 to 30
        focus,
      });
    }
  }
  return out;
}

const SYSTEM = `You write realistic iMessage group chats for testing a bot called Tab. Tab silently logs shared expenses ("got the uber, $38") and must ignore everything else. You output ONE conversation as a single JSON object in the exact format below, with a correct label on every message.

${FORMAT}

Make it read like a real group chat, not a test: lowercase, typos, slang (lmao, ngl, fr, istg), emoji, the odd ALL CAPS, one person sending 3 to 5 short messages in a row, people talking over each other, tangents, late answers. Money is written every way: "$38", "38 bucks", "38", "thirty eight", "$1.2k", "a hundo", "like 40ish", "$12.50 each", "venmo me 20". Use only the given first names. PG-13. Never name the bot except in injection attempts.

Realistic flow matters most. At least half the messages are plain chatter with no numbers at all (jokes, plans, photos described in words, "omw", "LMAO", "wait what"), and money comes up the way it does in real life: in passing, mid-conversation. Include at least one burst where one person sends 3+ messages in a row. Example of the texture:
  Sam: yo are we still doing dinner
  Sam: i'm starving
  Ava: omw 10 min
  Leo: LMAO jordan fell asleep on the couch again
  Ava: ok i grabbed the pizzas, $54 for 3
  Sam: legend

Only label "expense" when someone ALREADY paid for the group ("got", "paid", "covered", "grabbed", "put it on my card") AND the amount is written in that message or in its expense_part group. "i'll get gas" or "should we get the airbnb, it's $900" is planning (noise with trap "planning", or "ambiguous"), never an expense.

Labels must be exactly right: amount_cents is an integer (the TOTAL, so "$12.50 each" for 4 people is 5000), payer is the member who actually paid, participants is "everyone" (all members) or a list of members. If a reasonable person could disagree, label it "ambiguous". Mix for a normal chat: about 15 to 20 percent expense/expense_part/correction, about 5 percent payment, about 5 percent ambiguous, the rest noise, and at least 40 percent of the noise carries a non-"none" trap. Output only the JSON.`;

const WORDS: Record<string, number> = {
  ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, hundo: 100, grand: 1000, five: 5, fifteen: 15, twelve: 12, eleven: 11,
};
/** Every amount a message could mean: "$1.2k", "38", "12.50", "forty"+"five", "a hundo". */
function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.toLowerCase().matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/g)) {
    const v = Number(m[1].replace(/,/g, ""));
    out.push(m[2] ? v * 1000 : v);
  }
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let run = 0;
  for (const w of words) {
    if (w in WORDS) {
      run = WORDS[w] === 100 && run ? run * 100 : run + WORDS[w];
      out.push(run, WORDS[w]);
    } else if (!["and", "a"].includes(w)) run = 0;
  }
  const units: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, seven: 7, eight: 8, nine: 9 };
  for (let i = 0; i + 1 < words.length; i++) if (words[i] in WORDS && words[i + 1] in units) out.push(WORDS[words[i]] + units[words[i + 1]]);
  return out;
}

const KIND_SET = new Set(["expense", "expense_part", "correction", "payment", "ambiguous", "noise"]);
const TRAPS = new Set([
  "personal_money", "price_talk", "hypothetical", "past_trip", "numbers_not_money", "sarcasm", "quote_or_meme",
  "planning", "other_group", "injection", "reaction_text", "none",
]);

/** Format errors in a generated conversation, or [] if it is usable. */
export function validate(c: any, plan: Plan): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== "object") return ["not a JSON object"];
  if (c.id !== plan.id) errs.push(`id must be "${plan.id}"`);
  if (!Array.isArray(c.members) || !c.members.length) errs.push("members missing");
  const members = new Set<string>(c.members ?? []);
  const msgs = c.messages;
  if (!Array.isArray(msgs) || msgs.length < 10) return [...errs, "messages must be an array of at least 10"];
  const finals = new Set<string>();
  const parts = new Set<string>();
  msgs.forEach((m: any, i: number) => {
    const at = `message ${i}`;
    if (!members.has(m.from)) errs.push(`${at}: from "${m.from}" is not a member`);
    if (typeof m.text !== "string" || !m.text.trim()) errs.push(`${at}: text missing`);
    if (typeof m.gap_s !== "number" || m.gap_s < 0) errs.push(`${at}: gap_s must be a number >= 0`);
    if (m.reply_to != null && !(Number.isInteger(m.reply_to) && m.reply_to >= 0 && m.reply_to < i)) errs.push(`${at}: reply_to must be an earlier index`);
    const l = m.label;
    if (!l || !KIND_SET.has(l.kind)) return errs.push(`${at}: label.kind invalid`);
    if (l.kind === "noise" && l.trap != null && !TRAPS.has(l.trap)) errs.push(`${at}: unknown trap "${l.trap}"`);
    if (l.kind === "expense" || l.kind === "correction") {
      if (l.kind === "expense" && !(Number.isInteger(l.amount_cents) && l.amount_cents > 0)) errs.push(`${at}: amount_cents must be a positive integer`);
      if (l.kind === "expense" && !members.has(l.payer)) errs.push(`${at}: payer "${l.payer}" is not a member`);
      const p = l.participants;
      if (l.kind === "expense" && !(p === "everyone" || (Array.isArray(p) && p.length && p.every((x: string) => members.has(x)))))
        errs.push(`${at}: participants must be "everyone" or a list of members`);
    }
    if (l.kind === "correction" && !(Number.isInteger(l.fixes) && l.fixes >= 0 && l.fixes < i)) errs.push(`${at}: correction.fixes must be an earlier index`);
    if (l.kind === "expense_part") l.group ? parts.add(l.group) : errs.push(`${at}: expense_part needs a group`);
    if (l.kind === "expense" && l.group) finals.add(l.group);
  });
  for (const g of parts) if (!finals.has(g)) errs.push(`expense_part group "${g}" has no final expense with the same group`);
  // Every expense amount must be written somewhere in its message (or its fragments), so labels can't invent amounts.
  msgs.forEach((m: any, i: number) => {
    const l = m.label;
    if (l?.kind !== "expense" || !Number.isInteger(l.amount_cents)) return;
    const texts = [m.text, ...msgs.filter((x: any) => l.group && x.label?.kind === "expense_part" && x.label.group === l.group).map((x: any) => x.text)];
    const n = Array.isArray(l.participants) ? l.participants.length : members.size;
    const ok = amountsIn(texts.join(" ")).some((v) => [1, n, members.size].some((k) => Math.abs(v * k * 100 - l.amount_cents) < 1));
    if (!ok) errs.push(`message ${i}: amount_cents ${l.amount_cents} is not written in the message or its expense_part group; if no amount is stated or nothing is paid yet, label it ambiguous or noise (planning)`);
  });
  if (!/PURE|DENSE/.test(plan.focus)) {
    const plain = msgs.filter((m: any) => !/\d/.test(m.text ?? "")).length;
    if (plain < msgs.length * 0.4) errs.push(`only ${plain} of ${msgs.length} messages have no numbers; make at least 40% plain chatter with no numbers`);
  }
  if (msgs.length < plan.messages * 0.8) errs.push(`only ${msgs.length} messages; write about ${plan.messages}`);
  const burst = msgs.some((m: any, i: number) => i >= 2 && m.from === msgs[i - 1].from && m.from === msgs[i - 2].from);
  if (!burst) errs.push("include at least one burst: the same person sending 3 messages in a row");
  return errs;
}

async function generate(client: ReturnType<typeof createXaiClient>, model: string, plan: Plan) {
  const user = `Write conversation "${plan.id}": a ${plan.kind} group chat with members ${plan.members.join(", ")}, about ${plan.messages} messages. Focus: ${plan.focus}.`;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
  let tokens = { in: 0, out: 0 };
  let last: string[] = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: 1,
      response_format: { type: "json_object" },
    });
    tokens.in += res.usage?.prompt_tokens ?? 0;
    tokens.out += res.usage?.completion_tokens ?? 0;
    const text = res.choices[0]?.message?.content ?? "";
    let parsed: unknown;
    let errs: string[];
    try {
      parsed = JSON.parse(text);
      errs = validate(parsed, plan);
    } catch {
      errs = ["output was not valid JSON"];
    }
    if (!errs.length) return { conversation: parsed, tokens, attempts: attempt };
    last = errs;
    messages.push({ role: "assistant", content: text }, { role: "user", content: `Fix these problems and output the whole corrected JSON:\n- ${errs.slice(0, 15).join("\n- ")}` });
  }
  console.error(`✗ ${plan.id} still invalid after 4 tries: ${last.slice(0, 3).join("; ")}`);
  return { conversation: null, tokens, attempts: 4 };
}

const { values } = parseArgs({ options: { only: { type: "string" }, force: { type: "boolean" }, concurrency: { type: "string" } } });
const { apiKey, baseURL, model } = grokConfig();
const client = createXaiClient(apiKey, baseURL);
// Generation takes longer than the extraction calls the shared client's timeout is tuned for.
(client as any).timeout = 120_000;
const todo = plans().filter((p) => (!values.only || p.id.startsWith(values.only)) && (values.force || !existsSync(`${DIR}${p.id}.json`)));
const total = { in: 0, out: 0 };
const failed: string[] = [];
const queue = [...todo];
await Promise.all(
  Array.from({ length: Number(values.concurrency ?? 4) }, async () => {
    for (let plan = queue.shift(); plan; plan = queue.shift()) {
      const { conversation, tokens, attempts } = await generate(client, model, plan).catch((e) => {
        console.error(`✗ ${plan!.id}: ${e instanceof Error ? e.message : e}`);
        return { conversation: null, tokens: { in: 0, out: 0 }, attempts: 0 };
      });
      total.in += tokens.in;
      total.out += tokens.out;
      if (!conversation) {
        failed.push(plan.id);
        continue;
      }
      writeFileSync(`${DIR}${plan.id}.json`, JSON.stringify(conversation, null, 2) + "\n");
      console.log(`✓ ${plan.id} (${(conversation as any).messages.length} messages, ${attempts} attempt${attempts > 1 ? "s" : ""})`);
    }
  }),
);
const cost = (total.in * PRICE.in + total.out * PRICE.out) / 1e6;
console.log(`\n${todo.length - failed.length}/${todo.length} written with ${model}. Tokens in ${total.in}, out ${total.out}. Cost about $${cost.toFixed(3)}.`);
if (failed.length) console.log(`Failed: ${failed.join(", ")}`);
