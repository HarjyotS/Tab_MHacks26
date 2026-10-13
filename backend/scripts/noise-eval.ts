// End-to-end noise eval: replays labeled group chats (fixtures/noise/*.json,
// see fixtures/noise/FORMAT.md) through the real brain, wired like main.ts
// (pre-filter + Jev gate, Grok extraction, ask agent, wit, production
// thresholds and timing) over the in-memory module, on a simulated clock.
// Nothing connects to SpacetimeDB and nothing is sent: Tab's outbox is read
// back and scored against the labels.
//
//   npm run noise-eval -w backend                        every fixtures/noise/*.json (skips _*.json)
//   npm run noise-eval -w backend -- ../fixtures/noise/_smoke.json --stub
//   npm run noise-eval -w backend -- --only roommates --concurrency 3 --limit 5
//
// Flags: --only <id prefix>, --concurrency N (conversations in parallel,
// default 3), --limit N (conversations), --stub (stub classifier and canned
// Grok: free), --tail-s S (simulated time after the last message so timers
// fire; default the objection window + one extension + 1 minute), --out <file>.
// Results: backend/results/noise-eval-<timestamp>.json (gitignored).
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { prefilterEnabled, stubClassifier, withPrefilter, type Classify } from "@tab/gate";
import { grokConfig, ledgerConfig, timing, type Timing } from "../src/config.js";
import { createClassify } from "../src/gate/index.js";
import { createXaiClient, type ChatClient } from "../src/grok/structured.js";
import { extractExpense } from "../src/extraction/expense.js";
import { extractReceipt } from "../src/extraction/receipt.js";
import { resolveClaim } from "../src/extraction/claim.js";
import { extractCorrection } from "../src/extraction/correction.js";
import { resolveAnswer } from "../src/extraction/answer.js";
import { ImageCache } from "../src/extraction/image.js";
import { describeImage } from "../src/extraction/describe.js";
import { witLine } from "../src/copy/wit.js";
import { summarizeBreakdown } from "../src/copy/summary.js";
import { Memory, type BrainCtx, type Extractors } from "../src/brain/context.js";
import { processMessage, tick } from "../src/brain/process.js";
import { MemoryDb } from "../test/support/memory-db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, "..");
const ROOT = resolve(BACKEND, "..");
// The repo-root .env holds TYPESAFE_API_KEY and XAI_API_KEY. Values already
// in the environment win, so `DEMO_MODE=true npm run noise-eval` works.
loadEnv({ path: join(ROOT, ".env"), quiet: true });

// Saturday 4pm in Detroit: awake hours, so quiet hours rarely shift replies.
const START = new Date("2026-10-10T20:00:00Z");

// ── Fixtures ─────────────────────────────────────────────────────────────

type Who = "everyone" | string[];
type Label =
  | { kind: "expense"; amount_cents: number; payer: string; participants: Who; description?: string; group?: string }
  | { kind: "expense_part"; group: string }
  | { kind: "correction"; fixes: number; amount_cents?: number; payer?: string; participants?: Who; description?: string }
  | { kind: "payment" }
  | { kind: "ambiguous" }
  | { kind: "noise"; trap?: string };
type FixtureMessage = { from: string; text: string; gap_s: number; reply_to?: number; label: Label };
type Conversation = { id: string; title?: string; kind?: string; members: string[]; messages: FixtureMessage[]; file: string };

const KINDS = new Set(["expense", "expense_part", "correction", "payment", "ambiguous", "noise"]);

function problemsIn(c: Conversation): string[] {
  const out: string[] = [];
  if (!c.id) out.push("missing id");
  if (!Array.isArray(c.members) || c.members.length === 0) out.push("no members");
  if (!Array.isArray(c.messages) || c.messages.length === 0) return [...out, "no messages"];
  const members = new Set(c.members);
  const who = (w: Who | undefined, at: string) => {
    if (w === undefined || w === "everyone") return;
    if (!Array.isArray(w)) out.push(`${at}: participants must be "everyone" or a list`);
    else for (const n of w) if (!members.has(n)) out.push(`${at}: participant ${n} is not a member`);
  };
  c.messages.forEach((m, i) => {
    const at = `message ${i}`;
    if (!members.has(m.from)) out.push(`${at}: sender ${m.from} is not a member`);
    if (typeof m.text !== "string") out.push(`${at}: no text`);
    if (typeof m.gap_s !== "number" || m.gap_s < 0) out.push(`${at}: gap_s must be a number >= 0`);
    if (m.reply_to !== undefined && !(m.reply_to >= 0 && m.reply_to < i)) out.push(`${at}: reply_to must point to an earlier message`);
    const l = m.label;
    if (!l || !KINDS.has(l.kind)) return out.push(`${at}: unknown label kind ${JSON.stringify(l?.kind)}`);
    if (l.kind === "expense") {
      if (!Number.isInteger(l.amount_cents) || l.amount_cents <= 0) out.push(`${at}: expense needs amount_cents`);
      if (!members.has(l.payer)) out.push(`${at}: payer ${l.payer} is not a member`);
      who(l.participants, at);
    }
    if (l.kind === "expense_part" && !c.messages.some((x, j) => j > i && x.label?.kind === "expense" && x.label.group === l.group))
      out.push(`${at}: expense_part group ${l.group} has no later expense`);
    if (l.kind === "correction") {
      if (!(l.fixes >= 0 && l.fixes < i)) out.push(`${at}: fixes must point to an earlier message`);
      if (l.payer && !members.has(l.payer)) out.push(`${at}: payer ${l.payer} is not a member`);
      who(l.participants, at);
    }
  });
  return out;
}

function loadConversations(paths: string[]): Conversation[] {
  const files = paths.flatMap((p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) throw new Error(`no such file or directory: ${p}`);
    if (!statSync(abs).isDirectory()) return [abs];
    return readdirSync(abs)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .sort()
      .map((f) => join(abs, f));
  });
  return files.flatMap((file) => {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    // One conversation per file (FORMAT.md); a list is allowed for small sets like _smoke.json.
    const list = Array.isArray(raw) ? raw : (raw as { conversations?: unknown[] }).conversations ?? [raw];
    return (list as Omit<Conversation, "file">[]).map((c) => ({ ...c, file: relative(ROOT, file) }));
  });
}

// ── Recording ────────────────────────────────────────────────────────────

