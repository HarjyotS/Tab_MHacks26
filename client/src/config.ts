import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Bun loads client/.env automatically. See .env.example for what each one does.
const env = process.env;
const port = Number(env.CLIENT_PORT ?? 8787);
const stateDir = resolve(env.STATE_DIR ?? ".state");
const hours = (value: string | undefined, fallback: number) => Number(value ?? fallback) * 3_600_000;

export const config = {
  chatDbPath: env.CHAT_DB_PATH ?? join(homedir(), "Library", "Messages", "chat.db"),
  tabPhone: env.TAB_PHONE || undefined,
  tabName: env.TAB_NAME ?? "Tab",
  /** Comma-separated group chat guids to switch on at startup, in addition to "/tab on". */
  groupIds: (env.TAB_GROUP_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  commandPrefix: env.TAB_COMMAND ?? "/tab",
  dmReplyWindowMs: hours(env.DM_REPLY_WINDOW_HOURS, 72),
  // Fails closed: off / false / 0 / no (any case) all turn DM reading off.
  readDms: !/^(off|false|0|no)$/i.test(env.READ_DMS?.trim() ?? ""),
  sendVia: env.SEND_VIA === "osascript" ? "osascript" : "spectrum",
  tapbacks: env.TAPBACK_MODE !== "off",
  replies: env.REPLY_MODE !== "off",
  hub: env.HUB ?? "dev",
  spacetime: {
    uri: env.SPACETIME_HOST ?? "http://127.0.0.1:3000",
    database: env.SPACETIME_DB ?? "tab-local",
    /** Optional fixed token; otherwise the client keeps its own in .state/spacetime-token. */
    token: env.SPACETIME_CLIENT_TOKEN || undefined,
  },
  timezone: env.GROUP_TIMEZONE ?? "America/Detroit",
  echo: env.ECHO !== "0",
  port,
  imageBaseUrl: (env.IMAGE_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  imageMaxAgeMs: hours(env.IMAGE_MAX_AGE_HOURS, 48),
  statePath: join(stateDir, "state.json"),
  imageDir: join(stateDir, "images"),
  pollMs: 500,
  rosterMs: 10_000,
  outboxMs: 500,
  sendMatchTimeoutMs: 15_000,
  tapbackVerifyMs: 8_000,
  attachmentWaitMs: 60_000,
  chatWaitMs: 10_000,
} as const;
