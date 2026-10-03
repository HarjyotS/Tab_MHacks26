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
  approvalText: 0.9,
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
  // SPEC says 10:00 the next morning; quiet hours already push DMs there,
  // so this is the gap after DM1 before the second nudge.
  FOLLOWUP_DM2_AFTER: 12 * HOUR,
  GROUP_MENTION_AFTER: 40 * HOUR,
  FOLLOWUP_DM3_AFTER: 44 * HOUR,
  // How long Tab waits for an answer to one of its questions.
  PENDING_QUESTION_TTL: 2 * HOUR,
};

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
    Object.entries(BASE_DURATIONS).map(([k, v]) => [k, Math.round(v / scale)]),
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
