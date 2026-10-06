import { randomInt, randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { DynamoConfig } from './env'
import { REF_CODE_ALPHABET, REF_CODE_LENGTH } from './referral-config'
import type { ListedItem, NewSignup, RankingRow, SignupRow, WaitlistItem } from './types'

/** The GSI on `ref_code` (KEYS_ONLY). Managed outside this code, like the table. */
export const REF_CODE_INDEX = 'by_ref_code'

export interface WaitlistStore {
  /** Writes a sign-up. If the phone number is already on the list nothing changes and `inserted` is false. */
  insertSignup(signup: NewSignup): Promise<{ inserted: boolean; row: SignupRow | null }>
  markNotified(phoneE164: string): Promise<void>
  /** The phone number that owns an invite code, or null. Server-only: never send it to the browser. */
  phoneForRefCode(code: string): Promise<string | null>
  /** The row's invite code, giving it one first (only if it has none) when it was made before referrals. Null if no row. */
  ensureRefCode(phoneE164: string): Promise<string | null>
  /** +1 friend for the referrer, atomically. */
  addReferral(referrerPhoneE164: string): Promise<void>
  /** -1 friend for the referrer (never below 0). For when someone they referred is deleted. */
  removeReferral(referrerPhoneE164: string): Promise<void>
  /** Deletes a row. Returns the invite code it joined with (`referred_by`), or `deleted: false` if there was no row. */
  deleteSignup(phoneE164: string): Promise<{ deleted: boolean; referredBy: string | null }>
  /** phone, created_at and referral_count for every row, for the ranking. */
  rankingRows(): Promise<RankingRow[]>
  /** Every row with the fields the admin page and export need (no IP hash, user agent or consent text). Read-only. */
  listItems(): Promise<ListedItem[]>
}

/** Attributes read by listItems. Everything goes through #names, since some (status) are reserved words. */
const LISTED_FIELDS = [
  'phone',
  'created_at',
  'status',
  'consent_version',
  'consent_at',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'signup_location',
  'ref_code',
  'referred_by',
  'referral_count',
] as const

function toListed(it: Record<string, unknown>): ListedItem | null {
  if (typeof it.phone !== 'string') return null
  const out: Record<string, unknown> = {}
  for (const f of LISTED_FIELDS) if (it[f] != null) out[f] = it[f]
  out.created_at = String(it.created_at ?? '')
  out.status = String(it.status ?? 'pending_confirmation')
  if (it.referral_count != null) out.referral_count = Number(it.referral_count) || 0
  return out as ListedItem
}

/** A random invite code from the unambiguous alphabet (unbiased: randomInt). */
export function newRefCode(): string {
  let code = ''
  for (let i = 0; i < REF_CODE_LENGTH; i++) code += REF_CODE_ALPHABET[randomInt(REF_CODE_ALPHABET.length)]
  return code
}

/**
 * A code no row uses yet. 31^8 codes make a clash vanishingly rare, but it is
 * still checked, with a fresh code on each retry. If the index can't be read
 * (say it is still being built) the code is used unchecked, with a warning.
 */
async function uniqueRefCode(store: WaitlistStore): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newRefCode()
    try {
      if (!(await store.phoneForRefCode(code))) return code
    } catch (err) {
      console.warn(`[waitlist] Could not check ref_code uniqueness on ${REF_CODE_INDEX}; using it unchecked.`, err)
      return code
    }
  }
  throw new Error('[waitlist] Could not find a free ref_code after 5 tries')
}

export function toItem(row: SignupRow): WaitlistItem {
  const created = row.createdAt.toISOString()
  const item: WaitlistItem = {
    phone: row.phoneE164,
    id: row.id,
    status: row.status,
    consent_text: row.consentText,
    consent_version: row.consentVersion,
    consent_at: row.consentAt.toISOString(),
    ip_hash: row.ipHash,
    created_at: created,
    updated_at: created,
  }
  const optional: [keyof WaitlistItem, string | null][] = [
    ['user_agent', row.userAgent],
    ['referrer', row.referrer],
    ['utm_source', row.utmSource],
    ['utm_medium', row.utmMedium],
    ['utm_campaign', row.utmCampaign],
    ['utm_term', row.utmTerm],
    ['utm_content', row.utmContent],
    ['signup_location', row.signupLocation],
  ]
  for (const [k, v] of optional) if (v) (item as unknown as Record<string, string>)[k] = v
  item.ref_code = row.refCode
  item.referral_count = row.referralCount
  if (row.referredBy) item.referred_by = row.referredBy
  return item
}

