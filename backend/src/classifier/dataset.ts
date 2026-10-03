import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TEXT_INTENTS, type TextIntent } from "./intents.js";
import type { ClassifyInput } from "./types.js";

export type Split = "fewshot" | "eval" | "test";

export type Example = {
  id: string;
  input: ClassifyInput;
  expected: TextIntent;
  acceptable: TextIntent[];
  confidence_band: "high" | "medium";
  tags: string[];
  notes: string;
};

const intent = z.enum(TEXT_INTENTS);

const exampleSchema = z.object({
  id: z.string().min(1),
  input: z.object({
    chat: z.enum(["group", "dm"]),
    message: z.object({
      sender: z.string(),
      text: z.string().min(1),
      reply_to_tab_purpose: z.string().optional(),
    }),
    context: z.array(
      z.object({
        from: z.string(),
        text: z.string(),
        purpose: z.string().optional(),
      }),
    ),
    members: z.array(
      z.object({ phone: z.string(), name: z.string().optional() }),
    ),
    open_items: z.array(
      z.object({
        expense_id: z.string(),
        description: z.string(),
        expense_status: z.string(),
        my_share_status: z.string().optional(),
      }),
    ),
  }),
  expected: intent,
  acceptable: z.array(intent).min(1),
  confidence_band: z.enum(["high", "medium"]),
  tags: z.array(z.string()),
  notes: z.string(),
});

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/classifier",
);

export function loadSplit(split: Split): Example[] {
  const raw = readFileSync(join(FIXTURES_DIR, `${split}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const parsed = exampleSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(
          `${split}.jsonl line ${i + 1}: ${parsed.error.message}`,
        );
      }
      // The zod schema checks shape; the string enums come from our own builder.
      return parsed.data as Example;
    });
}
