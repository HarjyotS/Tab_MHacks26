'use server'

import { createHmac, randomUUID } from 'node:crypto'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { CONSENT_TEXT, CONSENT_VERSION, ERRORS } from '@/lib/waitlist/consent'
import { getWaitlistConfig } from '@/lib/waitlist/env'
import { normalizePhone } from '@/lib/waitlist/phone'
import { getStore } from '@/lib/waitlist/store'
import { recordAttempt } from '@/lib/waitlist/rate-limit'
import { verifyTurnstile } from '@/lib/waitlist/turnstile'
import { notifyWaitlistSignup } from '@/lib/waitlist/notify'

export type WaitlistResult =
  | { status: 'idle' }
  | { status: 'success'; display: string; duplicate: boolean }
  | { status: 'error'; code: 'phone' | 'consent' | 'captcha' | 'rate_limited' | 'unavailable'; message: string }

/** Attempts allowed per hashed IP in a rolling window (per server instance, see rate-limit.ts). */
const RATE_LIMIT = { max: 8, windowMinutes: 60 }

function field(form: FormData, name: string, max = 512): string | null {
  const v = form.get(name)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function clientIp(h: Headers): string {
  const fwd = h.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'unknown'
}

export async function joinWaitlist(_prev: WaitlistResult, form: FormData): Promise<WaitlistResult> {
  const config = getWaitlistConfig()
  if (!config.ok) return { status: 'error', code: 'unavailable', message: ERRORS.unavailable }
  const { dynamo, turnstileSecret, ipHashSecret } = config.config

  const h = await headers()
  // Only a keyed hash of the IP is kept, never the IP itself.
  const ipHash = createHmac('sha256', ipHashSecret).update(clientIp(h)).digest('hex')
  const store = getStore(dynamo)

  try {
    const attempts = recordAttempt(ipHash, RATE_LIMIT.windowMinutes)
    if (attempts > RATE_LIMIT.max) {
      return { status: 'error', code: 'rate_limited', message: ERRORS.rateLimited }
    }

    const rawPhone = field(form, 'phone', 40) ?? ''
    const phone = normalizePhone(rawPhone)
    if (!phone.ok) {
      return { status: 'error', code: 'phone', message: phone.international ? ERRORS.phoneIntl : ERRORS.phone }
    }
    if (form.get('consent') !== 'on') {
      return { status: 'error', code: 'consent', message: ERRORS.consent }
    }

    if (turnstileSecret) {
      const token = field(form, 'cf-turnstile-response', 2048) ?? ''
      const check = await verifyTurnstile(token, turnstileSecret, randomUUID())
      if (!check.ok) {
        console.warn('[waitlist] Turnstile rejected a sign-up', check.codes)
        return { status: 'error', code: 'captcha', message: ERRORS.captcha }
      }
    }
    // No secret: getWaitlistConfig() already warned that the bot check is off.

    const { inserted, row } = await store.insertSignup({
      phoneE164: phone.e164,
      consentText: CONSENT_TEXT,
      consentVersion: CONSENT_VERSION,
      consentAt: new Date(),
      ipHash,
      userAgent: h.get('user-agent')?.slice(0, 512) ?? null,
      referrer: field(form, 'referrer', 1024),
      utmSource: field(form, 'utm_source', 200),
      utmMedium: field(form, 'utm_medium', 200),
      utmCampaign: field(form, 'utm_campaign', 200),
      utmTerm: field(form, 'utm_term', 200),
      utmContent: field(form, 'utm_content', 200),
      signupLocation: field(form, 'location', 32),
    })

    if (inserted && row) {
      // Runs after the response is sent, so the person never waits on it.
      after(async () => {
        const outcome = await notifyWaitlistSignup(row)
        if (outcome === 'sent') await store.markNotified(row.phoneE164).catch((err) => console.error('[waitlist] markNotified failed', err))
      })
    }

    return { status: 'success', display: phone.display, duplicate: !inserted }
  } catch (err) {
    console.error('[waitlist] Sign-up failed', err)
    return { status: 'error', code: 'unavailable', message: ERRORS.unavailable }
  }
}
