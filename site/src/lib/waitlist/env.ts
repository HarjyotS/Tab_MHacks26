// Waitlist configuration. Locally (next dev, or WAITLIST_DEV_FALLBACK=1) missing
// keys fall back to Cloudflare's always-pass Turnstile test keys and an
// in-memory store, with a loud warning. Anywhere else a missing key is a hard,
// clearly logged error: sign-ups are never accepted and silently dropped.

export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA'
const DEV_IP_HASH_SECRET = 'tab-dev-only-ip-hash-secret'
export const DEFAULT_WAITLIST_TABLE = 'tab-waitlist'

export function devFallbackAllowed(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false
  return process.env.NODE_ENV !== 'production' || process.env.WAITLIST_DEV_FALLBACK === '1'
}

export type DynamoConfig = { region: string; accessKeyId: string; secretAccessKey: string; table: string }

export type WaitlistConfig = {
  /** null means the dev-only in-memory store. */
  dynamo: DynamoConfig | null
  /** null means Turnstile is not configured and the bot check is skipped (with a warning). */
  turnstileSecret: string | null
  ipHashSecret: string
  usingFallbacks: string[]
}

export type ConfigResult = { ok: true; config: WaitlistConfig } | { ok: false; missing: string[] }

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[waitlist] DEV FALLBACK: ${message}`)
}

export function getWaitlistConfig(): ConfigResult {
  const fallback = devFallbackAllowed()
  const missing: string[] = []
  const usingFallbacks: string[] = []

  const region = process.env.AWS_REGION || ''
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || ''
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
  const table = process.env.WAITLIST_TABLE || DEFAULT_WAITLIST_TABLE
  const awsMissing = [
    ['AWS_REGION', region],
    ['AWS_ACCESS_KEY_ID', accessKeyId],
    ['AWS_SECRET_ACCESS_KEY', secretAccessKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)

  let dynamo: DynamoConfig | null = null
  if (awsMissing.length === 0) dynamo = { region, accessKeyId, secretAccessKey, table }
  else if (fallback) {
    usingFallbacks.push(...awsMissing)
    warnOnce('aws', `${awsMissing.join(', ')} not set. Sign-ups go to an in-memory list that is lost on restart. Never use this in production.`)
  } else missing.push(...awsMissing)

  let turnstileSecret: string | null = process.env.TURNSTILE_SECRET_KEY || null
  if (!turnstileSecret && fallback) {
    turnstileSecret = TURNSTILE_TEST_SECRET_KEY
    usingFallbacks.push('TURNSTILE_SECRET_KEY')
    warnOnce('ts', "TURNSTILE_SECRET_KEY is not set. Using Cloudflare's always-pass test secret.")
  } else if (!turnstileSecret || !getTurnstileSiteKey()) {
    // Optional in production for now. A secret without a site key can never verify (the page has
    // no widget to make tokens), so that combination is treated as "not configured" too.
    turnstileSecret = null
    if (!warned.has('ts-off')) {
      warned.add('ts-off')
      console.warn(
        '[waitlist] Turnstile is not configured (set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY). Sign-ups are accepted without a bot check.',
      )
    }
  }

  let ipHashSecret = process.env.IP_HASH_SECRET || ''
  if (!ipHashSecret) {
    if (fallback) {
      ipHashSecret = DEV_IP_HASH_SECRET
      usingFallbacks.push('IP_HASH_SECRET')
      warnOnce('ip', 'IP_HASH_SECRET is not set. Using a fixed dev secret for IP hashing.')
    } else missing.push('IP_HASH_SECRET')
  }

  if (missing.length) {
    console.error(
      `[waitlist] Misconfigured: missing ${missing.join(', ')}. Sign-ups are being rejected until these are set. See site/README.md.`,
    )
    return { ok: false, missing }
  }
  return { ok: true, config: { dynamo, turnstileSecret, ipHashSecret, usingFallbacks } }
}

/** Site key for the browser widget, or null when Turnstile is not configured. */
export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  if (key) return key
  return devFallbackAllowed() ? TURNSTILE_TEST_SITE_KEY : null
}
