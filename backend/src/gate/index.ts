// The backend's entry to the classifier gate (SPEC §6.3, M6). Jev when
// TYPESAFE_API_KEY is set, otherwise the keyword stub; both come from
// @tab/gate with the same signature, so nothing else changes on a swap.
// Jev sits behind the free pre-filter unless GATE_PREFILTER is off.
import {
  jevClassifier,
  prefilterEnabled,
  stubClassifier,
  withPrefilter,
  type Classify,
  type ClassifyInput,
  type Intent,
} from "@tab/gate";
import { decide, type Decision } from "./decide.js";

export const TAB_MEMBER = { phone: "tab", name: "Tab" } as const;

// A hung Jev request would stall the processing loop (§11.1), so every call
// gets a deadline; a timeout throws and the message is marked `error`.
export const JEV_TIMEOUT_MS = 10_000;

export function createClassify(
  env: { TYPESAFE_API_KEY?: string; GATE_PREFILTER?: string } = process.env,
): {
  classify: Classify;
  kind: "jev" | "stub";
  prefilter: boolean;
} {
  const apiKey = env.TYPESAFE_API_KEY;
  // The stub is free, so only Jev gets the pre-filter in front of it.
  if (!apiKey) return { classify: stubClassifier, kind: "stub", prefilter: false };
  const timedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(JEV_TIMEOUT_MS) });
  const jev = jevClassifier({ apiKey, fetch: timedFetch });
  // Off sends every message to Jev, as before the pre-filter existed.
  const prefilter = prefilterEnabled(env.GATE_PREFILTER);
  return { classify: prefilter ? withPrefilter(jev) : jev, kind: "jev", prefilter };
}

// Tab's own messages appear in context with sender_phone "tab"; listing Tab
// as a member lets the gate show them as "Tab" rather than an unknown number.
export function withTab(input: ClassifyInput): ClassifyInput {
  if (input.members.some((m) => m.phone === TAB_MEMBER.phone)) return input;
  return { ...input, members: [TAB_MEMBER, ...input.members] };
}

export type Routed = { intent: Intent; confidence: number; decision: Decision };

// Classify, then apply the §6.4 thresholds and the approval check.
export async function route(
  classify: Classify,
  input: ClassifyInput,
): Promise<Routed> {
  const full = withTab(input);
  const result = await classify(full);
  return { ...result, decision: decide(result, full) };
}
