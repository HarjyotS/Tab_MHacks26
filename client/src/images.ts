import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readText as onDeviceText } from "./ocr.ts";

const TOKEN = /^\/img\/([a-f0-9]{32})\.(jpg|txt)$/;
const TEXT_CACHE = 200;

/**
 * Makes receipt photos fetchable by the backend (SPEC 10: at least 24 hours).
 * Each image is converted to a JPEG (iPhones send HEIC), capped at 2048px on
 * the long edge, and served under an unguessable URL.
 */
export class ImageStore {
  // What on-device text recognition read in each photo, kept in memory only.
  private texts = new Map<string, string>();

  constructor(
    private readonly dir: string,
    private readonly baseUrl: string,
    private readonly maxAgeMs: number,
    private readonly readText: (path: string) => Promise<string> = onDeviceText,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** Converts a chat.db attachment path and returns its public URL. */
  async publish(attachmentPath: string): Promise<string> {
    const src = attachmentPath.startsWith("~/") ? join(homedir(), attachmentPath.slice(2)) : attachmentPath;
    const token = crypto.randomUUID().replaceAll("-", "");
    const out = join(this.dir, `${token}.jpg`);
    const proc = Bun.spawn(["sips", "-s", "format", "jpeg", "-Z", "2048", src, "--out", out], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`sips failed on ${src}: ${stderr.trim()}`);
    return `${this.baseUrl}/img/${token}.jpg`;
  }

  /**
   * Serves GET /img/<token>.jpg, and GET /img/<token>.txt: the text in that
   * photo, read on this Mac (SPEC 19), so the backend can screen it before any
   * AI looks at the image. Returns null for any other path.
   */
  async handle(url: URL): Promise<Response | null> {
    const match = url.pathname.match(TOKEN);
    if (!match) return null;
    const path = join(this.dir, `${match[1]}.jpg`);
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    if (match[2] === "jpg") return new Response(file, { headers: { "content-type": "image/jpeg" } });
    let text = this.texts.get(match[1]!);
    if (text === undefined) {
      try {
        text = await this.readText(path);
      } catch {
        return new Response("text recognition failed", { status: 502 });
      }
      this.texts.set(match[1]!, text);
      if (this.texts.size > TEXT_CACHE) this.texts.delete(this.texts.keys().next().value!);
    }
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  gc(now = Date.now()): void {
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name);
      if (now - statSync(path).mtimeMs > this.maxAgeMs) {
        unlinkSync(path);
        this.texts.delete(name.replace(/\.jpg$/, ""));
      }
    }
  }
}
