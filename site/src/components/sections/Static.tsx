import { Faq } from '../client/Faq'
import { FAQ } from '@/content/faq'
import { WaitlistForm } from '../client/WaitlistForm'

const GROUPS = [
  {
    chat: 'Apartment 4B 🔑',
    title: 'Roommates',
    body: 'Rent, utilities, the Costco run, the shared streaming accounts. One tab that runs all year.',
    lines: [['Electric bill', '$96.40'], ['Costco run', '$212.18'], ['Wifi', '$60.00']],
    foot: 'Settles on the 1st of every month',
  },
  {
    chat: 'Lunch crew 🌯',
    title: 'Friends who split whenever',
    body: 'You get this one, they get the next. Tab keeps a tab that never resets, so it all quietly evens out.',
    lines: [['Burritos', '$29.70'], ['Coffee', '$12.50'], ['Movie tickets', '$34.00']],
    foot: 'Settles whenever someone asks',
  },
  {
    chat: 'Vegas Trip 2026 🎰',
    title: 'Trips',
    body: 'Every Uber, dinner, and cleaning fee from takeoff to landing, all in one place without anyone keeping score.',
    lines: [['Airbnb', '$1,260.00'], ['Club entry', '$200.00'], ['Brunch', '$142.80']],
    foot: 'Settles before the flight home',
  },
]

export function GroupsSection() {
  return (
    <section className="groups wrap" aria-labelledby="groups-title" data-section="groups">
      <div className="intro">
        <h2 id="groups-title" className="h2 h2--64" data-split="">
          Not just trips. Any group that splits stuff.
        </h2>
        <p className="lede">
          Tab keeps one running tab per group chat, for as long as you want. Settle at the end of a trip, on the first of every month, or whenever
          someone asks.
        </p>
      </div>
      <div className="groups__cards">
        {GROUPS.map((g) => (
          <div className="group-card" key={g.title}>
            <span className="group-card__chat">{g.chat}</span>
            <h3>{g.title}</h3>
            <p>{g.body}</p>
            <div className="mini-receipt">
              {g.lines.map(([what, amt]) => (
                <div className="mini-receipt__row" key={what}>
                  <span>{what}</span>
                  <span className="r-fill" aria-hidden="true" />
                  <span>{amt}</span>
                </div>
              ))}
              <div className="mini-receipt__foot">{g.foot}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { title: 'Add Tab to your group chat', body: "Add Tab's number like any other contact. It says hi, asks everyone's first name, and gets out of the way." },
  {
    title: 'Keep talking like normal',
    body: "Mention what you paid for, or drop a photo of the receipt. Tab logs it quietly and ignores everything that isn't about money.",
  },
  {
    title: 'Settle up at the end',
    body: 'When the trip or the month is over, Tab totals everything, works out the fewest payments, and sends each person a one-tap link.',
  },
]

export function HowSection() {
  return (
    <section id="how" className="how wrap" aria-labelledby="how-title" data-section="how">
      <h2 id="how-title" className="h2 h2--56 how__title" data-split="">
        Set it up once. Then just talk.
      </h2>
      <ol className="how__steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="how__num">{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

const TRUST = [
  {
    title: 'A screener reads first, not a chatbot',
    body: 'Every message goes to a separate model with one job: decide if it’s a shared expense. It can’t reply, look things up, or take any action.',
  },
  {
    title: 'Everything else is erased',
    body: 'If a text isn’t about money, its words are deleted right after that check. Tab’s AI never sees them.',
  },
  {
    title: 'Code does the math',
    body: 'Amounts and splits are worked out by plain code, and every number Tab sends has to match your group’s ledger.',
  },
  {
    title: 'Nothing moves without your yes',
    body: 'Only your own 👍 approves a payment. Tab’s AI can’t send money for anyone.',
  },
  {
    title: 'Tab never holds your money',
    body: 'You pay each other directly, through apps you already trust. Tab never asks for a bank login.',
  },
  {
    title: 'Only where you invite it',
    body: 'Tab listens only in chats where it’s been turned on, and stops the moment you turn it off or remove it.',
  },
]

/** The screener at work: what happens to a few real-looking texts. */
const SCREENED = [
  { text: 'the fountain show was unreal 😭', money: false },
  { text: 'covered club entry for all of us, $200', money: true },
  { text: 'who’s down for the buffet tomorrow', money: false },
  { text: 'airbnb cleaning fee was $90 btw', money: true },
]

export function TrustSection() {
  return (
    <section id="trust" className="trust" aria-labelledby="trust-title" data-section="trust">
      <div className="trust__inner wrap">
        <div className="trust__head">
          <h2 id="trust-title" className="h2 h2--56 trust__title" data-split="">
            Private by design.
          </h2>
          <p className="trust__lede">
            Most of your group chat has nothing to do with money, so Tab is built to never see it. Before Tab&apos;s AI reads anything, a separate
            screening model asks one question.
          </p>
        </div>
        <figure className="screen" aria-label="How Tab screens messages">
          <figcaption className="screen__q">
            <span className="screen__dot" aria-hidden="true" />
            Is this a shared expense?
          </figcaption>
          <ul className="screen__list">
            {SCREENED.map((m) => (
              <li key={m.text} className={m.money ? 'screen__row is-money' : 'screen__row'}>
                <span className="screen__msg">{m.text}</span>
                <span className="screen__verdict">{m.money ? 'Logged for your group' : 'Erased, never seen by AI'}</span>
              </li>
            ))}
          </ul>
        </figure>
        <div className="trust__grid">
          {TRUST.map((t) => (
            <div className="trust__item" key={t.title}>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
        <p className="trust__note">
          Your data is never sold or used for ads. Tab will never ask for your bank login or Social Security number in a text. If something claiming
          to be Tab does, it isn&apos;t us.
        </p>
      </div>
    </section>
  )
}

export function FaqSection() {
  return (
    <section id="faq" className="faq wrap" aria-labelledby="faq-title" data-section="faq">
      <h2 id="faq-title" className="h2 h2--56" data-split="">
        Questions
      </h2>
      <Faq items={FAQ} />
    </section>
  )
}

export function JoinSection({ siteKey, inviteCode = null }: { siteKey: string | null; inviteCode?: string | null }) {
  return (
    <section className="join" aria-labelledby="join-title" data-section="join-footer">
      <div className="join__inner wrap">
        <div className="join__text">
          <h2 id="join-title" className="h2 h2--72" data-split="">
            Be the friend who added Tab.
          </h2>
          <p>
            Tab is invite-only for now. Get on the list and we&apos;ll text you when your group can start. It&apos;s free during the beta, and your
            friends will thank you by the second trip.
          </p>
        </div>
        <div id="join-footer" className="join-card join-card--footer">
          <WaitlistForm location="footer" siteKey={siteKey} inviteCode={inviteCode} />
        </div>
      </div>
    </section>
  )
}
