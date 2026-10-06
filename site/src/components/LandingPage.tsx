import { Footer, Header } from '@/components/SiteChrome'
import { Hero } from '@/components/sections/Hero'
import { VegasSection } from '@/components/sections/Vegas'
import { WallSection } from '@/components/sections/Wall'
import { DinnerSection } from '@/components/sections/Dinner'
import { EndingsSection } from '@/components/sections/Endings'
import { ChatsSection } from '@/components/sections/Chats'
import { FaqSection, GroupsSection, HowSection, JoinSection, TrustSection } from '@/components/sections/Static'
import { StickyJoin } from '@/components/client/StickyJoin'
import { Enhance } from '@/components/client/Enhance'
import { InviteBeacon } from '@/components/client/InviteBeacon'
import { getTurnstileSiteKey } from '@/lib/waitlist/env'
import { PhoneSprite } from '@/components/phone/icons'
import { homeJsonLd, jsonLdString } from '@/lib/structured-data'

/**
 * The landing page. `/` renders it plainly; `/i/<code>` passes a real invite
 * code (already checked on the server), which adds the banner and credits
 * sign-ups from either form to that invite.
 */
export function LandingPage({ invite }: { invite?: { code: string | null } }) {
  const siteKey = getTurnstileSiteKey()
  const code = invite?.code ?? null
  return (
    <>
      {invite ? null : <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(homeJsonLd()) }} />}
      <PhoneSprite />
      {code ? (
        <p className="invite-banner">
          <span className="mark mark--note" aria-hidden="true" />
          <span>A friend invited you to Tab</span>
        </p>
      ) : null}
      {invite ? <InviteBeacon code={code} /> : null}
      <Header />
      <main id="main">
        <Hero siteKey={siteKey} inviteCode={code} />
        <VegasSection />
        <WallSection />
        <DinnerSection />
        <EndingsSection />
        <ChatsSection />
        <GroupsSection />
        <HowSection />
        <TrustSection />
        <FaqSection />
        <JoinSection siteKey={siteKey} inviteCode={code} />
      </main>
      <Footer />
      <StickyJoin />
      <Enhance which="headings" />
    </>
  )
}
