// Turns the client's image_url (SPEC §10: fetchable by the backend for 24h)
// into a data: URL for Grok, so the client's host never needs to be public.
const SUPPORTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 15 * 1024 * 1024;

export class UnsupportedImageError extends Error {}

export async function imageAsDataUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok)
    throw new Error(
      `image fetch failed: HTTP ${res.status} for ${new URL(url).host}`,
    );
  const type = (res.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!SUPPORTED.has(type)) {
    // iPhones send HEIC; the client must convert (for example with `sips`) before hosting.
    throw new UnsupportedImageError(
      `unsupported image type "${type || "unknown"}"; expected JPEG, PNG, WebP, or GIF`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES)
    throw new UnsupportedImageError(
      `image is ${bytes.length} bytes, over the ${MAX_BYTES} limit`,
    );
  return `data:${type};base64,${bytes.toString("base64")}`;
}

// The last few images as data URLs, so the receipt read reuses the download
// the photo description just made instead of fetching it again (Joe's
// review on #41). In-flight fetches are shared; failures aren't kept, so a
// later call can try again. Bounded in count and age, memory only.
export class ImageCache {
  private entries = new Map<string, { at: number; data: Promise<string> }>();

  constructor(
    private readonly opts: { max?: number; ttlMs?: number; fetchImpl?: typeof fetch; now?: () => number } = {},
  ) {}

  get(url: string): Promise<string> {
    const now = (this.opts.now ?? Date.now)();
    const ttl = this.opts.ttlMs ?? 5 * 60_000;
    for (const [key, e] of this.entries) if (now - e.at > ttl) this.entries.delete(key);
    const hit = this.entries.get(url);
    if (hit) return hit.data;
    const data = imageAsDataUrl(url, this.opts.fetchImpl ?? fetch);
    this.entries.set(url, { at: now, data });
    data.catch(() => {
      if (this.entries.get(url)?.data === data) this.entries.delete(url);
    });
    while (this.entries.size > (this.opts.max ?? 4)) this.entries.delete(this.entries.keys().next().value!);
    return data;
  }
}
