import { WaitlistForm } from '../client/WaitlistForm'
import { HeroFloat } from '../client/HeroFloat'

const HEADLINE = 'Your group chat keeps the tab now.'

/**
 * Server component. The headline builds word by word with a pure CSS stagger
 * (no JavaScript on the critical path); the form is the only client island.
 */
export function Hero({ siteKey }: { siteKey: string | null }) {
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
        Add Tab to your group chat and get on with your life. Nobody stops the night to open an app and log what they paid. Tab picks it up from
        the chat, ignores everything else, and settles up whenever you&apos;re ready: after a trip, on the first of the month, or whenever.
      </p>
      <div id="join" className="join-card join-card--hero">
        <WaitlistForm location="hero" siteKey={siteKey} />
      </div>
      <HeroFloat target="join" />
    </section>
  )
}
