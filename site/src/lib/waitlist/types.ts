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
  /** The referrer's ref_code, only when it resolved to a real row that isn't this number. */
  referredBy: string | null
}

export interface SignupRow extends NewSignup {
  id: string
  status: WaitlistStatus
  createdAt: Date
  /** This person's own invite code (8 chars, see referral-config.ts). */
  refCode: string
  referralCount: number
}

/** What the ranking needs from each row (one Scan, see position.ts). */
export interface RankingRow {
  phone: string
  createdAt: string
  referralCount: number
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
  /** Unique invite code, also the hash key of the `by_ref_code` GSI. Older rows get one lazily. */
  ref_code?: string
  /** ref_code of the person whose invite link brought them, if any. */
  referred_by?: string
  /** Friends who joined with this person's link. Incremented atomically with ADD. */
  referral_count?: number
  created_at: string
  updated_at: string
  notified_at?: string
}
