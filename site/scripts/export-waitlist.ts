// Prints the waitlist as CSV: phone, created_at, status, utm_source.
//
//   npm run waitlist:export > waitlist.csv
//
// Reads AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and WAITLIST_TABLE
// (default tab-waitlist) from the environment or site/.env.local. Read-only:
// it only Scans the table. Runs on Node's built-in TypeScript support (Node 22.18+).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'

const COLUMNS = ['phone', 'created_at', 'status', 'utm_source'] as const

export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote when needed, and defuse spreadsheet formulas (=, +, -, @) except for E.164 phone numbers.
  const safe = /^[=+\-@]/.test(s) && !/^\+\d{8,15}$/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(items: Record<string, unknown>[]): string {
  const sorted = [...items].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return [COLUMNS.join(','), ...sorted.map((it) => COLUMNS.map((c) => csvCell(it[c])).join(','))].join('\n') + '\n'
}

async function main() {
  const region = process.env.AWS_REGION
  const table = process.env.WAITLIST_TABLE || 'tab-waitlist'
  if (!region || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Set AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (in the environment or site/.env.local).')
    process.exit(1)
  }
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
  const items: Record<string, unknown>[] = []
  let start: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: '#p, created_at, #s, utm_source',
        ExpressionAttributeNames: { '#p': 'phone', '#s': 'status' },
        ExclusiveStartKey: start,
      }),
    )
    items.push(...((page.Items ?? []) as Record<string, unknown>[]))
    start = page.LastEvaluatedKey
  } while (start)
  process.stdout.write(toCsv(items))
  console.error(`${items.length} sign-ups exported from ${table}.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Export failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
