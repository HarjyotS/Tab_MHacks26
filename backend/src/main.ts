// The backend service: SPEC §11.1 processing loop plus the §11.2 scheduler,
// reading the Store and writing only through the reducers.
//   npm start -w backend
import { grokConfig, ledgerConfig, timing } from "./config.js";
import { connectBackend } from "./db/connection.js";
import { createReducers } from "./db/reducers.js";
import { createClassify } from "./gate/index.js";
import { createXaiClient } from "./grok/structured.js";
import { extractExpense } from "./extraction/expense.js";
import { extractReceipt } from "./extraction/receipt.js";
import { resolveClaim } from "./extraction/claim.js";
import { extractCorrection } from "./extraction/correction.js";
import { resolveAnswer } from "./extraction/answer.js";
import { ImageCache } from "./extraction/image.js";
import { describeImage } from "./extraction/describe.js";
import { witLine } from "./copy/wit.js";
import { summarizeBreakdown } from "./copy/summary.js";
import { Memory, type BrainCtx } from "./brain/context.js";
import { processMessage, tick } from "./brain/process.js";
import { BACKEND_VIEWS, spacetimeStore } from "./store/spacetime.js";
import { Engine } from "./store/engine.js";
import { claimLease, load, migrate, neonSql, persistTo } from "./store/postgres.js";
import type { Store } from "./store/types.js";
import { startHub } from "./hub.js";
import { serial } from "./serial.js";

// Structured logs, one JSON object per line (no message text).
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
  );

const grok = grokConfig();
const xai = createXaiClient(grok.apiKey, grok.baseURL);
const t = timing();
const { classify, kind, prefilter } = createClassify();

// Where Tab's data lives. With DATABASE_URL, Postgres (Neon): the backend
// holds the rows, the bridge talks to it over localhost (hub.ts). Without
// it, the SpacetimeDB module, as at the hackathon.
type Data = { store: Store; reducers: ReturnType<typeof createReducers>; onNewMessage: (cb: () => void) => void };

async function postgresData(url: string): Promise<Data> {
  const sql = neonSql(url);
  await migrate(sql);
  // This backend becomes the only one allowed to save (postgres.ts).
  const owner = `${process.env.HOSTNAME || "backend"}:${process.pid}:${crypto.randomUUID()}`;
  await claimLease(sql, owner);
  let notify = () => {};
  const engine = new Engine({
    now: () => new Date(),
    persist: persistTo(sql, { owner, log }),
    autoComplete: true,
    demo: t.demo,
    onIngest: () => notify(),
    // Unknown whether the change landed: restart, and memory reloads from
    // Neon. launchd starts us again; the bridge holds messages meanwhile.
    onSaveFailed: (err) => {
      log("save_failed_restarting", { error: err.message.slice(0, 200) });
      setTimeout(() => process.exit(1), 200);
    },
    log,
  });
  await load(sql, engine);
  // Simulated transfers that were waiting when the backend stopped.
  await engine.completeDueTransfers();
  const port = Number(process.env.HUB_PORT || 4100);
  const hub = await startHub(engine, { port, token: process.env.TAB_HUB_TOKEN || undefined, log });
  // On a restart (every deploy), stop taking requests and let saves in
  // flight finish, so nothing the bridge was told is done goes missing.
  const stop = (signal: string) => {
    log("stopping", { signal });
    hub.close();
    engine.stop();
    void Promise.race([engine.settled(), new Promise((r) => setTimeout(r, 15_000))]).then(() => process.exit(0));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  log("connected", { store: "postgres", hub: `127.0.0.1:${port}`, gate: kind, prefilter, demo_mode: t.demo });
  return { store: engine, reducers: createReducers(engine.client), onNewMessage: (cb) => (notify = cb) };
}

async function spacetimeData(): Promise<Data> {
  // A dropped connection can't recover in place; exit so the runner restarts us.
  const { conn, identity, token } = await connectBackend((error) => {
    log("disconnected", { error: String(error) });
    process.exit(1);
  });
  log("connected", { store: "spacetime", identity, gate: kind, prefilter, demo_mode: t.demo });
  if (!process.env.BACKEND_SPACETIME_TOKEN) {
    log("save_token", {
      hint: "Add BACKEND_SPACETIME_TOKEN to backend/.env to keep this identity, then have the module owner grant it the backend role.",
    });
    console.log(`BACKEND_SPACETIME_TOKEN=${token}`);
  }

  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(`subscription failed: ${String(ctx.event)}`)))
      .subscribe(BACKEND_VIEWS);
  });

  const store = spacetimeStore(conn.db);
  if (store.groups().length === 0)
    log("no_rows_visible", {
      hint: "Empty views usually mean this identity lacks the backend role.",
    });
  return {
    store,
    reducers: createReducers(conn.reducers),
    onNewMessage: (cb) => conn.db.backendMessages.onInsert(() => cb()),
  };
}

