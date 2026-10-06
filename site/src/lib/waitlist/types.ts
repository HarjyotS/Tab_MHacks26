export type WaitlistStatus = 'pending_confirmation' | 'confirmed' | 'opted_out'

export interface NewSignup {
  phoneE164: string
  consentText: string
  consentVersion: string
  consentAt: Date
  ipHash: string
  userAgent: string | null
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  signupLocation: string | null
}

export interface SignupRow extends NewSignup {
  id: string
  status: WaitlistStatus
  createdAt: Date
}

/** The DynamoDB item, one per phone number (partition key `phone`). */
export interface WaitlistItem {
  phone: string
  id: string
  status: WaitlistStatus
  consent_text: string
  consent_version: string
  consent_at: string
  ip_hash: string
  user_agent?: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  signup_location?: string
  created_at: string
  updated_at: string
  notified_at?: string
}
