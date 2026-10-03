import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN = /^\/img\/([a-f0-9]{32})\.jpg$/;

/**
 * Makes receipt photos fetchable by the backend (SPEC 10: at least 24 hours).
 * Each image is converted to a JPEG (iPhones send HEIC), capped at 2048px on
 * the long edge, and served under an unguessable URL.
 */
export class ImageStore {
  constructor(
    private readonly dir: string,
    private readonly baseUrl: string,
    private readonly maxAgeMs: number,
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

  /** Serves GET /img/<token>.jpg; returns null for any other path. */
  async handle(url: URL): Promise<Response | null> {
    const match = url.pathname.match(TOKEN);
    if (!match) return null;
    const file = Bun.file(join(this.dir, `${match[1]}.jpg`));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "content-type": "image/jpeg" } });
  }

  gc(now = Date.now()): void {
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name);
      if (now - statSync(path).mtimeMs > this.maxAgeMs) unlinkSync(path);
    }
  }
}
