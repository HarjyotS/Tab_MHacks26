// Per-IP-hash sign-up limiter, kept in memory. Each serverless instance has its
// own counts, so this slows down casual abuse rather than enforcing a hard
// global cap; Turnstile and the conditional write do the rest (see README).

const hits = new Map<string, number[]>()
let lastSweep = Date.now()

/** Records an attempt and returns how many this IP hash made in the window, including this one. */
export function recordAttempt(ipHash: string, windowMinutes: number): number {
  const now = Date.now()
  const since = now - windowMinutes * 60_000
  const list = (hits.get(ipHash) ?? []).filter((t) => t > since)
  list.push(now)
  hits.set(ipHash, list)
  if (now - lastSweep > 10 * 60_000) {
    lastSweep = now
    for (const [k, v] of hits) if (!v.some((t) => t > since)) hits.delete(k)
  }
  return list.length
}
