// The backend service: SPEC §11.1 processing loop plus the §11.2 scheduler,
// reading Kian's backend_* views and writing only through reducers.
//   npm start -w backend
import { grokConfig, timing } from "./config.js";
import { connectBackend } from "./db/connection.js";
import { createReducers } from "./db/reducers.js";
import { createClassify } from "./gate/index.js";
import { createXaiClient } from "./grok/structured.js";
import { extractExpense } from "./extraction/expense.js";
import { extractReceipt } from "./extraction/receipt.js";
import { resolveClaim } from "./extraction/claim.js";
import { imageAsDataUrl } from "./extraction/image.js";
import { witLine } from "./copy/wit.js";
import { Memory, type BrainCtx } from "./brain/context.js";
import { processMessage, tick } from "./brain/process.js";
import { BACKEND_VIEWS, spacetimeStore } from "./store/spacetime.js";

// Structured logs, one JSON object per line (no message text).
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
  );

const grok = grokConfig();
const xai = createXaiClient(grok.apiKey, grok.baseURL);
const t = timing();
const { classify, kind } = createClassify();

const { conn, identity, token } = await connectBackend();
log("connected", { identity, gate: kind, demo_mode: t.demo });
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
  },
  wit: (w) => witLine(xai, grok.model, w),
  timing: t,
  memory: new Memory(),
  log,
};

// One message at a time, oldest first, so state each handler reads is current.
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const next = store
        .messages()
        .filter((m) => m.status === "new")
        .sort((a, b) => a.received_at.getTime() - b.received_at.getTime())[0];
      if (!next) break;
      await processMessage(ctx, next);
    }
  } finally {
    draining = false;
  }
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
      await tick(ctx);
    } catch (err) {
      log("tick_failed", { error: String(err) });
    }
  })();
}, t.schedulerIntervalMs);

await drain();
log("running", { scheduler_ms: t.schedulerIntervalMs });
