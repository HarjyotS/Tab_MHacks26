// Server-side Turnstile check: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(token: string, secret: string, idempotencyKey: string): Promise<{ ok: boolean; codes: string[] }> {
  if (!token || token.length > 2048) return { ok: false, codes: ['missing-input-response'] }
  const body = new URLSearchParams({ secret, response: token, idempotency_key: idempotencyKey })
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000), cache: 'no-store' })
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    return { ok: data.success === true, codes: data['error-codes'] ?? [] }
  } catch (err) {
    console.error('[waitlist] Turnstile verification request failed', err)
    return { ok: false, codes: ['internal-error'] }
  }
}