type GrokCall = {
  name: string;
  ms: number;
  prompt_tokens?: number;
  cached_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cost_in_usd_ticks?: number; // when xAI reports it
  error?: string;
};
type JevCall = { ms: number; status?: number; model?: string; input_tokens?: number; output_tokens?: number; retries: number; error?: string };
type GateCall = { intent?: string; confidence?: number; prefiltered: boolean; ms: number; error?: string };
type LogEvent = { event: string } & Record<string, unknown>;
type Bucket = { grok: GrokCall[]; jev: JevCall[]; gate: GateCall[]; log: LogEvent[] };
const bucket = (): Bucket => ({ grok: [], jev: [], gate: [], log: [] });

type ExpState = {
  status: string;
  total_cents: number;
  payer?: string;
  description: string;
  split_mode: string;
  participants: string[]; // names on the split (not opted out), sorted
  shares: Record<string, number>;
};
type ExpChange = { expense_id: string; source_index: number | null; before?: ExpState; after: ExpState; fields: string[] };
type TabOut = {
  action_id: string;
  kind: string; // group_message | dm | reaction | contact_card
  purpose: string;
  text?: string;
  reaction?: string;
  to?: string;
  target_index?: number;
  expense_id?: string;
  send_after_s: number; // simulated seconds after it was queued
  final_status?: string; // sent | queued (still due) | cancelled
};
type Effects = { created: ExpChange[]; changed: ExpChange[]; tab: TabOut[]; cancelled: string[] };

type MessageRecord = {
  index: number;
  from: string;
  text: string;
  label: Label;
  t_s: number; // simulated seconds since the chat started
  message_id: string;
  prefiltered: boolean;
  gate?: GateCall;
  decision?: string;
  final_intent?: string;
  status?: string;
  error?: string;
  latency_ms: number;
  grok: GrokCall[];
  jev: JevCall[];
  log: LogEvent[];
  effects: Effects;
  // What happened as time passed before the next message (ticks).
  after?: { effects: Effects; grok: GrokCall[]; log: LogEvent[]; ticks: number; ms: number };
};

type ExpenseInfo = {
  expense_id: string;
  source_index: number | null;
  created_index: number; // message during or after which it appeared (messages.length = tail)
  created_phase: "message" | "after" | "tail";
  totals: number[]; // every total it has had, in order
  final: ExpState;
};

const material = (s: ExpState) => JSON.stringify([s.status, s.total_cents, s.payer, s.description, s.split_mode, s.participants, s.shares]);

function changedFields(a: ExpState, b: ExpState): string[] {
  return (["status", "total_cents", "payer", "description", "split_mode", "participants", "shares"] as const).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

// ── Grok: the production client, metered ─────────────────────────────────

type Create = ChatClient["chat"]["completions"]["create"];

function metered(real: ChatClient, sink: () => GrokCall[]): ChatClient {
  const create = (async (params: Parameters<Create>[0], options?: Parameters<Create>[1]) => {
    const p = params as { response_format?: { json_schema?: { name?: string } }; tools?: unknown[] };
    const name = p.response_format?.json_schema?.name ?? (p.tools ? "ask_agent" : "chat");
    const t0 = performance.now();
    try {
      const res = (await real.chat.completions.create(params, options)) as {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
          cost_in_usd_ticks?: number;
        };
      };
      const u = res.usage;
      sink().push({
        name,
        ms: Math.round(performance.now() - t0),
        prompt_tokens: u?.prompt_tokens,
        cached_tokens: u?.prompt_tokens_details?.cached_tokens,
        completion_tokens: u?.completion_tokens,
        reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens,
        cost_in_usd_ticks: u?.cost_in_usd_ticks,
      });
      return res;
    } catch (err) {
      sink().push({ name, ms: Math.round(performance.now() - t0), error: String(err).slice(0, 300) });
      throw err;
    }
  }) as unknown as Create;
  return { chat: { completions: { create } } };
}

// ── --stub: canned Grok, free ────────────────────────────────────────────

// A client that always returns `out`, like the test harness's grok().
const fixed = (out: object): ChatClient =>
  ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) } },
  }) as unknown as ChatClient;

const firstAmount = (text: string): number | null => {
  const m = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/) ?? text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:bucks|dollars)\b/i);
  return m ? Math.round(parseFloat(m[1]!) * 100) : null;
};

function stubExtractors(sink: () => GrokCall[]): { extract: Extractors; ask: ChatClient } {
  const note = (name: string) => sink().push({ name: `stub:${name}`, ms: 0, prompt_tokens: 0, completion_tokens: 0 });
  const unavailable = (name: string) => {
    note(name);
    return Promise.reject(new Error(`stub: no ${name} in --stub mode`));
  };
  return {
    extract: {
      expense: (input, mode) => {
        note("expense_extraction");
        const text = input.message.text ?? "";
        const amount = firstAmount(text);
        return extractExpense(fixed({
          is_expense: amount !== null, amount_cents: amount, amount_is_per_person: /\beach\b/i.test(text),
          description: "Expense", payer: "sender", payer_name: null, participants: "everyone",
          participant_names: [], exclusion_names: [], fixed: [],
        }), "stub", input, mode);
      },
      correction: (input) => {
        note("correction_extraction");
        const amount = firstAmount(input.message.text ?? "");
        return extractCorrection(fixed({ target_expense_id: null, new_amount_cents: amount, new_description: null, unclear: amount === null }), "stub", input);
      },
      answer: (input, threads) => {
        note("answer_resolution");
        return resolveAnswer(fixed({
          thread_id: null, relevance: 0, yes_no: null, amount_cents: null, percent: null, choice: null,
          settle_mode: null, restated: null, also_new: false, also_intent: null,
        }), "stub", input, threads);
      },
      claim: () => unavailable("claim_resolution"),
      receipt: () => unavailable("receipt_extraction"),
      describe: () => unavailable("image_description"),
    },
    ask: {
      chat: {
        completions: {
          create: (async () => {
            note("ask_agent");
            return { choices: [{ message: { role: "assistant", content: "(stub answer)" } }] };
          }) as unknown as Create,
        },
      },
    },
  };
}

// ── Jev: counted at the HTTP layer, so the gate is production's own ──────

// Which conversation's bucket a Jev request belongs to (calls run in parallel).
const jevScope = new AsyncLocalStorage<Bucket>();
const realFetch = globalThis.fetch;
const JEV_HOST = "https://api.typesafe.ai/";

