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
import { getTurnstileSiteKey } from '@/lib/waitlist/env'
import { PhoneSprite } from '@/components/phone/icons'
import { homeJsonLd, jsonLdString } from '@/lib/structured-data'

export default function Home() {
  const siteKey = getTurnstileSiteKey()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(homeJsonLd()) }} />
      <PhoneSprite />
      <Header />
      <main id="main">
        <Hero siteKey={siteKey} />
        <VegasSection />
        <WallSection />
        <DinnerSection />
        <EndingsSection />
        <ChatsSection />
        <GroupsSection />
        <HowSection />
        <TrustSection />
        <FaqSection />
        <JoinSection siteKey={siteKey} />
      </main>
      <Footer />
      <StickyJoin />
      <Enhance which="headings" />
    </>
  )
}
