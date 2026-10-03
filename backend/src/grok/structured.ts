import OpenAI from "openai";

export class GrokOutputError extends Error {}

// The subset of the OpenAI client we use, so tests can pass a fake.
export type ChatClient = {
  chat: { completions: { create: OpenAI["chat"]["completions"]["create"] } };
};

export function createXaiClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL, timeout: 15_000, maxRetries: 2 });
}

type SafeParse<T> = (
  v: unknown,
) =>
  { success: true; data: T } | { success: false; error: { message: string } };

// One structured-output call against a JSON schema, validated with zod.
// SPEC §9.1: retry once on malformed output, then throw so the caller can
// fall back to a clarifying question instead of acting on bad data.
export async function structuredCall<T>(opts: {
  client: ChatClient;
  model: string;
  system: string;
  user: string;
  name: string;
  schema: Record<string, unknown>;
  safeParse: SafeParse<T>;
}): Promise<T> {
  const attempt = async (): Promise<T> => {
    const res = await opts.client.chat.completions.create({
      model: opts.model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.name, strict: true, schema: opts.schema },
      },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    });
    const content = res.choices[0]?.message.content;
    if (!content) throw new GrokOutputError(`${opts.name}: empty response`);
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new GrokOutputError(
        `${opts.name}: invalid JSON: ${content.slice(0, 200)}`,
      );
    }
    const parsed = opts.safeParse(json);
    if (!parsed.success) {
      throw new GrokOutputError(
        `${opts.name}: schema mismatch: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  };

  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof GrokOutputError)) throw err;
    return attempt();
  }
}
