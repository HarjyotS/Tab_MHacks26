import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageStore } from "../src/images.ts";
import { readText } from "../src/ocr.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

function store(read: (path: string) => Promise<string>) {
  const dir = mkdtempSync(join(tmpdir(), "tab-img-"));
  writeFileSync(join(dir, `${TOKEN}.jpg`), "not really a jpeg");
  return new ImageStore(dir, "http://127.0.0.1:1", 48 * 3_600_000, read);
}

test("serves a photo's on-device text next to the photo, read once", async () => {
  let reads = 0;
  const images = store(async () => {
    reads++;
    return "SUBTOTAL $38.95\nTOTAL $42.07";
  });
  const res = await images.handle(new URL(`http://x/img/${TOKEN}.txt`));
  expect(res!.status).toBe(200);
  expect(await res!.text()).toBe("SUBTOTAL $38.95\nTOTAL $42.07");
  await images.handle(new URL(`http://x/img/${TOKEN}.txt`));
  expect(reads).toBe(1);
  expect((await images.handle(new URL(`http://x/img/${TOKEN}.jpg`)))!.headers.get("content-type")).toBe("image/jpeg");
});

test("a photo it can't read, or one that's gone, isn't served", async () => {
  const images = store(async () => {
    throw new Error("vision failed");
  });
  expect((await images.handle(new URL(`http://x/img/${TOKEN}.txt`)))!.status).toBe(502);
  expect((await images.handle(new URL(`http://x/img/${"f".repeat(32)}.txt`)))!.status).toBe(404);
  expect(await images.handle(new URL("http://x/img/../secret.txt"))).toBeNull();
});

// Apple's Vision framework only exists on macOS.
test.skipIf(process.platform !== "darwin")("reads text on this Mac", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tab-ocr-"));
  const svg = join(dir, "r.svg");
  writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="white"/><text x="20" y="120" font-size="64" font-family="Helvetica">TOTAL $42.07</text></svg>`);
  const png = join(dir, "r.png");
  const conv = Bun.spawnSync(["sips", "-s", "format", "png", svg, "--out", png]);
  if (conv.exitCode !== 0) return; // no SVG support in sips here: nothing to read
  expect(await readText(png)).toContain("42.07");
});
