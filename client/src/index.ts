import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Bridge } from "./bridge.ts";
import { ChatDb } from "./chatdb.ts";
import { config } from "./config.ts";
import { Gate } from "./gate.ts";
import { DevHub, type Hub } from "./hub.ts";
import { ImageStore } from "./images.ts";
import { osascriptSender, spectrumSender } from "./sender.ts";
import { spacetimeHub } from "./spacetime-hub.ts";
import { State } from "./state.ts";
import { uiTapbacker } from "./tapback.ts";

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
} else if (config.hub === "dev") {
  devHub = new DevHub(config.echo, log);
  hub = devHub;
} else {
  console.error(`Unknown HUB=${config.hub}. Use dev or spacetime.`);
  process.exit(1);
}

const sender = config.sendVia === "osascript" ? osascriptSender() : await spectrumSender();
const images = new ImageStore(config.imageDir, config.imageBaseUrl, config.imageMaxAgeMs);

const tapbacker = config.tapbacks ? uiTapbacker() : null;

const bridge = new Bridge(db, hub, sender, tapbacker, images, gate, state, {
  commandPrefix: config.commandPrefix,
  tabName: config.tabName,
  tabPhone: config.tabPhone,
  sendMatchTimeoutMs: config.sendMatchTimeoutMs,
  tapbackVerifyMs: config.tapbackVerifyMs,
  attachmentWaitMs: config.attachmentWaitMs,
  chatWaitMs: config.chatWaitMs,
  now: Date.now,
  log,
});

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true, groups: gate.enabledGroups().length });
    return (await images.handle(url)) ?? (await devHub?.handle(req, url)) ?? new Response("not found", { status: 404 });
  },
});

let running = true;
async function every(name: string, ms: number, fn: () => Promise<void>) {
  while (running) {
    try {
      await fn();
    } catch (err) {
      log(`[${name}] ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
    await Bun.sleep(ms);
  }
}

await bridge.syncRosters();
const loops = [
  every("poll", config.pollMs, () => bridge.poll()),
  every("outbox", config.outboxMs, () => bridge.drainOutbox()),
  every("roster", config.rosterMs, () => bridge.syncRosters()),
  every("images", 3_600_000, async () => images.gc()),
];

log(
  `Tab bridge up. Sending via ${config.sendVia}, tapbacks ${tapbacker ? "on" : "off"}, serving images on ${config.imageBaseUrl}.`,
);
log(
  gate.enabledGroups().length
    ? `Active in: ${gate.enabledGroups().join(", ")}`
    : `Not active in any group yet. Text "${config.commandPrefix} on" into a group from Tab's phone.`,
);

async function shutdown() {
  if (!running) return;
  running = false;
  log("Shutting down…");
  await Promise.race([Promise.all(loops), Bun.sleep(5_000)]);
  server.stop();
  await sender.stop();
  state.save();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
