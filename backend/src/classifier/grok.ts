import { z } from "zod";
import { TEXT_INTENTS } from "./intents.js";
import { renderInput, systemPrompt } from "./prompt.js";
import { structuredCall, type ChatClient } from "../grok/structured.js";
import type { Example } from "./dataset.js";
import type { ClassifyInput, ClassifyResult } from "./types.js";

const resultSchema = z.object({
  reason: z.string(),
  intent: z.enum(TEXT_INTENTS),
  confidence: z.number().min(0).max(1),
});

const JSON_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    intent: { type: "string", enum: [...TEXT_INTENTS] },
    confidence: { type: "number" },
  },
  required: ["reason", "intent", "confidence"],
  additionalProperties: false,
};

export type Classifier = (input: ClassifyInput) => Promise<ClassifyResult>;

export function createGrokClassifier(opts: {
  client: ChatClient;
  model: string;
  fewshots: Example[];
}): Classifier {
  const system = systemPrompt(opts.fewshots);
  return (input) =>
    structuredCall({
      client: opts.client,
      model: opts.model,
      system,
      user: renderInput(input),
      name: "classification",
      schema: JSON_SCHEMA,
      safeParse: (v) => resultSchema.safeParse(v),
    });
}