function newRow(s: NewSignup, refCode: string): SignupRow {
  return { ...s, id: randomUUID(), status: 'pending_confirmation', createdAt: new Date(), refCode, referralCount: 0 }
}

// One client per server instance (and per hot reload in dev).
const g = globalThis as unknown as { __tabDynamo?: { key: string; doc: DynamoDBDocumentClient }; __tabMemory?: MemoryStore }

function documentClient(cfg: DynamoConfig): DynamoDBDocumentClient {
  const key = `${cfg.region}:${cfg.accessKeyId}`
  if (!g.__tabDynamo || g.__tabDynamo.key !== key) {
    // Credentials are passed explicitly: on Vercel, ambient AWS_* values can exist that are not real credentials.
    const client = new DynamoDBClient({
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      maxAttempts: 3,
    })
    g.__tabDynamo = { key, doc: DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }) }
  }
  return g.__tabDynamo.doc
}

export class DynamoStore implements WaitlistStore {
  private doc: DynamoDBDocumentClient
  private table: string

  constructor(doc: DynamoDBDocumentClient, table: string) {
    this.doc = doc
    this.table = table
  }

  async insertSignup(s: NewSignup): Promise<{ inserted: boolean; row: SignupRow | null }> {
    const row = newRow(s, await uniqueRefCode(this))
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: toItem(row),
          // Never overwrite: a number that's already on the list stays exactly as it was.
          ConditionExpression: 'attribute_not_exists(phone)',
        }),
      )
      return { inserted: true, row }
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return { inserted: false, row: null }
      throw err
    }
  }

  async markNotified(phoneE164: string): Promise<void> {
    const now = new Date().toISOString()
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { phone: phoneE164 },
        UpdateExpression: 'SET notified_at = :now, updated_at = :now',
        ConditionExpression: 'attribute_exists(phone)',
        ExpressionAttributeValues: { ':now': now },
      }),
    )
  }

  async phoneForRefCode(code: string): Promise<string | null> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: REF_CODE_INDEX,
        KeyConditionExpression: 'ref_code = :c',
        ExpressionAttributeValues: { ':c': code },
        Limit: 1,
      }),
    )
    const phone = res.Items?.[0]?.phone
    return typeof phone === 'string' ? phone : null
  }

  async ensureRefCode(phoneE164: string): Promise<string | null> {
    const existing = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { phone: phoneE164 }, ProjectionExpression: 'ref_code', ConsistentRead: true }),
    )
    if (!existing.Item) return null
    if (typeof existing.Item.ref_code === 'string') return existing.Item.ref_code
    const code = await uniqueRefCode(this)
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { phone: phoneE164 },
          UpdateExpression: 'SET ref_code = :c, referral_count = if_not_exists(referral_count, :zero), updated_at = :now',
          // Only if it still has none, so two lookups at once can't hand out two codes.
          ConditionExpression: 'attribute_exists(phone) AND attribute_not_exists(ref_code)',
          ExpressionAttributeValues: { ':c': code, ':zero': 0, ':now': new Date().toISOString() },
        }),
      )
      return code
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err
      const again = await this.doc.send(
        new GetCommand({ TableName: this.table, Key: { phone: phoneE164 }, ProjectionExpression: 'ref_code', ConsistentRead: true }),
      )
      return typeof again.Item?.ref_code === 'string' ? again.Item.ref_code : null
    }
  }

  async addReferral(referrerPhoneE164: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { phone: referrerPhoneE164 },
        UpdateExpression: 'ADD referral_count :one SET updated_at = :now',
        ConditionExpression: 'attribute_exists(phone)',
        ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
      }),
    )
  }

  async removeReferral(referrerPhoneE164: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { phone: referrerPhoneE164 },
          UpdateExpression: 'ADD referral_count :minus SET updated_at = :now',
          ConditionExpression: 'attribute_exists(phone) AND referral_count > :zero',
          ExpressionAttributeValues: { ':minus': -1, ':zero': 0, ':now': new Date().toISOString() },
        }),
      )
    } catch (err) {
      // Referrer gone, or already at 0: nothing to take back.
      if (!(err instanceof ConditionalCheckFailedException)) throw err
    }
  }

  async deleteSignup(phoneE164: string): Promise<{ deleted: boolean; referredBy: string | null }> {
    const res = await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { phone: phoneE164 }, ReturnValues: 'ALL_OLD' }),
    )
    if (!res.Attributes) return { deleted: false, referredBy: null }
    const by = res.Attributes.referred_by
    return { deleted: true, referredBy: typeof by === 'string' && by ? by : null }
  }

  async rankingRows(): Promise<RankingRow[]> {
    const rows: RankingRow[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: '#p, created_at, referral_count',
          ExpressionAttributeNames: { '#p': 'phone' },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      )
      for (const it of page.Items ?? []) {
        if (typeof it.phone !== 'string') continue
        rows.push({ phone: it.phone, createdAt: String(it.created_at ?? ''), referralCount: Number(it.referral_count ?? 0) || 0 })
      }
      start = page.LastEvaluatedKey
    } while (start)
    return rows
  }

  async listItems(): Promise<ListedItem[]> {
    const names = Object.fromEntries(LISTED_FIELDS.map((f, i) => [`#f${i}`, f]))
    const items: ListedItem[] = []
    let start: Record<string, unknown> | undefined
    do {
      const page = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: Object.keys(names).join(', '),
          ExpressionAttributeNames: names,
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      )
      for (const it of page.Items ?? []) {
        const listed = toListed(it)
        if (listed) items.push(listed)
      }
      start = page.LastEvaluatedKey
    } while (start)
    return items
  }
}

