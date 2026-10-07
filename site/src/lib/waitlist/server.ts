// Server-only access to the waitlist store for pages (the invite and spot pages).
import { getWaitlistConfig } from './env'
import { getStore, type WaitlistStore } from './store'

/** The configured store, or null when the waitlist is misconfigured (already logged by getWaitlistConfig). */
export function pageStore(): WaitlistStore | null {
  const config = getWaitlistConfig()
  return config.ok ? getStore(config.config.dynamo) : null
}
