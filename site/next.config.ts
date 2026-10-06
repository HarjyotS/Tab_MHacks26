import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

// A production deploy without these would either break the waitlist or silently
// drop sign-ups, so the Vercel production build refuses to start without them.
// Local builds and previews fall back to dev behavior (see src/lib/waitlist/env.ts).
// Turnstile is optional for now: without its keys the action skips the bot check and logs a warning.
const REQUIRED_IN_PRODUCTION = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'IP_HASH_SECRET'] as const

if (process.env.VERCEL_ENV === 'production') {
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `[tab-site] Production build stopped: missing env vars ${missing.join(', ')}. ` +
        'Set them in the Vercel project (Settings > Environment Variables) and redeploy. See site/README.md.',
    )
  }
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/phone-frame.webp',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
