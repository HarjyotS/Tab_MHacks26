// The exact consent wording shown next to the waitlist form. The server stores
// this string (not anything the browser sends) with every sign-up, so if the
// wording changes, bump CONSENT_VERSION in the same commit.

export const CONSENT_VERSION = '2026-10-06.v2'

export const CONSENT_LEAD =
  'Text me when Tab is ready. I agree that Tab may text this number about the beta and its launch, usually just a few messages. Message and data rates may apply. Reply STOP anytime to opt out.'

/** The full sentence as a person reads it. */
export const CONSENT_TEXT = CONSENT_LEAD

export const ERRORS = {
  phone: 'Enter a 10-digit US phone number.',
  phoneIntl: 'That number doesn’t look right. Check it and try again.',
  consent: 'Check the box so we can text you when Tab is ready.',
  captcha: 'We couldn’t confirm you’re a person. Try again in a moment.',
  rateLimited: 'Too many tries from this network. Give it a few minutes and try again.',
  unavailable: 'Sign-ups are down for a minute on our end. Please try again shortly.',
  network: 'Couldn’t reach us. Check your connection and try again.',
} as const
