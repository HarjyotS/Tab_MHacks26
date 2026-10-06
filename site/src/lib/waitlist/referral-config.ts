// Referral settings and helpers that are safe on both server and client.
// Every number the waitlist shows is computed from real rows (see position.ts).

import { SITE_URL } from '../site'

/** Places a person moves up for each friend who joins with their link. */
export const SPOTS_PER_REFERRAL = 5

/** The beta opens to this many groups first. */
export const BETA_GROUP_LIMIT = 20

/** "N people are waiting" only shows from this many sign-ups, so a tiny list doesn't look empty. */
export const SHOW_TOTAL_FROM = 25

/** Lowercase letters and digits with the look-alikes (0, o, 1, i, l) removed. URL-safe. */
export const REF_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const REF_CODE_LENGTH = 8

/** First-party cookie that remembers an invite for 30 days, so the credit survives navigation. */
export const REF_COOKIE = 'tab_ref'
export const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const REF_CODE_RE = new RegExp(`^[${REF_CODE_ALPHABET}]{${REF_CODE_LENGTH}}$`)

/** Normalizes a code from a URL, form or cookie, or returns null if it can't be one. */
export function cleanRefCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toLowerCase()
  return REF_CODE_RE.test(code) ? code : null
}

export function inviteUrl(code: string): string {
  return `${SITE_URL}/i/${code}`
}

export function spotUrl(code: string): string {
  return `${SITE_URL}/w/${code}`
}

export const INVITE_TITLE = 'Join me on the Tab waitlist'
export const INVITE_TEXT = 'Join me on the Tab waitlist. It keeps the tab in our group chat so nobody has to.'

/** Coarse position bucket for analytics, so exact positions are never sent. */
export function positionBucket(position: number): string {
  if (position <= 10) return '1-10'
  if (position <= 25) return '11-25'
  if (position <= 50) return '26-50'
  if (position <= 100) return '51-100'
  if (position <= 500) return '101-500'
  return '500+'
}

/** What the result card needs. Never includes a phone number. */
export type WaitlistSpot = {
  refCode: string
  inviteUrl: string
  /** 1-based, from the real ranking. */
  position: number
  /** Real number of rows on the list. */
  total: number
  /** Friends who joined with this person's link. */
  referralCount: number
}