const data = process.env.DATABASE_URL ? await postgresData(process.env.DATABASE_URL) : await spacetimeData();
const store = data.store;

// The photo description and the receipt read fetch each image once.
const images = new ImageCache();

const ctx: BrainCtx = {
  store,
  db: data.reducers,
  now: () => new Date(),
  classify,
  extract: {
    expense: (input, mode) => extractExpense(xai, grok.model, input, mode),
    receipt: async (url, caption) => extractReceipt(xai, grok.model, await images.get(url), caption),
    claim: (input, items) => resolveClaim(xai, grok.model, input, items),
    correction: (input) => extractCorrection(xai, grok.model, input),
    answer: (input, threads) => resolveAnswer(xai, grok.model, input, threads),
    // Every photo in an enabled chat, before the gate (§7.4, §19).
    // Shares its download with the receipt read (Joe's review on #41).
    describe: async (url, caption) => describeImage(xai, grok.model, await images.get(url), caption),
    // §19: the photo's text, read on the Tab Mac by the bridge (GET .txt
    // next to the .jpg). Grok sees a photo only if this or the caption could
    // be about money.
    screen: async (url) => {
      const res = await fetch(url.replace(/\.jpg(?=$|\?)/, ".txt"), { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) throw new Error(`photo text: HTTP ${res.status}`);
      return res.text();
    },
  },
  wit: (w) => witLine(xai, grok.model, w),
  eyes: process.env.TAB_EYES !== "off",
  // The money brain: Grok with read-only lookup tools (brain/ask.ts).
  ask: { client: xai, model: grok.model },
  summarize: (s) => summarizeBreakdown(xai, grok.model, s, (why, reason) => log("summary_dropped", { why, reason })),
  timing: t,
  payments: process.env.PAYMENTS === "simulated" ? "simulated" : "links",
  ledger: ledgerConfig(),
  memory: new Memory(),
  log,
};

// One job at a time, messages oldest first, and never alongside the
// scheduler, so the state each handler reads is current.
const exclusive = serial();

// Messages left `processing` by a crash are picked up once, at startup.
const stuck = new Set(
  store
    .messages()
    .filter((m) => m.status === "processing")
    .map((m) => m.message_id),
);

function drain() {
  return exclusive(async () => {
    for (;;) {
      const next = store
        .messages()
        .filter((m) => m.status === "new" || (m.status === "processing" && stuck.has(m.message_id)))
        .sort((a, b) => a.received_at.getTime() - b.received_at.getTime())[0];
      if (!next) break;
      stuck.delete(next.message_id);
      await processMessage(ctx, next);
    }
  });
}

data.onNewMessage(
  () =>
    void drain().catch((err: unknown) =>
      log("drain_failed", { error: String(err) }),
    ),
);

setInterval(() => {
  void (async () => {
    try {
      await drain();
      await exclusive(() => tick(ctx));
    } catch (err) {
      log("tick_failed", { error: String(err) });
    }
  })();
}, t.schedulerIntervalMs);

await drain();
log("running", { scheduler_ms: t.schedulerIntervalMs });
