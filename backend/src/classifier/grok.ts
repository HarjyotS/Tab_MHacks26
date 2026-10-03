import OpenAI from "openai";
import { z } from "zod";
import { TEXT_INTENTS } from "./intents.js";
import { renderInput, systemPrompt } from "./prompt.js";
import type { Example } from "./dataset.js";
import type { ClassifyInput, ClassifyResult } from "./types.js";

const resultSchema = z.object({
  reason: z.string(),
  intent: z.enum(TEXT_INTENTS),
  confidence: z.number().min(0).max(1),
});

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "classification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        intent: { type: "string", enum: [...TEXT_INTENTS] },
        confidence: { type: "number" },
      },
      required: ["reason", "intent", "confidence"],
      additionalProperties: false,
    },
  },
} as const;

export class ClassifierOutputError extends Error {}

// The subset of the OpenAI client we use, so tests can pass a fake.
export type ChatClient = {
  chat: { completions: { create: OpenAI["chat"]["completions"]["create"] } };
};

export type Classifier = (input: ClassifyInput) => Promise<ClassifyResult>;

export function createGrokClassifier(opts: {
  client: ChatClient;
  model: string;
  fewshots: Example[];
}): Classifier {
  const system = systemPrompt(opts.fewshots);

  async function attempt(input: ClassifyInput): Promise<ClassifyResult> {
    const res = await opts.client.chat.completions.create({
      model: opts.model,
      temperature: 0,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: renderInput(input) },
      ],
    });
    const content = res.choices[0]?.message.content;
    if (!content) throw new ClassifierOutputError("empty response");
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new ClassifierOutputError(`invalid JSON: ${content.slice(0, 200)}`);
    }
    const parsed = resultSchema.safeParse(json);
    if (!parsed.success) {
      throw new ClassifierOutputError(
        `schema mismatch: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  // SPEC §9.1: retry once on malformed output, then fail loudly so the
  // backend marks the message `error` instead of silently dropping it.
  return async (input) => {
    try {
      return await attempt(input);
    } catch (err) {
      if (!(err instanceof ClassifierOutputError)) throw err;
      return attempt(input);
    }
  };
}

export function createXaiClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL, timeout: 15_000, maxRetries: 2 });
}
