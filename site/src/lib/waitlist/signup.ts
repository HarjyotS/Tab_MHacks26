// The sign-up itself, with referral credit and the person's real spot. Kept
// free of Next.js APIs so the server action stays a thin wrapper around it.

import { invalidateRanking, spotFor } from './position'
import type { WaitlistSpot } from './referral-config'
import type { WaitlistStore } from './store'
import type { NewSignup, SignupRow } from './types'

export type SignupOutcome = {
  inserted: boolean
  row: SignupRow | null
  /** A new sign-up that was credited to a real referrer. */
  referred: boolean
  /** Null only if the spot couldn't be worked out; the sign-up itself still stands. */
  spot: WaitlistSpot | null
}

/**
 * Credit only goes to a code that belongs to a real row, never to the same
 * number, and only when this sign-up is new: duplicates change nothing.
 */
export async function registerSignup(store: WaitlistStore, signup: Omit<NewSignup, 'referredBy'>, inviteCode: string | null): Promise<SignupOutcome> {
  let referrerPhone: string | null = null
  if (inviteCode) {
    try {
      const owner = await store.phoneForRefCode(inviteCode)
      if (owner && owner !== signup.phoneE164) referrerPhone = owner
    } catch (err) {
      console.warn('[waitlist] Could not look up an invite code; signing up without referral credit.', err)
    }
  }

  const { inserted, row } = await store.insertSignup({ ...signup, referredBy: referrerPhone ? inviteCode : null })
  const referred = inserted && referrerPhone !== null
  if (referred) {
    try {
      await store.addReferral(referrerPhone!)
    } catch (err) {
      console.error('[waitlist] Could not add the referral to the referrer', err)
    }
  }
  if (inserted) invalidateRanking()

  let spot: WaitlistSpot | null = null
  try {
    // An older row (from before referrals) gets its code here, the first time it's looked up.
    const code = row ? row.refCode : await store.ensureRefCode(signup.phoneE164)
    if (code) spot = await spotFor(store, signup.phoneE164, code)
  } catch (err) {
    console.error('[waitlist] Could not work out the waitlist spot', err)
  }
  return { inserted, row, referred, spot }
}

/** The spot behind an invite code, for /w/<code>. The phone number stays on the server. */
export async function spotForRefCode(store: WaitlistStore, code: string): Promise<WaitlistSpot | null> {
  const phone = await store.phoneForRefCode(code)
  if (!phone) return null
  return spotFor(store, phone, code)
}

/** Whether an invite code belongs to a real row. Lookup failures count as "no". */
export async function isRealRefCode(store: WaitlistStore, code: string): Promise<boolean> {
  try {
    return (await store.phoneForRefCode(code)) !== null
  } catch (err) {
    console.warn('[waitlist] Could not check an invite code', err)
    return false
  }
}
