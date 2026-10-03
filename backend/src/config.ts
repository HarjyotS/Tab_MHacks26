import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

// SPEC §6.4 / §11.3 defaults. Tune from the eval calibration table.
export const thresholds = {
  act: 0.85,
  clarify: 0.5,
  approvalText: 0.9,
} as const;

export function grokConfig() {
  return {
    apiKey: required("XAI_API_KEY"),
    baseURL: "https://api.x.ai/v1",
    model: process.env.CLASSIFIER_MODEL || "grok-4.20-0309-non-reasoning",
  };
}
