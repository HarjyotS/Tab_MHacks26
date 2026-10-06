import type { Metadata } from 'next'
import { Email, LegalPage, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service | Tab',
  description: 'The terms for using Tab during its beta. Draft for lawyer review.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/terms' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Who we are and this agreement',
    body: (
      <>
        <p>
          Tab is a small beta run by Harjyot Sahni. Legal entity and mailing address: [COMPANY LEGAL NAME AND ADDRESS, to be added]. By joining the
          waitlist, adding Tab to a group chat, or using Tab, you agree to these terms and to our <a href="/privacy">Privacy Policy</a>.
        </p>
      </>
    ),
  },
  {
    id: 'beta',
    title: 'Tab is a beta',
    body: (
      <p>
        Tab is an early experiment with a small number of friend groups. It is provided as-is. It may have bugs, it may be down sometimes, and
        features may change or go away.
      </p>
    ),
  },
  {
    id: 'eligibility',
    title: 'Who can use Tab',
    body: <p>You must be at least 18, or have permission from a parent or guardian, to use Tab.</p>,
  },
  {
    id: 'groups',
    title: 'Adding Tab to a group',
    body: (
      <p>
        Only add Tab to a group chat when the people in it agree to have Tab there. Tab reads the group&apos;s messages to find the ones about money
        (see the <a href="/privacy">Privacy Policy</a> for what it keeps).
      </p>
    ),
  },
  {
    id: 'not-a-bank',
    title: 'Tab is not a bank',
    body: (
      <>
        <p>
          Tab is not a bank, a money transmitter, or a payment processor. Tab never holds, moves, or has access to your money. When it&apos;s time to
          settle up, Tab gives you a payment link that opens Venmo or Cash App on your own phone, and you send the money yourself there. Those apps&apos;
          own terms apply to those payments.
        </p>
        <p>Tab will never ask for your bank login, card number, or Social Security number.</p>
      </>
    ),
  },
  {
    id: 'math',
    title: 'Check the math',
    body: (
      <p>
        Tab&apos;s totals and splits are a convenience. Tab can misread a message or a receipt, so look over the amount before you pay anyone. You and
        your group are responsible for what you send each other.
      </p>
    ),
  },
  {
    id: 'texts',
    title: 'Text messages',
    body: (
      <p>
        Tab works over iMessage and text. Your carrier&apos;s message and data rates may apply. You can reply STOP to stop texts from Tab at any time.
      </p>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <ul>
        <li>Don&apos;t use Tab to send spam or to bother people who didn&apos;t ask for it.</li>
        <li>Don&apos;t use Tab for anything illegal, or to track money for anything illegal.</li>
        <li>Don&apos;t add Tab to a group without the members&apos; agreement.</li>
        <li>Don&apos;t try to break, overload, or get around Tab&apos;s protections.</li>
      </ul>
    ),
  },
  {
    id: 'ending',
    title: 'Ending things',
    body: (
      <p>
        You can remove Tab from a group chat at any time, like any other contact. We can remove Tab from a group, stop offering Tab to someone, or end
        the beta at any time, including if these terms are broken.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <p>
        To the extent the law allows, Tab and the people who run it are not liable for indirect or consequential losses, or for money you send or
        don&apos;t send based on Tab&apos;s numbers. Our total liability for anything related to Tab is limited to the amount you paid us for it,
        which during the free beta is zero. [Final wording to be set by counsel.]
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: <p>These terms are governed by the laws of [STATE], without regard to its conflict of law rules.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: <p>We may update these terms as Tab changes. We&apos;ll update the date at the top, and for big changes we&apos;ll let people know.</p>,
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: <Email />.
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={<p className="lede">The ground rules for using Tab while it&apos;s in beta, in plain English.</p>}
      sections={SECTIONS}
    />
  )
}
