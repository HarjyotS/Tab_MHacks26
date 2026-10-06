'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'
import { REF_COOKIE, REF_COOKIE_MAX_AGE } from '@/lib/waitlist/referral-config'

/**
 * On /i/<code>: remembers a real invite in a first-party cookie for 30 days, so
 * a sign-up after browsing to another page is still credited, and reports the
 * view. Only the code is stored, never anything about the person who sent it.
 */
export function InviteBeacon({ code }: { code: string | null }) {
  useEffect(() => {
    if (code) {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${REF_COOKIE}=${code}; Max-Age=${REF_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`
    }
    track('invite_page_viewed', { valid: !!code })
  }, [code])
  return null
}
