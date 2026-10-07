import type { Metadata } from 'next'
import { Footer, Header } from '@/components/SiteChrome'
import { SpotCard } from '@/components/client/SpotCard'
import { cleanRefCode, type WaitlistSpot } from '@/lib/waitlist/referral-config'
import { pageStore } from '@/lib/waitlist/server'
import { spotForRefCode } from '@/lib/waitlist/signup'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your spot on the Tab waitlist',
  alternates: { canonical: '/' },
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ code: string }> }

/**
 * Check your spot later: the same result card, found by the unguessable invite
 * code. Only the card's numbers reach the page, never the phone number.
 */
export default async function SpotPage({ params }: Props) {
  const code = cleanRefCode((await params).code)
  const store = code ? pageStore() : null
  let spot: WaitlistSpot | null = null
  if (code && store) {
    try {
      spot = await spotForRefCode(store, code)
    } catch (err) {
      console.error('[waitlist] Could not load a spot page', err)
    }
  }

  return (
    <>
      <Header home={false} />
      <main id="main" className="spot-page wrap">
        <div className="join-card join-card--hero spot-page__card">
          {spot ? (
            <SpotCard
              spot={spot}
              eyebrow="Your spot on the Tab waitlist"
              note="When your spot opens, Tab will text you from its own number to confirm. Reply STOP anytime to opt out."
              level={1}
              reportShown
              showLater={false}
            />
          ) : (
            <div className="join-form__done">
              <h1 className="join-form__done-title">We couldn&rsquo;t find that spot.</h1>
              <p className="join-form__done-body">
                Check the link, or <a href="/#join">join the waitlist</a> to get your own.
              </p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
