// Runs Grok vision's photo description (§7.4) on local images or URLs, with
// no database. Prints what the gate would see and how long each call took.
//   npx tsx scripts/describe.ts receipt.jpg meme.png [--caption "dinner, i paid"]
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { grokConfig } from "../src/config.js";
import { createXaiClient } from "../src/grok/structured.js";
import { describeImage } from "../src/extraction/describe.js";
import { imageAsDataUrl } from "../src/extraction/image.js";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

const { values, positionals } = parseArgs({ allowPositionals: true, options: { caption: { type: "string" } } });
if (positionals.length === 0) throw new Error("usage: describe.ts <image file or URL>... [--caption text]");

const grok = grokConfig();
const xai = createXaiClient(grok.apiKey, grok.baseURL);

for (const source of positionals) {
  const image = /^(https?|data):/.test(source)
    ? await imageAsDataUrl(source)
    : `data:${TYPES[extname(source).toLowerCase()] ?? "image/jpeg"};base64,${readFileSync(source).toString("base64")}`;
  const started = performance.now();
  const note = await describeImage(xai, grok.model, image, values.caption);
  console.log(JSON.stringify({ source, ms: Math.round(performance.now() - started), ...note }, null, 2));
}