// Production has no retry; a 429 here is the eval's own load, so it is
// retried (and counted) rather than scored as Tab failing.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(JEV_HOST)) return realFetch(input, init);
  const sink = jevScope.getStore();
  const t0 = performance.now();
  let retries = 0;
  for (;;) {
    try {
      const res = await realFetch(input, init);
      if ((res.status === 429 || res.status >= 500) && retries < 3) {
        retries++;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** retries));
        continue;
      }
      const body = (await res.clone().json().catch(() => undefined)) as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
      sink?.jev.push({
        ms: Math.round(performance.now() - t0), status: res.status, model: body?.model,
        input_tokens: body?.usage?.input_tokens, output_tokens: body?.usage?.output_tokens, retries,
      });
      return res;
    } catch (err) {
      sink?.jev.push({ ms: Math.round(performance.now() - t0), retries, error: String(err).slice(0, 300) });
      throw err;
    }
  }
}) as typeof fetch;

// ── One conversation ─────────────────────────────────────────────────────

type Setup = {
  stub: boolean;
  t: Timing;
  tailMs: number;
  classify: Classify;
  xai?: ChatClient;
  model: string;
};

type ConversationResult = {
  id: string;
  title?: string;
  kind?: string;
  file: string;
  members: Record<string, string>; // name → fake phone
  wall_ms: number;
  records: MessageRecord[];
  tail: { effects: Effects; grok: GrokCall[]; log: LogEvent[]; ticks: number; ms: number };
  expenses: ExpenseInfo[];
  outbox: TabOut[];
  score: ConversationScore;
};

async function runConversation(conv: Conversation, s: Setup): Promise<ConversationResult> {
  const wall0 = performance.now();
  const clock = { now: START };
  const db = new MemoryDb(() => clock.now);
  const phones = new Map(conv.members.map((name, i) => [name, `+1555555${String(i + 1).padStart(4, "0")}`]));
  const nameOf = (phone?: string) => (phone ? ([...phones].find(([, p]) => p === phone)?.[0] ?? phone) : undefined);
  db.addGroup(conv.id, [...phones].map(([name, phone]) => ({ phone, name })));

  let current = bucket();
  const sink = () => current.grok;
  const log = (event: string, fields: Record<string, unknown> = {}) => current.log.push({ event, ...fields });

  // The gate as production builds it, with each result recorded.
  const classify: Classify = async (input) => {
    const b = current;
    const t0 = performance.now();
    try {
      const r = await jevScope.run(b, () => s.classify(input));
      b.gate.push({ intent: r.intent, confidence: r.confidence, prefiltered: r.prefiltered === true, ms: Math.round(performance.now() - t0) });
      return r;
    } catch (err) {
      b.gate.push({ prefiltered: false, ms: Math.round(performance.now() - t0), error: String(err).slice(0, 300) });
      throw err;
    }
  };

  // Mirrors the ctx in src/main.ts field for field; only the store, the
  // reducers, the clock and the metering differ.
  let ctx: BrainCtx;
  if (s.stub) {
    const stub = stubExtractors(sink);
    ctx = {
      store: db, db: db.reducers(), now: () => clock.now, classify,
      extract: stub.extract,
      wit: async () => null,
      eyes: process.env.TAB_EYES !== "off",
      ask: { client: stub.ask, model: "stub" },
      summarize: async () => null,
      timing: s.t, ledger: ledgerConfig(), memory: new Memory(), log,
    };
  } else {
    const xai = metered(s.xai!, sink);
    const model = s.model;
    const images = new ImageCache();
    ctx = {
      store: db,
      db: db.reducers(),
      now: () => clock.now,
      classify,
      extract: {
        expense: (input, mode) => extractExpense(xai, model, input, mode),
        receipt: async (url, caption) => extractReceipt(xai, model, await images.get(url), caption),
        claim: (input, items) => resolveClaim(xai, model, input, items),
        correction: (input) => extractCorrection(xai, model, input),
        answer: (input, threads) => resolveAnswer(xai, model, input, threads),
        describe: async (url, caption) => describeImage(xai, model, await images.get(url), caption),
      },
      wit: (w) => witLine(xai, model, w),
      eyes: process.env.TAB_EYES !== "off",
      ask: { client: xai, model },
      summarize: (sm) => summarizeBreakdown(xai, model, sm, (why, reason) => log("summary_dropped", { why, reason })),
      timing: s.t,
      ledger: ledgerConfig(),
      memory: new Memory(),
      log,
    };
  }

  const ids: string[] = []; // fixture index → message_id
  const indexOf = (message_id?: string) => {
    if (!message_id) return null;
    const i = ids.indexOf(message_id);
    return i < 0 ? null : i;
  };
  const expState = (id: string): ExpState => {
    const e = db.exps.get(id)!;
    const shares = db.shares(id);
    return {
      status: e.status,
      total_cents: e.total_cents,
      payer: nameOf(e.payer_phone),
      description: e.description,
      split_mode: e.split_mode,
      participants: shares.filter((x) => x.status !== "opted_out").map((x) => nameOf(x.phone)!).sort(),
      shares: Object.fromEntries(shares.map((x) => [nameOf(x.phone)!, x.amount_cents])),
    };
  };
  const snapshot = () => ({
    exps: new Map([...db.exps.keys()].map((id) => [id, expState(id)])),
    out: new Map([...db.out.values()].map((o) => [o.action_id, o.status])),
  });
  const outRows = new Map<string, TabOut>();
  const infos = new Map<string, ExpenseInfo>();

  function diff(before: ReturnType<typeof snapshot>, at: number, phase: ExpenseInfo["created_phase"]): Effects {
    const after = snapshot();
    const fx: Effects = { created: [], changed: [], tab: [], cancelled: [] };
    for (const [id, st] of after.exps) {
      const e = db.exps.get(id)!;
      const source_index = indexOf(e.source_message_id);
      const prev = before.exps.get(id);
      let info = infos.get(id);
      if (!info) {
        info = { expense_id: id, source_index, created_index: at, created_phase: phase, totals: [], final: st };
        infos.set(id, info);
      }
      info.final = st;
      if (info.totals.at(-1) !== st.total_cents) info.totals.push(st.total_cents);
      if (!prev) fx.created.push({ expense_id: id, source_index, after: st, fields: [] });
      else if (material(prev) !== material(st)) fx.changed.push({ expense_id: id, source_index, before: prev, after: st, fields: changedFields(prev, st) });
    }
    for (const o of db.out.values()) {
      const was = before.out.get(o.action_id);
      if (was === undefined) {
        const row: TabOut = {
          action_id: o.action_id,
          kind: o.kind,
          purpose: o.purpose,
          text: o.text,
          reaction: o.reaction,
          to: nameOf(o.to_phone),
          target_index: indexOf(o.target_message_id) ?? undefined,
          expense_id: o.expense_id,
          send_after_s: Math.round((o.send_after.getTime() - clock.now.getTime()) / 1000),
        };
        outRows.set(o.action_id, row);
        fx.tab.push(row);
      } else if (was !== "cancelled" && o.status === "cancelled") fx.cancelled.push(o.action_id);
    }
    return fx;
  }

  // The scheduler: production ticks every schedulerIntervalMs, so time is
  // walked forward one tick at a time, delivering what came due.
  let nextTick = START.getTime() + s.t.schedulerIntervalMs;
  async function passTime(target: number, at: number, phase: "after" | "tail") {
    const b = (current = bucket());
    const before = snapshot();
    const t0 = performance.now();
    let ticks = 0;
    while (nextTick <= target) {
      clock.now = new Date(nextTick);
      await tick(ctx);
      db.deliver();
      nextTick += s.t.schedulerIntervalMs;
      ticks++;
    }
    clock.now = new Date(target);
    db.deliver();
    return { effects: diff(before, at, phase), grok: b.grok, log: b.log, ticks, ms: Math.round(performance.now() - t0) };
  }

  const records: MessageRecord[] = [];
  for (const [i, fm] of conv.messages.entries()) {
    const target = clock.now.getTime() + fm.gap_s * 1000;
    if (i > 0) records[i - 1]!.after = await passTime(target, i - 1, "after");
    else clock.now = new Date(target);

    const b = (current = bucket());
    const before = snapshot();
    // What the bridge writes for an incoming group text.
    const m = db.ingest({
      sender_phone: phones.get(fm.from)!,
      group_id: conv.id,
      kind: "text",
      text: fm.text,
      reply_to_id: fm.reply_to === undefined ? undefined : ids[fm.reply_to],
    });
    ids.push(m.message_id);
    const t0 = performance.now();
    await processMessage(ctx, m);
    const latency_ms = Math.round(performance.now() - t0);
    db.deliver();
    const row = db.msgs.get(m.message_id)!;
    const classified = b.log.find((e) => e.event === "classified");
    records.push({
      index: i,
      from: fm.from,
      text: fm.text,
      label: fm.label,
      t_s: Math.round((clock.now.getTime() - START.getTime()) / 1000),
      message_id: m.message_id,
      prefiltered: b.gate[0]?.prefiltered ?? false,
      gate: b.gate[0],
      decision: classified?.decision as string | undefined,
      final_intent: row.intent,
      status: row.status,
      error: row.error,
      latency_ms,
      grok: b.grok,
      jev: b.jev,
      log: b.log,
      effects: diff(before, i, "message"),
    });
  }
  const tail = await passTime(clock.now.getTime() + s.tailMs, conv.messages.length, "tail");

  // Where each of Tab's messages ended up: sent, still queued (due later), or cancelled.
  for (const row of outRows.values()) {
    const o = db.out.get(row.action_id)!;
    row.final_status = o.status;
  }
  const expenses = [...infos.values()];
  const result = {
    id: conv.id,
    title: conv.title,
    kind: conv.kind,
    file: conv.file,
    members: Object.fromEntries(phones),
    wall_ms: Math.round(performance.now() - wall0),
    records,
    tail,
    expenses,
    outbox: [...outRows.values()],
  };
  return { ...result, score: scoreConversation(conv, records, expenses) };
}

