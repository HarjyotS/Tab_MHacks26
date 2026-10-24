import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Bridge } from "./bridge.ts";
import { ChatDb } from "./chatdb.ts";
import { config } from "./config.ts";
import { Gate } from "./gate.ts";
import { DevHub, HubUnavailable, type Hub } from "./hub.ts";
import { ImageStore } from "./images.ts";
import { osascriptSender, photonDmSender, spectrumSender } from "./sender.ts";
import { spacetimeHub } from "./spacetime-hub.ts";
import { backendHub } from "./backend-hub.ts";
import { State } from "./state.ts";
import { uiReplier } from "./reply.ts";
import { axTapbacker, runTabAx, uiTapbacker } from "./tapback.ts";
import { ImsgRpc, imsgReplier, imsgTapbacker } from "./imsg.ts";

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

if (process.platform !== "darwin") {
  console.error("The Tab bridge has to run on the Mac that's signed into Tab's iMessage account.");
  process.exit(1);
}

let db: ChatDb;
try {
  db = new ChatDb(config.chatDbPath);
} catch (err) {
  console.error(`Can't open ${config.chatDbPath}: ${err}`);
  console.error(
    "Give your terminal app Full Disk Access (System Settings → Privacy & Security → Full Disk Access), then quit and reopen it.",
  );
  process.exit(1);
}

const state = new State(config.statePath);
const gate = new Gate(state, config.dmReplyWindowMs, config.readDms);
for (const id of config.groupIds) gate.enable(id);

let devHub: DevHub | null = null;
let hub: Hub;
if (config.hub === "spacetime") {
  // Tokens are per server, so keep one per database (local and Maincloud can't share).
  const tokenPath = join(dirname(config.statePath), `spacetime-token-${config.spacetime.database}`);
  const saved = config.spacetime.token ?? (existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : undefined);
  const spacetime = await spacetimeHub({
    uri: config.spacetime.uri,
    database: config.spacetime.database,
    token: saved,
    onToken: (token) => {
      if (config.spacetime.token) return;
      mkdirSync(dirname(tokenPath), { recursive: true });
      writeFileSync(tokenPath, token, { mode: 0o600 });
    },
    timezone: config.timezone,
    log,
    onDisconnect: (error) => {
      console.error(`Lost the SpacetimeDB connection${error ? `: ${error.message}` : ""}. Restart the bridge.`);
      process.exit(1);
    },
  });
  log(`Connected to SpacetimeDB ${config.spacetime.database} as ${spacetime.identity}.`);
  log(`If ingest fails with "Requires service role", have the module owner run: npm run grant:role -- ${spacetime.identity} client`);
  hub = spacetime;
} else if (config.hub === "backend") {
  hub = backendHub({ url: config.backend.url, token: config.backend.token, timezone: config.timezone });
  log(`Talking to the backend at ${config.backend.url}.`);
} else if (config.hub === "dev") {
  devHub = new DevHub(config.echo, log);
  hub = devHub;
} else {
  console.error(`Unknown HUB=${config.hub}. Use backend, spacetime, or dev.`);
  process.exit(1);
}

const sender = config.sendVia === "osascript" ? osascriptSender() : await spectrumSender();
// Hackathon track: payment confirmations go through Photon's Spectrum API.
const photon =
  process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET && process.env.DM_VIA !== "local"
    ? await photonDmSender(process.env.SPECTRUM_PROJECT_ID, process.env.SPECTRUM_PROJECT_SECRET).catch((err) => {
        log(`Photon DM sender unavailable (${String(err).slice(0, 160)}); confirmations go out locally`);
        return null;
      })
    : null;
if (photon) log("Payment confirmations go out through Photon (Spectrum cloud).");
const images = new ImageStore(config.imageDir, config.imageBaseUrl, config.imageMaxAgeMs);

