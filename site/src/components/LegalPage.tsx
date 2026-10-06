import type { ReactNode } from 'react'
import { Footer, Header } from './SiteChrome'
import { SUPPORT_EMAIL } from '@/lib/site'

export const LEGAL_UPDATED = 'October 6, 2026'

export type LegalSection = { id: string; title: string; body: ReactNode }

/** Draft legal page: plain-English sections under a clear "draft for lawyer review" banner. */
export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <>
      <Header home={false} />
      <main id="main" className="legal wrap">
        <p className="legal__badge">Draft for lawyer review, last updated {LEGAL_UPDATED}</p>
        <h1 className="h2 h2--56">{title}</h1>
        <div className="legal__intro">{intro}</div>
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="legal__section" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>{s.title}</h2>
            {s.body}
          </section>
        ))}
        <p className="legal__back">
          <a href="/">Back to addtab.app</a>
        </p>
      </main>
      <Footer />
    </>
  )
}

export function Email() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
}
