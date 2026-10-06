import type { Metadata } from 'next'
import { Email, LegalPage, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy | Tab',
  description: 'How Tab handles your phone number, your group chat, and your data. Draft for lawyer review.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/privacy' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          Tab is a small beta experiment run by Harjyot Sahni with 10 to 20 friend groups. Tab is an iMessage contact you add to a group chat to keep
          track of shared expenses and settle up.
        </p>
        <p>Legal entity and mailing address: [COMPANY LEGAL NAME AND ADDRESS, to be added].</p>
        <p>
          Questions about privacy go to <Email />.
        </p>
      </>
    ),
  },
  {
    id: 'short',
    title: 'The short version',
    body: (
      <ul>
        <li>Tab only keeps the messages in your group chat that are about money. Everything else is deleted right after Tab reads it.</li>
        <li>Tab never holds, moves, or has access to your money or your bank account.</li>
        <li>We don&apos;t sell your data and we don&apos;t use it for ads.</li>
        <li>You can ask us to delete your data at any time by emailing us.</li>
      </ul>
    ),
  },
  {
    id: 'waitlist',
    title: 'When you join the waitlist',
    body: (
      <>
        <p>When you sign up on addtab.app we store:</p>
        <ul>
          <li>your phone number;</li>
          <li>the exact consent wording you were shown, and when you accepted it;</li>
          <li>a one-way hash of your IP address (we never store the IP address itself);</li>
          <li>your browser&apos;s user agent (the browser and device type it reports);</li>
          <li>the page that referred you, and any campaign (UTM) tags in the link you used.</li>
        </ul>
        <p>
          This is stored with Amazon Web Services (DynamoDB, US East region). We use it only to contact you about Tab&apos;s beta and launch, and to
          keep the sign-up form free of spam and abuse. When the bot check is turned on, the form uses Cloudflare Turnstile, which looks at your
          browser to tell people from bots.
        </p>
        <p>
          To stop texts, reply STOP to any message from Tab. To have your waitlist entry deleted, email <Email />.
        </p>
      </>
    ),
  },
  {
    id: 'analytics',
    title: 'Website analytics',
    body: (
      <p>
        We use PostHog to understand how people use addtab.app: page views, how far down the page people scroll, which sections they see, and which
        steps of the sign-up form they reach. PostHog stores an anonymous identifier in your browser (a cookie and local storage). We never send
        your phone number or anything you type into the form to PostHog.
      </p>
    ),
  },
  {
    id: 'group-chats',
    title: 'When Tab is in your group chat',
    body: (
      <>
        <p>Tab reads the messages in a group it has been added to, so it can tell which ones are about money.</p>
        <ul>
          <li>
            <strong>Messages that aren&apos;t about money are not kept.</strong> Their text is deleted right after Tab decides they aren&apos;t about
            money.
          </li>
          <li>
            <strong>Money-related messages are kept</strong>, such as amounts, who paid, and receipts, so Tab can keep the running tab and work out
            who owes whom.
          </li>
          <li>
            <strong>Receipt photos</strong> are read to pull out the items and totals.
          </li>
          <li>
            <strong>Names and numbers:</strong> Tab keeps each member&apos;s first name (as they tell Tab) and phone number, so it knows who owes
            whom.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'money',
    title: 'Money and payments',
    body: (
      <>
        <p>
          Tab never holds, moves, or has access to anyone&apos;s money or bank account. Settling up works through payment links that open Venmo or
          Cash App on your own phone, and you pay there. Those apps have their own privacy policies.
        </p>
        <p>
          If you give Tab your Venmo username or Cash App $cashtag, Tab stores it so it can make those links. Tab will never ask for your bank login,
          card number, or Social Security number. If something claiming to be Tab does, it isn&apos;t us.
        </p>
      </>
    ),
  },
  {
    id: 'providers',
    title: 'Who processes data for us',
    body: (
      <>
        <p>We use these service providers to run Tab. They process data only to provide their service to Tab:</p>
        <ul>
          <li>Photon, to send and receive iMessages;</li>
          <li>xAI (Grok), to understand money messages and read receipts;</li>
          <li>TypeSafe, to classify whether a message is about money;</li>
          <li>Amazon Web Services, for hosting and our database;</li>
          <li>Vercel, to host this website;</li>
          <li>PostHog, for website analytics;</li>
          <li>Cloudflare (Turnstile), to protect the sign-up form from bots, when enabled.</li>
        </ul>
        <p>We don&apos;t sell your data, and we don&apos;t use it for advertising.</p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul>
        <li>Waitlist entries: until Tab launches, or until you opt out or ask us to delete them, whichever comes first.</li>
        <li>A group&apos;s money records: while the group uses Tab, and deleted when someone in the group asks.</li>
        <li>Messages that aren&apos;t about money: not kept. Their text is deleted right after Tab reads them.</li>
      </ul>
    ),
  },
  {
    id: 'choices',
    title: 'Your choices and deleting your data',
    body: (
      <>
        <p>
          Email <Email /> to see or delete the data we have about you, or to have your group&apos;s data deleted. This works today. A command you
          can text inside the group to delete the group&apos;s data is planned.
        </p>
        <p>You can reply STOP to any text from Tab to stop getting texts, and you can remove Tab from a group chat like any other contact.</p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>Tab is not meant for children under 13, and we don&apos;t knowingly collect their information. If you think a child has used Tab, email us and we&apos;ll delete it.</p>,
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        We use reputable providers, encrypted connections, and limited access to keep data safe. No system is perfect, so we keep only what Tab needs
        and delete the rest.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: <p>If we change how we handle data, we&apos;ll update this page and its date. For big changes we&apos;ll tell people on the waitlist or in Tab.</p>,
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions or requests: <Email />.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p className="lede">This explains what Tab collects, why, who helps us run it, and how to get your data deleted.</p>}
      sections={SECTIONS}
    />
  )
}
