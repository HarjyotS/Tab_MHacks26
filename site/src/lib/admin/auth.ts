// HTTP Basic auth for the internal /admin pages, checked in src/proxy.ts and
// again in the page and the CSV route (so a proxy misconfiguration can never
// expose data). Never open by default: with ADMIN_USER or ADMIN_PASSWORD unset,
// /admin is a 404 everywhere except `next dev`, where it opens with a warning.

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * - `ok`: valid credentials.
 * - `open-dev`: ADMIN_* unset under `next dev` only. Shown with a warning.
 * - `unauthorized`: credentials are configured and the request's are missing or wrong (401).
 * - `disabled`: ADMIN_* unset outside local dev (404).
 */
export type AdminAccess = 'ok' | 'open-dev' | 'unauthorized' | 'disabled'

export const ADMIN_REALM = 'Tab admin'

/** Headers every /admin response carries, including 401s and 404s. */
export const ADMIN_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store, private',
}

function isLocalDev(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production'
}

/** Equal-time comparison: both sides are hashed first, so length differences don't leak either. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

let warned = false

export function adminAccess(authorization: string | null | undefined): AdminAccess {
  const user = process.env.ADMIN_USER || ''
  const password = process.env.ADMIN_PASSWORD || ''
  if (!user || !password) {
    if (!isLocalDev()) return 'disabled'
    if (!warned) {
      warned = true
      console.warn(
        '[admin] WARNING: ADMIN_USER / ADMIN_PASSWORD are not set. /admin is OPEN with no password because this is `next dev`. ' +
          'Outside local dev it returns 404 until both are set.',
      )
    }
    return 'open-dev'
  }

  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization ?? '')
  if (!match) return 'unauthorized'
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return 'unauthorized'
  // Both halves are always compared (no short circuit), so timing doesn't say which one was wrong.
  const userOk = sameSecret(decoded.slice(0, colon), user)
  const passwordOk = sameSecret(decoded.slice(colon + 1), password)
  return userOk && passwordOk ? 'ok' : 'unauthorized'
}

export function canSeeAdmin(access: AdminAccess): boolean {
  return access === 'ok' || access === 'open-dev'
}
