import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

// SPEC §6.4 and §11.3 [DEFAULT] values. Keep every tunable here.
export const thresholds = {
  act: 0.85,
  clarify: 0.5,
} as const;

export const LARGE_AMOUNT_CENTS = 100_000;
export const CONTEXT_MESSAGES = 10;
export const LOPSIDED_FACTOR = 1.5;
export const MAX_DMS_PER_EXPENSE = 3;
export const GROUP_TIMEZONE = "America/Detroit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// SPEC §11.3 durations, in milliseconds, before DEMO_MODE scaling.
const BASE_DURATIONS = {
  OBJECTION_WINDOW: 3 * HOUR,
  OBJECTION_REMINDER_BEFORE: 1 * HOUR,
  OBJECTION_EXTENSION: 1 * HOUR,
  CLAIM_DEADLINE: 48 * HOUR,
  FOLLOWUP_DM1_AFTER: 2 * HOUR,
  // Claim nudges (SPEC names kept; they now go in the group chat). SPEC
  // says 10:00 the next morning for the second; quiet hours push it there.
  FOLLOWUP_DM2_AFTER: 12 * HOUR,
  FOLLOWUP_DM3_AFTER: 44 * HOUR,
  // How long Tab waits for an answer to one of its questions. People type
  // at the same speed in a demo, so DEMO_MODE leaves this one unscaled.
  PENDING_QUESTION_TTL: 2 * HOUR,
};

const UNSCALED: ReadonlySet<keyof typeof BASE_DURATIONS> = new Set(["PENDING_QUESTION_TTL"]);

export type Durations = typeof BASE_DURATIONS;

export type Timing = {
  demo: boolean;
  durations: Durations;
  // SPEC §11.3 QUIET_HOURS 23:00 to 09:00; off in DEMO_MODE.
  quietHours: { start: number; end: number } | null;
  schedulerIntervalMs: number;
};

export function timing(
  env: { DEMO_MODE?: string; DEMO_TIME_SCALE?: string } = process.env,
): Timing {
  const demo = env.DEMO_MODE === "true";
  const scale = demo ? Number(env.DEMO_TIME_SCALE || 360) : 1;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error(
      `DEMO_TIME_SCALE must be a positive number, got ${env.DEMO_TIME_SCALE}`,
    );
  const durations = Object.fromEntries(
    Object.entries(BASE_DURATIONS).map(([k, v]) => [
      k,
      UNSCALED.has(k as keyof Durations) ? v : Math.round(v / scale),
    ]),
  ) as Durations;
  return {
    demo,
    durations,
    quietHours: demo ? null : { start: 23, end: 9 },
    // SPEC: 30 seconds; DEMO_MODE needs a faster tick to show 30-second windows.
    schedulerIntervalMs: demo ? 2_000 : 30_000,
  };
}

export function grokConfig() {
  return {
    apiKey: required("XAI_API_KEY"),
    baseURL: "https://api.x.ai/v1",
    model: process.env.GROK_MODEL || "grok-4.20-0309-non-reasoning",
  };
}

// SPEC §12.3 web ledger links: where the ledger is hosted, and the key that
// derives each group's link secret. Both optional: without them Tab posts
// no link. Validated here so a typo fails at startup, not mid-chat.
export type LedgerConfig = { baseUrl: string; key: string };

export function ledgerConfig(
  env: { LEDGER_BASE_URL?: string; LEDGER_LINK_KEY?: string } = process.env,
): LedgerConfig | undefined {
  const baseUrl = env.LEDGER_BASE_URL?.trim();
  const key = env.LEDGER_LINK_KEY?.trim();
  if (!baseUrl && !key) return undefined;
  if (!baseUrl || !URL.canParse(baseUrl))
    throw new Error(`LEDGER_BASE_URL must be a URL when LEDGER_LINK_KEY is set, got ${JSON.stringify(baseUrl ?? "")}`);
  if (!key || key.length < 32)
    throw new Error("LEDGER_LINK_KEY must be at least 32 characters when LEDGER_BASE_URL is set");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}
