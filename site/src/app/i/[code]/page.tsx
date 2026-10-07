import type { Metadata } from 'next'
import { cache } from 'react'
import { LandingPage } from '@/components/LandingPage'
import { SITE_DESCRIPTION, SITE_TITLE } from '@/lib/site'
import { cleanRefCode } from '@/lib/waitlist/referral-config'
import { pageStore } from '@/lib/waitlist/server'
import { isRealRefCode } from '@/lib/waitlist/signup'

// Checked against the table on every visit, so a code is live the moment its owner signs up.
export const dynamic = 'force-dynamic'

const TITLE = 'You’re invited to Tab'

type Props = { params: Promise<{ code: string }> }

/** The code if it belongs to a real row, else null. One lookup per request, shared with the metadata. */
const realCode = cache(async (raw: string): Promise<string | null> => {
  const code = cleanRefCode(raw)
  const store = code ? pageStore() : null
  return code && store && (await isRealRefCode(store, code)) ? code : null
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = await realCode((await params).code)
  // Invite links are for people, not search results: the landing page is the canonical one.
  const base: Metadata = { alternates: { canonical: '/' }, robots: { index: false, follow: true } }
  if (!code) return { ...base, title: SITE_TITLE }
  return {
    ...base,
    title: TITLE,
    description: SITE_DESCRIPTION,
    openGraph: {
      type: 'website',
      url: `/i/${code}`,
      siteName: 'Tab',
      title: TITLE,
      description: SITE_DESCRIPTION,
      locale: 'en_US',
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: SITE_DESCRIPTION },
  }
}

/**
 * The landing page with "A friend invited you to Tab" on top. The page only
 * learns whether the code is real; who it belongs to never leaves the server.
 * An unknown code renders the normal page, with no banner and no error.
 */
export default async function InvitePage({ params }: Props) {
  return <LandingPage invite={{ code: await realCode((await params).code) }} />
}
