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
        <li>
          Every message is first checked by a separate screening model that only decides whether it&apos;s about a shared expense. Messages that
          aren&apos;t are deleted right after that check and never reach Tab&apos;s AI.
        </li>
        <li>Tab only keeps messages that are about money.</li>
        <li>Tab never holds, moves, or has access to your money or your bank account.</li>
        <li>Your data is never sold and never used for ads.</li>
        <li>Text STOP to Tab any time and it stops texting you. Text &quot;delete my data&quot; and it deletes what it has about you.</li>
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
    id: 'invites',
    title: 'Invite links',
    body: (
      <p>
        Everyone on the waitlist gets an invite link with a random code in it. If you join through a friend&apos;s link, we note which code it was
        and add one to their count of friends who joined, which moves them up the list. The link never shows your phone number, or theirs, to
        anyone. When you open an invite link, this site stores the code in a cookie for 30 days so the invite still counts if you look around first.
      </p>
    ),
  },
  {
    id: 'chat',
    title: 'If Tab is in your group chat',
    body: (
      <>
        <p>
          A screening model checks each message in the group to tell whether it&apos;s about money. It can&apos;t reply or take any action. Messages
          that aren&apos;t about money are deleted right after that check and are never passed to Tab&apos;s AI. Messages that are,
          like amounts, who paid, and receipt photos, are kept so Tab can track and settle the tab. Tab also keeps the first names people give it and
          their phone numbers, so it knows who owes whom.
        </p>
        <p>
          Photos are checked the same way, on Tab&apos;s own computer: it reads any text in the photo there. Only a photo with prices, a total, or a
          payment in it, or a caption about money, goes on to Tab&apos;s AI. Selfies, memes, and everything else don&apos;t.
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
        A few service providers handle data only to run Tab: message delivery, the screening model, AI that reads money messages and receipt photos, hosting and storage, and
        website analytics. They aren&apos;t allowed to use your data for anything else.
      </p>
    ),
  },
  {
    id: 'deletion',
    title: 'Keeping and deleting data',
    body: (
      <p>
        Waitlist entries are kept until launch or until you opt out. Group money records are kept while your group uses Tab. To stop all texts
        from Tab, text it STOP (START undoes it). To have your data deleted, text Tab &quot;delete my data&quot; and confirm, or use the contact
        link at the bottom of this page. Your name, payment handle, and messages are deleted. Amounts your friends still owe each other stay on
        their tab without your name or number, and your number is kept only so Tab never texts it again.
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
