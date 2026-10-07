// Pure counting for the admin page: no I/O, no Next.js, type-only imports.
// Days are calendar days in America/Detroit, so "today", the 7 and 30 day tiles
// and the chart's bars all agree with each other.

import type { ListedItem } from '../waitlist/types'

export const ADMIN_TZ = 'America/Detroit'
export const CHART_DAYS = 30

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: ADMIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'YYYY-MM-DD' in America/Detroit, or '' for a missing or bad timestamp. */
export function dayKey(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at
  return Number.isNaN(d.getTime()) ? '' : dayFmt.format(d)
}

/** The `n` day keys ending on `today` (inclusive), oldest first. DST-safe: steps whole calendar days. */
export function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i, 12)).toISOString().slice(0, 10))
  return out
}

/** Hostname of a referrer URL without `www.`, or null when there is none. */
export function referrerHost(referrer: string | undefined | null): string | null {
  const raw = (referrer ?? '').trim()
  if (!raw) return null
  try {
    return new URL(raw).hostname.replace(/^www\./, '') || null
  } catch {
    return raw.slice(0, 60)
  }
}

/** utm_source if set, else the referrer host, else ''. */
export function sourceOf(it: Pick<ListedItem, 'utm_source' | 'referrer'>): string {
  return it.utm_source?.trim() || referrerHost(it.referrer) || ''
}

/** Counts per value, biggest first, ties alphabetical. */
export function countBy(values: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export type Summary = {
  total: number
  today: number
  last7: number
  last30: number
  referred: number
  direct: number
  /** referred / total, 0..1 (0 for an empty list). */
  referralRate: number
  /** Sum of referral_count over every row. */
  credits: number
  pending: number
  confirmed: number
  optedOut: number
  /** Any other status value, so the status tiles always add up to the total. */
  otherStatus: number
  /** One entry per day for the last CHART_DAYS days, oldest first. */
  perDay: { day: string; count: number }[]
  utmSources: [string, number][]
  referrerHosts: [string, number][]
}

export function summarize(items: ListedItem[], now: Date): Summary {
  const days = lastDays(dayKey(now), CHART_DAYS)
  const perDayMap = new Map(days.map((d) => [d, 0]))
  const last7 = new Set(days.slice(-7))
  const today = days[days.length - 1]

  const s: Summary = {
    total: items.length,
    today: 0,
    last7: 0,
    last30: 0,
    referred: 0,
    direct: 0,
    referralRate: 0,
    credits: 0,
    pending: 0,
    confirmed: 0,
    optedOut: 0,
    otherStatus: 0,
    perDay: [],
    utmSources: [],
    referrerHosts: [],
  }

  for (const it of items) {
    const day = dayKey(it.created_at)
    if (perDayMap.has(day)) {
      perDayMap.set(day, perDayMap.get(day)! + 1)
      s.last30++
      if (last7.has(day)) s.last7++
      if (day === today) s.today++
    }
    if (it.referred_by) s.referred++
    else s.direct++
    s.credits += Math.max(0, Math.floor(Number(it.referral_count ?? 0)) || 0)
    if (it.status === 'pending_confirmation') s.pending++
    else if (it.status === 'confirmed') s.confirmed++
    else if (it.status === 'opted_out') s.optedOut++
    else s.otherStatus++
  }

  s.referralRate = s.total ? s.referred / s.total : 0
  s.perDay = days.map((day) => ({ day, count: perDayMap.get(day)! }))
  s.utmSources = countBy(items.map((it) => it.utm_source?.trim() || '(none)'))
  s.referrerHosts = countBy(items.map((it) => referrerHost(it.referrer) ?? '(no referrer)'))
  return s
}
