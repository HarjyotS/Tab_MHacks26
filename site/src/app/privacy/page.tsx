import type { Metadata } from 'next'
import { LegalPage, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy | Tab',
  description: 'What Tab collects, why, and how to have it deleted.',
  alternates: { canonical: '/privacy' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'short',
    title: 'The short version',
    body: (
      <ul>
        <li>Tab only keeps messages that are about money. Everything else in your group chat is deleted right after Tab reads it.</li>
        <li>Tab never holds, moves, or has access to your money or your bank account.</li>
        <li>Your data is never sold and never used for ads.</li>
        <li>You can have your data deleted at any time.</li>
      </ul>
    ),
  },
  {
    id: 'waitlist',
    title: 'If you join the waitlist',
    body: (
      <p>
        We keep your phone number, the consent wording you agreed to and when, and basic details about the visit (a scrambled form of your IP
        address, your browser type, and the link that brought you here). We use your number only to text you about Tab&apos;s beta and launch. Reply
        STOP to any text to opt out.
      </p>
    ),
  },
  {
    id: 'chat',
    title: 'If Tab is in your group chat',
    body: (
      <>
        <p>
          Tab reads messages in the group to tell which ones are about money. Messages that aren&apos;t about money are not kept. Messages that are,
          like amounts, who paid, and receipt photos, are kept so Tab can track and settle the tab. Tab also keeps the first names people give it and
          their phone numbers, so it knows who owes whom.
        </p>
        <p>
          If you choose to give Tab a Venmo username or Cash App $cashtag, it keeps that so it can send you a payment link. Tab will never ask for a
          bank login, a card number, or a Social Security number.
        </p>
      </>
    ),
  },
  {
    id: 'site',
    title: 'This website',
    body: <p>We measure how people use this site, like which sections they reach, without recording what anyone types into the form.</p>,
  },
  {
    id: 'sharing',
    title: 'Who helps run Tab',
    body: (
      <p>
        A few service providers handle data only to run Tab: message delivery, AI that reads money messages and receipts, hosting and storage, and
        website analytics. They aren&apos;t allowed to use your data for anything else.
      </p>
    ),
  },
  {
    id: 'deletion',
    title: 'Keeping and deleting data',
    body: (
      <p>
        Waitlist entries are kept until launch or until you opt out. Group money records are kept while your group uses Tab. To have your data
        deleted, reply STOP to a text from Tab or use the contact link at the bottom of this page.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes',
    body: <p>If this policy changes, the date at the top will change too.</p>,
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p className="lede">What Tab collects, why, and how to have it deleted.</p>}
      sections={SECTIONS}
    />
  )
}
