// The FAQ, used by both the page and its FAQPage JSON-LD so the two can't drift.
export type FaqItem = { q: string; a: string }

export const FAQ: FaqItem[] = [
  { q: 'When can my group use Tab?', a: "We're letting groups in a few at a time. Join the waitlist and we'll text you when it's your turn." },
  {
    q: 'Does everyone in the group need to sign up?',
    a: 'No. One person adds Tab to the chat, and everyone else just keeps texting. Tab asks each person for their first name once, and for a payment handle only when they first need to pay or get paid.',
  },
  {
    q: 'Will Tab call out my friend who never pays?',
    a: 'Never in front of the group. Tab reminds people privately and politely, so you never have to be the one who asks. Your friend will just mysteriously start paying on time.',
  },
  {
    q: 'Does Tab read our whole chat?',
    a: 'Tab reads messages to spot money, keeps only the ones about expenses, and deletes the rest right after reading them. It never sells your data or shows ads.',
  },
  {
    q: 'How do payments work?',
    a: 'For now, Tab sends each person a Venmo or Cash App link for their exact amount, and the person being paid confirms it arrived. Tab never holds or moves your money. Settling directly inside iMessage is coming soon.',
  },
  { q: 'How much does it cost?', a: 'Tab is free during the beta.' },
]
