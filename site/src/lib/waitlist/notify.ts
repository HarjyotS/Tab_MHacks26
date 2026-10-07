import { createHmac } from 'node:crypto'
import type { SignupRow } from './types'

/**
 * The one hook Tab's messaging will plug into. Today it is a logged no-op:
 * nothing is texted at sign-up. When Tab's own line is live, set
 * TAB_SIGNUP_WEBHOOK_URL and TAB_SIGNUP_WEBHOOK_SECRET and every new sign-up
 * is POSTed there as signed JSON (contract in site/README.md).
 */
export async function notifyWaitlistSignup(row: SignupRow): Promise<'skipped' | 'sent' | 'failed'> {
  const url = process.env.TAB_SIGNUP_WEBHOOK_URL
  if (!url) {
    console.info(`[waitlist] notifyWaitlistSignup: no TAB_SIGNUP_WEBHOOK_URL, skipping (signup ${row.id}, status ${row.status}).`)
    return 'skipped'
  }
  const secret = process.env.TAB_SIGNUP_WEBHOOK_SECRET
  if (!secret) {
    console.error('[waitlist] TAB_SIGNUP_WEBHOOK_URL is set but TAB_SIGNUP_WEBHOOK_SECRET is not. Refusing to send an unsigned webhook.')
    return 'failed'
  }

  const body = JSON.stringify({
    type: 'waitlist.signup',
    id: row.id,
    created_at: row.createdAt.toISOString(),
    data: {
      id: row.id,
      phone_e164: row.phoneE164,
      status: row.status,
      consent_text: row.consentText,
      consent_version: row.consentVersion,
      consent_at: row.consentAt.toISOString(),
      signup_location: row.signupLocation,
    },
  })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'tab-site-waitlist/1',
        'X-Tab-Event-Id': row.id,
        'X-Tab-Timestamp': timestamp,
        'X-Tab-Signature': `v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[waitlist] Signup webhook answered ${res.status} for ${row.id}`)
      return 'failed'
    }
    return 'sent'
  } catch (err) {
    console.error(`[waitlist] Signup webhook failed for ${row.id}`, err)
    return 'failed'
  }
}