// imsg (SIP off, helper injected with `imsg launch`) reacts and replies to any
// message by guid; the UI only to each chat's newest. Its readiness is
// logged at startup, and an action it can't start falls back like the UI's.
const imsg = config.tapbackMode === "imsg" || config.replyMode === "imsg" ? new ImsgRpc(config.imsgPath, log) : null;
if (imsg) {
  const check = await imsg.ready(["tapback", "send.rich"]);
  log(check.ok ? "imsg helper is up: tapbacks and replies go through it." : `imsg isn't ready (${check.why}); run "imsg launch" with SIP off.`);
}
// tab-ax reacts to any message, emoji too; without it, the picker does the classic six.
const tabAx = config.tapbackMode === "ax" && existsSync(config.tabAxPath);
if (config.tapbackMode === "ax" && !tabAx) log(`tab-ax isn't built at ${config.tabAxPath} (ops/update.sh builds it); tapbacks use the picker.`);
const tapbacker =
  config.tapbackMode === "off" ? null
  : config.tapbackMode === "imsg" && imsg ? imsgTapbacker(imsg)
  : tabAx ? axTapbacker(runTabAx(config.tabAxPath))
  : uiTapbacker();

const bridge = new Bridge(db, hub, sender, tapbacker, images, gate, state, {
  commandPrefix: config.commandPrefix,
  tabName: config.tabName,
  tabPhone: config.tabPhone,
  tabEmail: config.tabEmail,
  autoJoin: config.autoJoin,
  sendMatchTimeoutMs: config.sendMatchTimeoutMs,
  photonDm: photon ? (handle, body) => photon.send(handle, body) : undefined,
  tapbackVerifyMs: config.tapbackVerifyMs,
  replier: config.replyMode === "off" ? null : config.replyMode === "imsg" && imsg ? imsgReplier(imsg) : uiReplier(),
  attachmentWaitMs: config.attachmentWaitMs,
  chatWaitMs: config.chatWaitMs,
  now: Date.now,
  log,
});

const server = Bun.serve({
  port: config.port,
  // Photos and their text are for the backend on this Mac, never the internet.
  hostname: process.env.CLIENT_HOST || "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true, groups: gate.enabledGroups().length });
    return (await images.handle(url)) ?? (await devHub?.handle(req, url)) ?? new Response("not found", { status: 404 });
  },
});

let running = true;
async function every(name: string, ms: number, fn: () => Promise<void>) {
  let down = false;
  while (running) {
    try {
      await fn();
      if (down) log(`[${name}] backend is back`);
      down = false;
    } catch (err) {
      // The backend restarting (every deploy) is one line, not a stack every 500ms.
      if (err instanceof HubUnavailable) {
        if (!down) log(`[${name}] waiting for the backend: ${err.message}`);
        down = true;
      } else log(`[${name}] ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
    await Bun.sleep(ms);
  }
}

// The hub may not be up yet (the backend starts alongside): the roster loop tries again.
await bridge.syncRosters().catch((err) => log(`[roster] ${err instanceof Error ? err.message : err}`));
const loops = [
  every("poll", config.pollMs, () => bridge.poll()),
  every("outbox", config.outboxMs, () => bridge.drainOutbox()),
  every("roster", config.rosterMs, () => bridge.syncRosters()),
  every("images", 3_600_000, async () => images.gc()),
];

log(
  `Tab bridge up. Sending via ${config.sendVia}, tapbacks ${config.tapbackMode}, replies ${config.replyMode}, serving images on ${config.imageBaseUrl}.`,
);
log(
  gate.enabledGroups().length
    ? `Active in: ${gate.enabledGroups().join(", ")}`
    : config.autoJoin
      ? "Not in any group yet. Add Tab to a group chat and it switches on by itself (AUTO_JOIN)."
      : `Not active in any group yet. Text "${config.commandPrefix} on" into a group from Tab's phone.`,
);

async function shutdown() {
  if (!running) return;
  running = false;
  log("Shutting down…");
  await Promise.race([Promise.all(loops), Bun.sleep(5_000)]);
  server.stop();
  await sender.stop();
  imsg?.stop();
  state.save();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
