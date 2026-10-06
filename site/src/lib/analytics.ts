// Thin PostHog wrapper. posthog-js is only downloaded when NEXT_PUBLIC_POSTHOG_KEY
// is set. Event properties are an allow-list of short strings and numbers, so
// phone numbers and form contents can never be sent.

type Props = Record<string, string | number | boolean>
type PostHogLike = { capture: (event: string, props?: Props) => void }

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

const ALLOWED_PROPS = new Set(['location', 'percent', 'section', 'reason', 'duplicate', 'referred', 'method', 'position_bucket', 'valid'])

let client: PostHogLike | null = null
let queue: [string, Props | undefined][] = []
let started = false

function clean(props?: Props): Props | undefined {
  if (!props) return undefined
  const out: Props = {}
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue
    if (typeof v === 'string' && (v.length > 40 || /\d{4,}/.test(v))) continue
    out[k] = v
  }
  return out
}

export function track(event: string, props?: Props) {
  if (!KEY) return
  const safe = clean(props)
  if (client) client.capture(event, safe)
  else queue.push([event, safe])
}

export function analyticsEnabled() {
  return !!KEY
}

export async function startAnalytics() {
  if (!KEY || started) return
  started = true
  const { default: posthog } = await import('posthog-js')
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
  })
  client = posthog
  for (const [e, p] of queue) posthog.capture(e, p)
  queue = []
}
