'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { adminAccess, canSeeAdmin } from '@/lib/admin/auth'
import { getWaitlistConfig } from '@/lib/waitlist/env'
import { invalidateRanking } from '@/lib/waitlist/position'
import { getStore } from '@/lib/waitlist/store'

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string }

/** Deletes at most this many rows per click, so a stray request can't wipe the table. */
const MAX_PER_CALL = 200
const E164 = /^\+[1-9]\d{6,14}$/

/**
 * Deletes waitlist rows by phone number. Admin only: the credentials are checked
 * here too, not just in the proxy. When a deleted row joined with someone's
 * invite, that person's referral credit is taken back so positions stay real.
 */
export async function deleteSignups(phones: string[]): Promise<DeleteResult> {
  const access = adminAccess((await headers()).get('authorization'))
  if (!canSeeAdmin(access)) return { ok: false, error: 'Not signed in.' }

  const list = [...new Set(Array.isArray(phones) ? phones : [])].filter((p) => typeof p === 'string' && E164.test(p))
  if (!list.length) return { ok: false, error: 'Nothing selected.' }
  if (list.length > MAX_PER_CALL) return { ok: false, error: `Delete at most ${MAX_PER_CALL} at a time.` }

  const config = getWaitlistConfig()
  if (!config.ok) return { ok: false, error: 'Waitlist storage is misconfigured.' }
  const store = getStore(config.config.dynamo)

  let deleted = 0
  try {
    for (const phone of list) {
      const res = await store.deleteSignup(phone)
      if (!res.deleted) continue
      deleted++
      if (res.referredBy) {
        const referrer = await store.phoneForRefCode(res.referredBy)
        if (referrer) await store.removeReferral(referrer)
      }
    }
  } catch (err) {
    // Never log the numbers themselves.
    console.error('[admin] Delete failed', err instanceof Error ? err.name + ': ' + err.message : err)
    return { ok: false, error: deleted ? `Deleted ${deleted}, then hit an error. Refresh and try again.` : 'Delete failed. Check the function logs.' }
  } finally {
    invalidateRanking()
    revalidatePath('/admin')
  }
  console.info(`[admin] Deleted ${deleted} waitlist row(s)`)
  return { ok: true, deleted }
}
