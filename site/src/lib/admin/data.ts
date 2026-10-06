// Server-only: loads the whole waitlist once and shapes it for /admin and its CSV.
// Positions come from position.ts's rank() over the same scan, so they are the
// real, current spots (not the 30 second cached ranking the public pages use).

import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { rank, type Ranked } from '../waitlist/position'
import type { WaitlistStore } from '../waitlist/store'
import type { ListedItem } from '../waitlist/types'
import { ADMIN_TZ, sourceOf, summarize, type Summary } from './stats'

export const TOP_REFERRERS = 25

export type AdminRow = {
  phone: string
  phoneFull: string
  phoneMasked: string
  position: number
  createdAt: string
  joined: string
  status: string
  referralCount: number
  refCode: string
  referredByCode: string
  /** The referrer's number when the code resolves to a row, else null (show the code). */
  referredByFull: string | null
  referredByMasked: string | null
  source: string
  consentVersion: string
}

export type AdminData = {
  summary: Summary
  rows: AdminRow[]
  topReferrers: AdminRow[]
  asOf: string
  asOfLabel: string
}

const joinedFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ADMIN_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const asOfFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ADMIN_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

function formatAt(fmt: Intl.DateTimeFormat, iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d)
}

/** "+1 415 555 2671" and "+1 •••-•••-2671" (or "+44 ••• 7700" outside +1). */
export function phoneLabels(e164: string): { full: string; masked: string } {
  const parsed = parsePhoneNumberFromString(e164)
  const last4 = e164.slice(-4)
  if (!parsed) return { full: e164, masked: `••• ${last4}` }
  const cc = parsed.countryCallingCode
  return {
    full: parsed.formatInternational(),
    masked: cc === '1' ? `+1 •••-•••-${last4}` : `+${cc} ••• ${last4}`,
  }
}

export function rankItems(items: ListedItem[]): Map<string, Ranked> {
  return rank(items.map((it) => ({ phone: it.phone, createdAt: it.created_at, referralCount: Number(it.referral_count ?? 0) || 0 })))
}

export async function loadAdminData(store: WaitlistStore, now = new Date()): Promise<AdminData> {
  const items = await store.listItems()
  const ranking = rankItems(items)
  const phoneByCode = new Map<string, string>()
  for (const it of items) if (it.ref_code) phoneByCode.set(it.ref_code, it.phone)

  const rows: AdminRow[] = items.map((it) => {
    const me = phoneLabels(it.phone)
    const referrerPhone = it.referred_by ? phoneByCode.get(it.referred_by) : undefined
    const ref = referrerPhone ? phoneLabels(referrerPhone) : null
    return {
      phone: it.phone,
      phoneFull: me.full,
      phoneMasked: me.masked,
      position: ranking.get(it.phone)?.position ?? 0,
      createdAt: it.created_at,
      joined: formatAt(joinedFmt, it.created_at),
      status: it.status,
      referralCount: ranking.get(it.phone)?.referralCount ?? 0,
      refCode: it.ref_code ?? '',
      referredByCode: it.referred_by ?? '',
      referredByFull: ref?.full ?? null,
      referredByMasked: ref?.masked ?? null,
      source: sourceOf(it),
      consentVersion: it.consent_version ?? '',
    }
  })
  rows.sort((a, b) => a.position - b.position)

  const topReferrers = rows
    .filter((r) => r.referralCount > 0)
    .sort((a, b) => b.referralCount - a.referralCount || a.position - b.position)
    .slice(0, TOP_REFERRERS)

  return { summary: summarize(items, now), rows, topReferrers, asOf: now.toISOString(), asOfLabel: asOfFmt.format(now) }
}
