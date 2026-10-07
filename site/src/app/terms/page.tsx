import type { Metadata } from 'next'
import { LegalPage, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms | Tab',
  description: 'The ground rules for using Tab.',
  alternates: { canonical: '/terms' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'what',
    title: 'What Tab is',
    body: (
      <p>
        Tab is an iMessage contact you add to a group chat. It keeps track of shared expenses, works out who owes whom, and sends payment links so
        people can settle up. Tab is in beta, so it may have bugs and may change.
      </p>
    ),
  },
  {
    id: 'money',
    title: 'Tab never touches your money',
    body: (
      <p>
        Tab is not a bank, a payment processor, or a money transmitter. It never holds or moves money. When you pay someone, you do it yourself in
        Venmo or Cash App, and those apps&apos; own terms apply.
      </p>
    ),
  },
  {
    id: 'amounts',
    title: 'Check the numbers',
    body: (
      <p>
        Tab does its best to read messages and receipts correctly, but it can make mistakes. Check any amount before you pay it, and correct Tab in the
        chat if something looks off.
      </p>
    ),
  },
  {
    id: 'use',
    title: 'Using Tab fairly',
    body: (
      <ul>
        <li>Only add Tab to a group whose members are fine with it being there.</li>
        <li>Don&apos;t use Tab to spam, harass, or mislead anyone, or for anything illegal.</li>
        <li>Don&apos;t try to break, overload, or get around how Tab works.</li>
      </ul>
    ),
  },
  {
    id: 'texts',
    title: 'Texts',
    body: <p>Standard message and data rates may apply. Reply STOP to any text from Tab to stop receiving them.</p>,
  },
  {
    id: 'ending',
    title: 'Ending things',
    body: (
      <p>
        You can remove Tab from a group at any time. Tab may also leave a group, pause the beta, or end it, and may remove access for anyone who breaks
        these terms.
      </p>
    ),
  },
  {
    id: 'as-is',
    title: 'No guarantees',
    body: (
      <p>
        Tab is provided as is, without warranties. To the extent the law allows, Tab is not responsible for losses that come from using it, including
        mistakes in amounts or payments made outside of Tab.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes',
    body: <p>These terms may change as Tab grows. If they do, the date at the top will change too. Using Tab after that means you accept them.</p>,
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      intro={<p className="lede">The ground rules for using Tab, in plain English.</p>}
      sections={SECTIONS}
    />
  )
}
