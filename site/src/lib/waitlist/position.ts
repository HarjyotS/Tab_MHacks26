// Real waitlist positions, computed from the actual rows. Nothing here is
// simulated or padded: `total` is the row count and `position` is a rank.
//
// Score = join order (1-based, by created_at) minus referral_count x
// SPOTS_PER_REFERRAL, clamped at 1. Rows are ranked by score, ties going to
// whoever joined first, so positions run 1..total with no gaps or repeats.
//
// The ranking is one Scan of phone, created_at and referral_count, cached in
// memory for CACHE_MS per server instance. Fine for a few thousand rows; past
// that, move it to a counter or a sorted index (see README).

import { SPOTS_PER_REFERRAL, inviteUrl, type WaitlistSpot } from './referral-config'
import type { WaitlistStore } from './store'
import type { RankingRow } from './types'

const CACHE_MS = 30_000

export type Ranked = { position: number; referralCount: number }
export type Ranking = { byPhone: Map<string, Ranked>; total: number; at: number }

export function rank(rows: RankingRow[], spotsPerReferral = SPOTS_PER_REFERRAL): Map<string, Ranked> {
  const byJoin = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.phone.localeCompare(b.phone))
  const scored = byJoin.map((r, i) => {
    const referralCount = Math.max(0, Math.floor(r.referralCount) || 0)
    return { phone: r.phone, order: i, referralCount, score: Math.max(1, i + 1 - referralCount * spotsPerReferral) }
  })
  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  const out = new Map<string, Ranked>()
  scored.forEach((r, i) => out.set(r.phone, { position: i + 1, referralCount: r.referralCount }))
  return out
}

// Kept on globalThis so dev hot reloads share it with the in-memory store.
const g = globalThis as unknown as { __tabRanking?: Ranking | null }

/** Drops this instance's cached ranking. Called after any write that changes it. */
export function invalidateRanking() {
  g.__tabRanking = null
}

/**
 * The cached ranking, rescanned when it is older than CACHE_MS or doesn't yet
 * include `mustInclude` (someone who just signed up must see their own spot).
 */
export async function getRanking(store: WaitlistStore, mustInclude?: string): Promise<Ranking> {
  const cached = g.__tabRanking
  if (cached && Date.now() - cached.at < CACHE_MS && (!mustInclude || cached.byPhone.has(mustInclude))) return cached
  const rows = await store.rankingRows()
  const fresh: Ranking = { byPhone: rank(rows), total: rows.length, at: Date.now() }
  g.__tabRanking = fresh
  return fresh
}

/** The result card's numbers for one row, or null if the row isn't on the list. */
export async function spotFor(store: WaitlistStore, phoneE164: string, refCode: string): Promise<WaitlistSpot | null> {
  const ranking = await getRanking(store, phoneE164)
  const me = ranking.byPhone.get(phoneE164)
  if (!me) return null
  return { refCode, inviteUrl: inviteUrl(refCode), position: me.position, total: ranking.total, referralCount: me.referralCount }
}
