import { Enhance } from '../client/Enhance'

const STEPS = [
  'Open the split app',
  'Find the right group',
  'Tap to add an expense',
  'Type what it was',
  'Enter the amount',
  'Pick who paid',
  'Pick how to split it',
  'Save, while everyone waits for you to look up',
]

/**
 * Server-rendered in its resting state: every step crossed out, Tab's single
 * message in place. The enhancer un-crosses them and replays it on scroll.
 */
export function DinnerSection() {
  return (
    <section className="dinner wrap" aria-labelledby="moment-title" data-enhance="" data-section="dinner">
      <div className="intro">
        <h2 id="moment-title" className="h2 h2--64" data-split="">
          Pay for dinner. Put your phone away.
        </h2>
        <p className="lede">
          Nobody should have to pause the night to log a bill. Say it in the chat the way you already would, then go back to whatever you were
          doing.
        </p>
      </div>
      <div className="dinner__cards" data-cards="">
        <div className="dinner__old">
          <h3>Splitting it the usual way, at the table</h3>
          <ol className="dinner__steps" data-steps="">
            {STEPS.map((s, i) => (
              <li key={i}>
                <span className="dinner__num">{i + 1}</span>
                <span className="dinner__step">
                  {s}
                  {/* A transparent copy of the text carrying the line-through, so the strike follows
                      every wrapped line; it is drawn in with scaleX (transform only). */}
                  <span className="dinner__strike" aria-hidden="true">
                    {s}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="dinner__punch">Now do that thirteen more times this weekend.</p>
        </div>
        <div className="dinner__new" data-new="">
          <h3>Splitting it with Tab</h3>
          <div className="dinner__chat">
            <div className="dinner__bubble" data-bubble="">
              got dinner for everyone, $84
            </div>
            <div className="dinner__logged" data-logged="">
              <span className="mark mark--note" aria-hidden="true" />
              Tab logged $84.00
            </div>
          </div>
          <p className="dinner__punch dinner__punch--light">That&apos;s the whole thing. Back to your night.</p>
        </div>
      </div>
      <Enhance which="dinner" />
    </section>
  )
}
