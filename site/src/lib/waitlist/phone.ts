import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

export type PhoneResult = { ok: true; e164: string; display: string } | { ok: false; international: boolean }

/** Validates and normalizes a phone number to E.164. Numbers without a + are read as US. */
export function normalizePhone(raw: string): PhoneResult {
  const input = String(raw ?? '').trim().slice(0, 40)
  const international = input.startsWith('+') && !input.startsWith('+1')
  if (!input) return { ok: false, international: false }
  const parsed = parsePhoneNumberFromString(input, 'US')
  if (!parsed || !parsed.isValid()) return { ok: false, international }
  const type = parsed.getType()
  // A waitlist number has to receive texts, so landlines and premium lines are out.
  if (type === 'FIXED_LINE' || type === 'PREMIUM_RATE' || type === 'TOLL_FREE' || type === 'SHARED_COST' || type === 'VOICEMAIL') {
    return { ok: false, international }
  }
  return {
    ok: true,
    e164: parsed.number,
    display: parsed.country === 'US' ? parsed.formatNational() : parsed.formatInternational(),
  }
}