/** Dev-only stand-in so the site runs without AWS. Lost on restart. */
class MemoryStore implements WaitlistStore {
  private rows = new Map<string, SignupRow>()

  async insertSignup(s: NewSignup): Promise<{ inserted: boolean; row: SignupRow | null }> {
    if (this.rows.has(s.phoneE164)) return { inserted: false, row: null }
    const row = newRow(s, await uniqueRefCode(this))
    this.rows.set(s.phoneE164, row)
    console.warn(`[waitlist] DEV FALLBACK: stored sign-up ${row.id} in memory (${this.rows.size} total). Not persisted.`)
    return { inserted: true, row }
  }

  async markNotified(): Promise<void> {}

  async phoneForRefCode(code: string): Promise<string | null> {
    for (const row of this.rows.values()) if (row.refCode === code) return row.phoneE164
    return null
  }

  async ensureRefCode(phoneE164: string): Promise<string | null> {
    return this.rows.get(phoneE164)?.refCode ?? null
  }

  async addReferral(referrerPhoneE164: string): Promise<void> {
    const row = this.rows.get(referrerPhoneE164)
    if (row) row.referralCount += 1
  }

  async removeReferral(referrerPhoneE164: string): Promise<void> {
    const row = this.rows.get(referrerPhoneE164)
    if (row && row.referralCount > 0) row.referralCount -= 1
  }

  async deleteSignup(phoneE164: string): Promise<{ deleted: boolean; referredBy: string | null }> {
    const row = this.rows.get(phoneE164)
    if (!row) return { deleted: false, referredBy: null }
    this.rows.delete(phoneE164)
    return { deleted: true, referredBy: row.referredBy }
  }

  async rankingRows(): Promise<RankingRow[]> {
    return [...this.rows.values()].map((r) => ({ phone: r.phoneE164, createdAt: r.createdAt.toISOString(), referralCount: r.referralCount }))
  }

  async listItems(): Promise<ListedItem[]> {
    return [...this.rows.values()].map((r) => toListed(toItem(r) as unknown as Record<string, unknown>)!)
  }
}

export function getStore(dynamo: DynamoConfig | null): WaitlistStore {
  if (dynamo) return new DynamoStore(documentClient(dynamo), dynamo.table)
  if (!g.__tabMemory) g.__tabMemory = new MemoryStore()
  return g.__tabMemory
}
