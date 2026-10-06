import { randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { DynamoConfig } from './env'
import type { NewSignup, SignupRow, WaitlistItem } from './types'

export interface WaitlistStore {
  /** Writes a sign-up. If the phone number is already on the list nothing changes and `inserted` is false. */
  insertSignup(signup: NewSignup): Promise<{ inserted: boolean; row: SignupRow | null }>
  markNotified(phoneE164: string): Promise<void>
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
  return item
}

function newRow(s: NewSignup): SignupRow {
  return { ...s, id: randomUUID(), status: 'pending_confirmation', createdAt: new Date() }
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
    const row = newRow(s)
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
}

/** Dev-only stand-in so the site runs without AWS. Lost on restart. */
class MemoryStore implements WaitlistStore {
  private rows = new Map<string, SignupRow>()

  async insertSignup(s: NewSignup): Promise<{ inserted: boolean; row: SignupRow | null }> {
    if (this.rows.has(s.phoneE164)) return { inserted: false, row: null }
    const row = newRow(s)
    this.rows.set(s.phoneE164, row)
    console.warn(`[waitlist] DEV FALLBACK: stored sign-up ${row.id} in memory (${this.rows.size} total). Not persisted.`)
    return { inserted: true, row }
  }

  async markNotified(): Promise<void> {}
}

export function getStore(dynamo: DynamoConfig | null): WaitlistStore {
  if (dynamo) return new DynamoStore(documentClient(dynamo), dynamo.table)
  if (!g.__tabMemory) g.__tabMemory = new MemoryStore()
  return g.__tabMemory
}
