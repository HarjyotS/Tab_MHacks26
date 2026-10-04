// The backend service: SPEC §11.1 processing loop plus the §11.2 scheduler,
// reading Kian's backend_* views and writing only through reducers.
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
import { imageAsDataUrl } from "./extraction/image.js";
import { describeImage } from "./extraction/describe.js";
import { witLine } from "./copy/wit.js";
import { Memory, type BrainCtx } from "./brain/context.js";
import { processMessage, tick } from "./brain/process.js";
import { BACKEND_VIEWS, spacetimeStore } from "./store/spacetime.js";
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

// A dropped connection can't recover in place; exit so the runner restarts us.
const { conn, identity, token } = await connectBackend((error) => {
  log("disconnected", { error: String(error) });
  process.exit(1);
});
log("connected", { identity, gate: kind, prefilter, demo_mode: t.demo });
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
    .onError((ctx) =>
      reject(new Error(`subscription failed: ${String(ctx.event)}`)),
    )
    .subscribe(BACKEND_VIEWS);
});

const store = spacetimeStore(conn.db);
if (store.groups().length === 0)
  log("no_rows_visible", {
    hint: "Empty views usually mean this identity lacks the backend role.",
  });

const ctx: BrainCtx = {
  store,
  db: createReducers(conn.reducers),
  now: () => new Date(),
  classify,
  extract: {
    expense: (input, mode) => extractExpense(xai, grok.model, input, mode),
    receipt: async (url, caption) => extractReceipt(xai, grok.model, await imageAsDataUrl(url), caption),
    claim: (input, items) => resolveClaim(xai, grok.model, input, items),
    correction: (input) => extractCorrection(xai, grok.model, input),
    answer: (input, threads) => resolveAnswer(xai, grok.model, input, threads),
    // Every photo in an enabled chat, before the gate (§7.4, §19).
    describe: async (url, caption) => describeImage(xai, grok.model, await imageAsDataUrl(url), caption),
  },
  wit: (w) => witLine(xai, grok.model, w),
  timing: t,
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

conn.db.backendMessages.onInsert(
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
