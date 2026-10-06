import { WaitlistForm } from '../client/WaitlistForm'
import { HeroFloat } from '../client/HeroFloat'

const HEADLINE = 'Your group chat keeps the tab now.'

/**
 * Server component. The headline builds word by word with a pure CSS stagger
 * (no JavaScript on the critical path); the form is the only client island.
 */
export function Hero({ siteKey, inviteCode = null }: { siteKey: string | null; inviteCode?: string | null }) {
  const words = HEADLINE.split(' ')
  return (
    <section id="top" className="hero" data-section="hero">
      <h1 className="hero__title" aria-label={HEADLINE}>
        {words.map((w, i) => (
          <span key={i} aria-hidden="true">
            <span className="hero__word" style={{ ['--i' as string]: i }}>
              {w}
            </span>
            {i < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </h1>
      <p className="hero__lede">
        Add Tab to your group chat and get on with your life. Nobody stops the night to log what they paid. Tab picks it up from the chat, settles
        up whenever you&apos;re ready,{' '}
        <mark className="hero__private">and keeps the rest of your chat away from its AI.</mark>
      </p>
      <a className="hero__proof" href="#trust">
        <svg className="hero__shield" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 1.8 3.2 4.4v5.1c0 4.2 2.9 7.4 6.8 8.7 3.9-1.3 6.8-4.5 6.8-8.7V4.4L10 1.8Z" fill="currentColor" />
          <path d="m6.8 10.1 2.2 2.2 4.3-4.6" fill="none" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          <strong>Private by design.</strong> A separate screening model checks each message first. Texts that aren&apos;t about money are erased
          unseen.
        </span>
      </a>
      <div id="join" className="join-card join-card--hero">
        <WaitlistForm location="hero" siteKey={siteKey} inviteCode={inviteCode} />
      </div>
      <HeroFloat target="join" />
    </section>
  )
}