// ── Scoring ──────────────────────────────────────────────────────────────

type ExpenseOutcome = "caught" | "wrong_amount" | "asked" | "missed" | "voided";
type ExpenseScore = {
  index: number;
  outcome: ExpenseOutcome;
  expense_id?: string;
  expected: { amount_cents: number; final_amount_cents: number; payer: string; participants: string[] };
  got?: { amount_cents: number; totals: number[]; payer?: string; participants: string[]; status: string };
  amount_ok?: boolean;
  payer_ok?: boolean;
  participants_ok?: boolean;
  duplicates: string[]; // other expenses created from the same message(s)
};
type NoiseScore = {
  index: number;
  kind: "noise" | "payment";
  trap: string;
  false_positive: boolean;
  wrongly_logged: boolean;
  spoke: boolean; // Tab sent anything (text, DM or tapback) in response
  spoke_text: boolean; // a text message, group or DM
  tapback_only: boolean;
};
type PartScore = { index: number; group: string; outcome: "wrong_expense" | "started" | "asked" | "nothing"; spoke: boolean };
type CorrectionOutcome = "updated_right" | "updated_wrong" | "created_new" | "updated_other" | "asked" | "ignored";
type CorrectionScore = { index: number; fixes: number; target_logged: boolean; outcome: CorrectionOutcome; fields_wrong: string[] };
type AmbiguousScore = { index: number; outcome: "logged" | "asked" | "spoke" | "silent" };
type ConversationScore = {
  expense: ExpenseScore[];
  noise: NoiseScore[];
  expense_part: PartScore[];
  correction: CorrectionScore[];
  ambiguous: AmbiguousScore[];
  tab_texts: number; // Tab's text messages (group + DM) that went out or were still due
  tab_tapbacks: number;
  errors: number; // messages the brain failed on
};

const live = (o: TabOut) => o.final_status !== "cancelled";
const isText = (o: TabOut) => o.kind === "group_message" || o.kind === "dm";
const asked = (fx: Effects) =>
  fx.tab.some((o) => live(o) && (o.purpose === "clarifying_question" || (o.kind === "reaction" && o.reaction === "question")));
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].map((x) => x.toLowerCase()).sort().join() === [...b].map((x) => x.toLowerCase()).sort().join();

