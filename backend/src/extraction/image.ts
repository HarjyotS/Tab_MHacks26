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
