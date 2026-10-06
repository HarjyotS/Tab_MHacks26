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
  { title: 'It keeps only money messages', body: 'Tab reads the chat to spot expenses and deletes everything else right after.' },
  { title: 'Nothing moves without your yes', body: 'Every payment needs your own approval, every single time.' },
  { title: 'Tab never holds your money', body: 'You pay each other directly, through apps you already trust.' },
  { title: 'Leaving takes one text', body: 'Remove Tab like any contact, or text "@tab forget us" to erase your group\'s data.' },
]

export function TrustSection() {
  return (
    <section id="trust" className="trust" aria-labelledby="trust-title" data-section="trust">
      <div className="trust__inner wrap">
        <h2 id="trust-title" className="h2 h2--56 trust__title" data-split="">
          Built to be trusted with your group chat.
        </h2>
        <div className="trust__grid">
          {TRUST.map((t) => (
            <div className="trust__item" key={t.title}>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
        <p className="trust__note">
          Tab will never ask for your bank login or Social Security number in a text. If something claiming to be Tab does, it isn&apos;t us.
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

export function JoinSection({ siteKey }: { siteKey: string | null }) {
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
          <WaitlistForm location="footer" siteKey={siteKey} />
        </div>
      </div>
    </section>
  )
}