function scoreConversation(conv: Conversation, records: MessageRecord[], expenses: ExpenseInfo[]): ConversationScore {
  const msgs = conv.messages;
  const n = msgs.length;
  const everyone = conv.members;
  const people = (w: Who | undefined) => (w === undefined || w === "everyone" ? everyone : w);
  const labelAt = (i: number | null) => (i === null ? undefined : msgs[i]?.label);
  const expenseIdx = msgs.flatMap((m, i) => (m.label.kind === "expense" ? [i] : []));
  const partsOf = (group?: string) =>
    group ? msgs.flatMap((m, i) => (m.label.kind === "expense_part" && m.label.group === group ? [i] : [])) : [];
  const allFx = (i: number) => records[i]!.effects;

  // Expenses: each label claims the expense made from its own message (or
  // its fragments), else one that appeared while it was the latest expense
  // in the chat (an answer to Tab's question, say). Expenses made from noise,
  // payments or corrections never count as catching one.
  const assigned = new Map<number, ExpenseInfo>();
  const used = new Set<string>();
  const expenseScores: ExpenseScore[] = [];
  for (const i of expenseIdx) {
    const l = msgs[i]!.label as Extract<Label, { kind: "expense" }>;
    const own = new Set([i, ...partsOf(l.group)]);
    const start = Math.min(...own);
    const end = (expenseIdx.find((j) => j > i) ?? n) - 1;
    // The latest correction of this expense sets what it should end as.
    const fixes = msgs.flatMap((m, j) => (m.label.kind === "correction" && m.label.fixes === i ? [m.label] : []));
    const fix = fixes.at(-1);
    const expected = {
      amount_cents: l.amount_cents,
      final_amount_cents: fix?.amount_cents ?? l.amount_cents,
      payer: fix?.payer ?? l.payer,
      participants: [...people(fix?.participants ?? l.participants)].sort(),
    };
    const amountOk = (e: ExpenseInfo) => e.totals.includes(l.amount_cents) || e.final.total_cents === expected.final_amount_cents;
    const fromOwn = expenses.filter((e) => !used.has(e.expense_id) && e.source_index !== null && own.has(e.source_index));
    const inWindow = expenses.filter((e) => {
      if (used.has(e.expense_id) || fromOwn.includes(e)) return false;
      const k = labelAt(e.source_index)?.kind;
      if (k === "noise" || k === "payment" || k === "correction") return false;
      return e.created_phase !== "tail" && e.created_index >= start && e.created_index <= end;
    });
    const rank = (e: ExpenseInfo) => (e.final.status === "void" ? 2 : 0) + (amountOk(e) ? 0 : 1);
    const pick = [...fromOwn].sort((a, b) => rank(a) - rank(b))[0] ?? [...inWindow].sort((a, b) => rank(a) - rank(b))[0];
    const duplicates = fromOwn.filter((e) => e !== pick && e.final.status !== "void").map((e) => e.expense_id);
    for (const e of fromOwn) used.add(e.expense_id);
    if (pick) {
      used.add(pick.expense_id);
      assigned.set(i, pick);
    }
    const askedHere = [...own].some((j) => asked(allFx(j)));
    let outcome: ExpenseOutcome;
    if (!pick) outcome = askedHere ? "asked" : "missed";
    else if (pick.final.status === "void") outcome = "voided";
    else if (pick.final.status === "needs_info") outcome = "asked";
    else outcome = amountOk(pick) ? "caught" : "wrong_amount";
    const logged = pick && outcome !== "voided" && outcome !== "asked";
    expenseScores.push({
      index: i,
      outcome,
      expense_id: pick?.expense_id,
      expected,
      got: pick
        ? { amount_cents: pick.final.total_cents, totals: pick.totals, payer: pick.final.payer, participants: pick.final.participants, status: pick.final.status }
        : undefined,
      amount_ok: logged ? amountOk(pick) : undefined,
      payer_ok: logged ? pick.final.payer === expected.payer : undefined,
      participants_ok: logged ? sameSet(pick.final.participants, expected.participants) : undefined,
      duplicates,
    });
  }

  // Noise and payments: anything logged, changed or said is a false positive.
  const noise: NoiseScore[] = [];
  const ambiguous: AmbiguousScore[] = [];
  const parts: PartScore[] = [];
  const corrections: CorrectionScore[] = [];
  for (const [i, m] of msgs.entries()) {
    const fx = allFx(i);
    const out = fx.tab.filter(live);
    const spoke = out.length > 0;
    const l = m.label;
    if (l.kind === "noise" || l.kind === "payment") {
      const wrongly_logged = fx.created.length > 0 || fx.changed.length > 0;
      const spoke_text = out.some(isText);
      noise.push({
        index: i,
        kind: l.kind,
        trap: l.kind === "payment" ? "payment" : l.trap ?? "none",
        false_positive: wrongly_logged || spoke,
        wrongly_logged,
        spoke,
        spoke_text,
        tapback_only: spoke && !spoke_text,
      });
    } else if (l.kind === "ambiguous") {
      ambiguous.push({ index: i, outcome: fx.created.length ? "logged" : asked(fx) ? "asked" : spoke ? "spoke" : "silent" });
    } else if (l.kind === "expense_part") {
      const final = msgs.find((x) => x.label.kind === "expense" && x.label.group === l.group)?.label as Extract<Label, { kind: "expense" }> | undefined;
      const started = expenses.filter((e) => e.source_index === i || (e.created_phase === "message" && e.created_index === i));
      // Wrong: the first amount it was logged at (a needs_info row starts at $0) and its final amount both miss the label's.
      const wrong = started.some((e) => {
        const first = e.totals.find((t) => t > 0);
        return first !== undefined && first !== final?.amount_cents && e.final.total_cents !== final?.amount_cents;
      });
      parts.push({
        index: i,
        group: l.group,
        outcome: wrong ? "wrong_expense" : started.some((e) => e.final.status !== "needs_info") ? "started" : asked(fx) ? "asked" : "nothing",
        spoke,
      });
    } else if (l.kind === "correction") {
      // The expense it fixes: that label's, or the expense its fragment group became.
      const fixed = msgs[l.fixes]?.label;
      const owner =
        fixed?.kind === "expense"
          ? l.fixes
          : fixed?.kind === "expense_part"
            ? expenseIdx.find((j) => (msgs[j]!.label as { group?: string }).group === fixed.group)
            : undefined;
      const target = owner === undefined ? undefined : assigned.get(owner);
      const hit = target ? fx.changed.find((c) => c.expense_id === target.expense_id) : undefined;
      const fields_wrong: string[] = [];
      if (hit) {
        const a = hit.after;
        if (l.amount_cents !== undefined && a.total_cents !== l.amount_cents) fields_wrong.push("amount");
        if (l.payer !== undefined && a.payer !== l.payer) fields_wrong.push("payer");
        if (l.participants !== undefined && !sameSet(a.participants, [...people(l.participants)])) fields_wrong.push("participants");
        if (l.description !== undefined && !a.description.toLowerCase().includes(l.description.toLowerCase())) fields_wrong.push("description");
      }
      const outcome: CorrectionOutcome = fx.created.length
        ? "created_new"
        : hit
          ? fields_wrong.length ? "updated_wrong" : "updated_right"
          : fx.changed.length
            ? "updated_other"
            : asked(fx)
              ? "asked"
              : "ignored";
      corrections.push({ index: i, fixes: l.fixes, target_logged: Boolean(target), outcome, fields_wrong });
    }
  }

  const allOut = [...records.flatMap((r) => [...r.effects.tab, ...(r.after?.effects.tab ?? [])])];
  return {
    expense: expenseScores,
    noise,
    expense_part: parts,
    correction: corrections,
    ambiguous,
    tab_texts: allOut.filter((o) => live(o) && isText(o)).length,
    tab_tapbacks: allOut.filter((o) => live(o) && o.kind === "reaction").length,
    errors: records.filter((r) => r.status === "error").length,
  };
}

// ── Cost ─────────────────────────────────────────────────────────────────

// xAI's /v1/language-models prices are in 1e-10 USD per token (10000 = $1
// per million). Fallback: grok-4.20-0309-non-reasoning on 2026-10-13.
type GrokPricing = { input: number; cached: number; output: number; source: string };
const FALLBACK_PRICING: GrokPricing = { input: 12500, cached: 2000, output: 25000, source: "fallback (grok-4.20 list price, 2026-10-13)" };

async function grokPricing(apiKey: string, baseURL: string, model: string): Promise<GrokPricing> {
  try {
    const res = await realFetch(`${baseURL}/language-models/${encodeURIComponent(model)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = (await res.json()) as { prompt_text_token_price?: number; cached_prompt_text_token_price?: number; completion_text_token_price?: number };
    if (m.prompt_text_token_price === undefined || m.completion_text_token_price === undefined) throw new Error("no prices");
    return {
      input: m.prompt_text_token_price,
      cached: m.cached_prompt_text_token_price ?? m.prompt_text_token_price,
      output: m.completion_text_token_price,
      source: `xAI /v1/language-models/${model}`,
    };
  } catch {
    return FALLBACK_PRICING;
  }
}

// TypeSafe publishes no price list. Third-party listings (llmreference.com,
// pub.towardsai.net) give $0.042 per million input tokens, output free; this
// is an estimate, not a confirmed price.
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;

const grokCallUsd = (c: GrokCall, p: GrokPricing) => {
  if (c.cost_in_usd_ticks !== undefined) return c.cost_in_usd_ticks / 1e10;
  const cached = c.cached_tokens ?? 0;
  const prompt = c.prompt_tokens ?? 0;
  // xAI reports reasoning tokens apart from completion tokens; both bill as output.
  const output = (c.completion_tokens ?? 0) + (c.reasoning_tokens ?? 0);
  return ((prompt - cached) * p.input + cached * p.cached + output * p.output) / 1e10;
};

// ── Summary ──────────────────────────────────────────────────────────────

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
function percentile(xs: number[], p: number) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
}
const countBy = <T>(xs: T[], key: (x: T) => string) =>
  xs.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});

function summarize(results: ConversationResult[], pricing: GrokPricing | null, wall_ms: number) {
  const scores = results.map((r) => r.score);
  const records = results.flatMap((r) => r.records);
  const exp = scores.flatMap((s) => s.expense);
  const noise = scores.flatMap((s) => s.noise);
  const parts = scores.flatMap((s) => s.expense_part);
  const corr = scores.flatMap((s) => s.correction);
  const amb = scores.flatMap((s) => s.ambiguous);
  const logged = exp.filter((e) => e.amount_ok !== undefined);
  const grok = results.flatMap((r) => [...r.records.flatMap((m) => [...m.grok, ...(m.after?.grok ?? [])]), ...r.tail.grok]);
  const jev = records.flatMap((r) => r.jev);
  const byTrap: Record<string, { total: number; false_positive: number; wrongly_logged: number; spoke: number; spoke_text: number }> = {};
  for (const x of noise) {
    const t = (byTrap[x.trap] ??= { total: 0, false_positive: 0, wrongly_logged: 0, spoke: 0, spoke_text: 0 });
    t.total++;
    t.false_positive += Number(x.false_positive);
    t.wrongly_logged += Number(x.wrongly_logged);
    t.spoke += Number(x.spoke);
    t.spoke_text += Number(x.spoke_text);
  }
  const noiseOnly = noise.filter((x) => x.kind === "noise");
  const payments = noise.filter((x) => x.kind === "payment");
  const grokUsd = pricing ? grok.reduce((t, c) => t + grokCallUsd(c, pricing), 0) : 0;
  const jevInput = jev.reduce((t, c) => t + (c.input_tokens ?? 0), 0);
  const jevUsd = jevInput * JEV_USD_PER_INPUT_TOKEN;
  const latencies = records.map((r) => r.latency_ms);
  const gated = records.filter((r) => !r.prefiltered).map((r) => r.latency_ms);
  const tokens = (k: keyof GrokCall) => grok.reduce((t, c) => t + ((c[k] as number | undefined) ?? 0), 0);
  return {
    conversations: results.length,
    messages: records.length,
    wall_ms,
    expense: {
      total: exp.length,
      ...countBy(exp, (e) => e.outcome),
      catch_rate: pct(exp.filter((e) => e.outcome === "caught").length, exp.length),
      logged: logged.length,
      payer_ok: logged.filter((e) => e.payer_ok).length,
      participants_ok: logged.filter((e) => e.participants_ok).length,
      all_correct: logged.filter((e) => e.amount_ok && e.payer_ok && e.participants_ok).length,
      duplicates: exp.reduce((t, e) => t + e.duplicates.length, 0),
    },
    noise: {
      total: noiseOnly.length,
      false_positive: noiseOnly.filter((x) => x.false_positive).length,
      false_positive_rate: pct(noiseOnly.filter((x) => x.false_positive).length, noiseOnly.length),
      wrongly_logged: noiseOnly.filter((x) => x.wrongly_logged).length,
      spoke_on_noise: noiseOnly.filter((x) => x.spoke).length,
      spoke_text_on_noise: noiseOnly.filter((x) => x.spoke_text).length,
      tapback_only_on_noise: noiseOnly.filter((x) => x.tapback_only).length,
    },
    payment: {
      total: payments.length,
      false_positive: payments.filter((x) => x.false_positive).length,
      wrongly_logged: payments.filter((x) => x.wrongly_logged).length,
      spoke: payments.filter((x) => x.spoke).length,
    },
    by_trap: byTrap,
    expense_part: { total: parts.length, ...countBy(parts, (p) => p.outcome), spoke: parts.filter((p) => p.spoke).length },
    correction: { total: corr.length, ...countBy(corr, (c) => c.outcome), target_not_logged: corr.filter((c) => !c.target_logged).length },
    ambiguous: { total: amb.length, ...countBy(amb, (a) => a.outcome) },
    tab: {
      texts: scores.reduce((t, s) => t + s.tab_texts, 0),
      tapbacks: scores.reduce((t, s) => t + s.tab_tapbacks, 0),
      texts_per_conversation: results.map((r) => ({ id: r.id, texts: r.score.tab_texts, tapbacks: r.score.tab_tapbacks })),
    },
    errors: scores.reduce((t, s) => t + s.errors, 0),
    gate: {
      prefiltered: records.filter((r) => r.prefiltered).length,
      jev_calls: jev.length,
      jev_retries: jev.reduce((t, c) => t + c.retries, 0),
      jev_errors: jev.filter((c) => c.error || (c.status ?? 200) >= 400).length,
      jev_input_tokens: jevInput,
      jev_output_tokens: jev.reduce((t, c) => t + (c.output_tokens ?? 0), 0),
      intents: countBy(records.filter((r) => r.gate && !r.prefiltered), (r) => r.gate?.intent ?? "error"),
    },
    grok: {
      calls: grok.length,
      errors: grok.filter((c) => c.error).length,
      by_name: countBy(grok, (c) => c.name),
      prompt_tokens: tokens("prompt_tokens"),
      cached_tokens: tokens("cached_tokens"),
      completion_tokens: tokens("completion_tokens"),
      reasoning_tokens: tokens("reasoning_tokens"),
      reported_cost_calls: grok.filter((c) => c.cost_in_usd_ticks !== undefined).length,
    },
    cost_usd: {
      grok: Number(grokUsd.toFixed(5)),
      grok_by_name: pricing
        ? Object.fromEntries(
            Object.keys(countBy(grok, (c) => c.name)).map((k) => [k, Number(grok.filter((c) => c.name === k).reduce((t, c) => t + grokCallUsd(c, pricing), 0).toFixed(5))]),
          )
        : {},
      jev_estimate: Number(jevUsd.toFixed(6)),
      jev_note: "TypeSafe has no public price list; estimated at $0.042/M input tokens (third-party listings), output free",
      total: Number((grokUsd + jevUsd).toFixed(5)),
      per_100_messages: records.length ? Number((((grokUsd + jevUsd) * 100) / records.length).toFixed(5)) : 0,
      grok_pricing: pricing,
    },
    latency_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(0, ...latencies),
      gated_p50: percentile(gated, 0.5),
      gated_p95: percentile(gated, 0.95),
    },
  };
}

function printSummary(s: ReturnType<typeof summarize>, results: ConversationResult[], file: string) {
  const L = (x: string) => console.log(x);
  L("\n── noise eval ─────────────────────────────────────────────");
  L(`${s.conversations} conversations, ${s.messages} messages, ${(s.wall_ms / 1000).toFixed(1)}s wall`);
  const e = s.expense as Record<string, number | string>;
  L(`\nexpenses: ${e.caught ?? 0}/${e.total} caught (${e.catch_rate}), ${e.asked ?? 0} asked, ${e.missed ?? 0} missed, ${e.wrong_amount ?? 0} wrong amount, ${e.voided ?? 0} voided, ${e.duplicates} duplicates`);
  L(`  of ${e.logged} logged: payer right ${e.payer_ok}, participants right ${e.participants_ok}, all right ${e.all_correct}`);
  L(`noise: ${s.noise.false_positive}/${s.noise.total} false positives (${s.noise.false_positive_rate}): wrongly logged ${s.noise.wrongly_logged}, spoke ${s.noise.spoke_on_noise} (text ${s.noise.spoke_text_on_noise}, tapback only ${s.noise.tapback_only_on_noise})`);
  L(`payments: ${s.payment.false_positive}/${s.payment.total} false positives (logged ${s.payment.wrongly_logged}, spoke ${s.payment.spoke})`);
  L(`by trap: ${Object.entries(s.by_trap).map(([k, v]) => `${k} ${v.false_positive}/${v.total}`).join(", ")}`);
  const fmt = (o: Record<string, unknown>) => Object.entries(o).filter(([k]) => k !== "total").map(([k, v]) => `${k} ${v}`).join(", ");
  L(`expense parts (${s.expense_part.total}): ${fmt(s.expense_part)}`);
  L(`corrections (${s.correction.total}): ${fmt(s.correction)}`);
  L(`ambiguous (${s.ambiguous.total}): ${fmt(s.ambiguous)}`);
  L(`\nTab sent ${s.tab.texts} texts and ${s.tab.tapbacks} tapbacks (${(s.tab.texts / Math.max(1, s.conversations)).toFixed(1)} texts per conversation); ${s.errors} messages errored`);
  L(`gate: ${s.gate.prefiltered} pre-filtered, ${s.gate.jev_calls} Jev calls (${s.gate.jev_input_tokens} input tokens, ${s.gate.jev_retries} retries, ${s.gate.jev_errors} errors)`);
  L(`grok: ${s.grok.calls} calls (${fmt(s.grok.by_name)}), ${s.grok.prompt_tokens} prompt (${s.grok.cached_tokens} cached) + ${s.grok.completion_tokens} completion tokens, ${s.grok.errors} errors`);
  L(`cost: $${s.cost_usd.total.toFixed(4)} (grok $${s.cost_usd.grok.toFixed(4)}: ${Object.entries(s.cost_usd.grok_by_name).map(([k, v]) => `${k} $${v.toFixed(4)}`).join(", ")}; jev ~$${s.cost_usd.jev_estimate.toFixed(5)} estimated), $${s.cost_usd.per_100_messages.toFixed(4)} per 100 messages`);
  L(`latency per message: p50 ${s.latency_ms.p50} ms, p95 ${s.latency_ms.p95} ms (past the pre-filter: p50 ${s.latency_ms.gated_p50}, p95 ${s.latency_ms.gated_p95})`);

  // The misses, so the run is useful without opening the JSON.
  const lines: string[] = [];
  for (const r of results) {
    const text = (i: number) => JSON.stringify(r.records[i]!.text);
    const said = (i: number) =>
      r.records[i]!.effects.tab.filter(live).map((o) => (o.kind === "reaction" ? `[${o.reaction}]` : JSON.stringify(o.text?.slice(0, 80)))).join(" ");
    const gate = (i: number) => {
      const g = r.records[i]!.gate;
      return g?.prefiltered ? "prefiltered" : g ? `${g.intent} ${g.confidence?.toFixed(2)}` : "no gate";
    };
    for (const x of r.score.noise.filter((x) => x.false_positive))
      lines.push(`  FP   ${r.id}#${x.index} [${x.trap}] ${text(x.index)} gate=${gate(x.index)}${x.wrongly_logged ? " LOGGED" : ""} ${said(x.index)}`);
    for (const x of r.score.expense.filter((x) => x.outcome !== "caught" || !x.payer_ok || !x.participants_ok))
      lines.push(`  EXP  ${r.id}#${x.index} ${x.outcome}${x.outcome === "caught" ? ` payer_ok=${x.payer_ok} participants_ok=${x.participants_ok}` : ""} ${text(x.index)} gate=${gate(x.index)} ${said(x.index)}`);
    for (const x of r.score.correction.filter((x) => x.outcome !== "updated_right"))
      lines.push(`  CORR ${r.id}#${x.index} ${x.outcome}${x.fields_wrong.length ? ` (${x.fields_wrong.join(",")})` : ""} ${text(x.index)} gate=${gate(x.index)} ${said(x.index)}`);
    for (const x of r.score.expense_part.filter((x) => x.outcome === "wrong_expense"))
      lines.push(`  PART ${r.id}#${x.index} wrong expense from fragment ${text(x.index)}`);
    for (const rec of r.records.filter((m) => m.status === "error")) lines.push(`  ERR  ${r.id}#${rec.index} ${rec.error?.slice(0, 120)}`);
  }
  if (lines.length) L(`\nto look at:\n${lines.join("\n")}`);
  L(`\nresults: ${relative(process.cwd(), file)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string" },
      concurrency: { type: "string", default: "3" },
      limit: { type: "string" },
      stub: { type: "boolean", default: false },
      "tail-s": { type: "string" },
      out: { type: "string" },
    },
  });
  const t = timing();
  const concurrency = Math.max(1, Number(values.concurrency) || 3);
  const tailMs = values["tail-s"] !== undefined ? Number(values["tail-s"]) * 1000 : t.durations.OBJECTION_WINDOW + t.durations.OBJECTION_EXTENSION + 60_000;

  let conversations = loadConversations(positionals.length ? positionals : [join(ROOT, "fixtures", "noise")]);
  if (values.only) conversations = conversations.filter((c) => c.id?.startsWith(values.only!));
  const seen = new Set<string>();
  conversations = conversations.filter((c) => {
    const problems = problemsIn(c);
    if (seen.has(c.id)) problems.push("duplicate id");
    seen.add(c.id);
    if (problems.length) console.warn(`skipping ${c.id ?? c.file} (${c.file}): ${problems.join("; ")}`);
    return problems.length === 0;
  });
  if (values.limit) conversations = conversations.slice(0, Number(values.limit));
  if (conversations.length === 0) throw new Error("no conversations to run");

  let setup: Setup;
  let pricing: GrokPricing | null = null;
  let gateKind: string;
  if (values.stub) {
    const prefilter = prefilterEnabled(process.env.GATE_PREFILTER);
    setup = { stub: true, t, tailMs, classify: prefilter ? withPrefilter(stubClassifier) : stubClassifier, model: "stub" };
    gateKind = `stub${prefilter ? " + prefilter" : ""}`;
  } else {
    const grok = grokConfig();
    const gate = createClassify();
    pricing = await grokPricing(grok.apiKey, grok.baseURL, grok.model);
    setup = { stub: false, t, tailMs, classify: gate.classify, xai: createXaiClient(grok.apiKey, grok.baseURL), model: grok.model };
    gateKind = `${gate.kind}${gate.prefilter ? " + prefilter" : ""}`;
  }
  const messages = conversations.reduce((n, c) => n + c.messages.length, 0);
  console.log(
    `noise eval: ${conversations.length} conversations, ${messages} messages, ${values.stub ? "STUB (no API calls)" : `model ${setup.model}`}, gate ${gateKind}, ` +
      `${t.demo ? "DEMO_MODE timing" : "production timing"} (tick ${t.schedulerIntervalMs / 1000}s, tail ${Math.round(tailMs / 60000)} min), concurrency ${concurrency}`,
  );

  const started = new Date();
  const wall0 = performance.now();
  const results: ConversationResult[] = new Array(conversations.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, conversations.length) }, async () => {
      for (;;) {
        const k = next++;
        if (k >= conversations.length) return;
        const conv = conversations[k]!;
        try {
          results[k] = await runConversation(conv, setup);
          const s = results[k]!.score;
          const fp = s.noise.filter((x) => x.false_positive).length;
          const caught = s.expense.filter((x) => x.outcome === "caught").length;
          console.log(
            `[${++done}/${conversations.length}] ${conv.id}: ${conv.messages.length} msgs, caught ${caught}/${s.expense.length}, FP ${fp}/${s.noise.length}, ` +
              `${s.tab_texts} texts, ${(results[k]!.wall_ms / 1000).toFixed(1)}s`,
          );
        } catch (err) {
          console.error(`[${++done}/${conversations.length}] ${conv.id}: crashed: ${String(err)}`);
        }
      }
    }),
  );
  const ok = results.filter(Boolean);
  const wall_ms = Math.round(performance.now() - wall0);
  const summary = summarize(ok, pricing, wall_ms);

  const outFile = values.out
    ? resolve(values.out)
    : join(BACKEND, "results", `noise-eval-${started.toISOString().replace(/[:.]/g, "-")}${values.stub ? "-stub" : ""}.json`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        run: {
          started: started.toISOString(),
          wall_ms,
          stub: values.stub,
          model: setup.model,
          gate: gateKind,
          timing: { demo: t.demo, scheduler_interval_ms: t.schedulerIntervalMs, durations: t.durations, quiet_hours: t.quietHours, tail_ms: tailMs },
          sim_start: START.toISOString(),
          args: { files: positionals, only: values.only, concurrency, limit: values.limit },
          crashed: conversations.filter((_, k) => !results[k]).map((c) => c.id),
        },
        summary,
        conversations: ok,
      },
      null,
      2,
    ),
  );
  printSummary(summary, ok, outFile);
  if (ok.length !== conversations.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

