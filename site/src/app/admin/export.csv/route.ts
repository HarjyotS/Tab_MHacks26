// /admin/export.csv: the same CSV as `npm run waitlist:export`, plus each row's
// real position. Behind the same Basic auth as /admin (proxy, and checked here too).
import { ADMIN_HEADERS, ADMIN_REALM, adminAccess } from '@/lib/admin/auth'
import { rankItems } from '@/lib/admin/data'
import { dayKey } from '@/lib/admin/stats'
import { pageStore } from '@/lib/waitlist/server'
import { COLUMNS, toCsv } from '../../../../scripts/export-waitlist'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function plain(status: number, body: string, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra } })
}

export async function GET(request: Request) {
  const access = adminAccess(request.headers.get('authorization'))
  if (access === 'disabled') return plain(404, 'Not found.')
  if (access === 'unauthorized') {
    return plain(401, 'Authentication required.', { 'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"` })
  }

  const store = pageStore()
  if (!store) return plain(503, 'Waitlist storage is misconfigured. See the function logs.')

  try {
    const items = await store.listItems()
    const ranking = rankItems(items)
    const rows = items.map((it) => ({ ...it, position: ranking.get(it.phone)?.position ?? '' }))
    const csv = toCsv(rows, [...COLUMNS, 'position'])
    return new Response(csv, {
      headers: {
        ...ADMIN_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tab-waitlist-${dayKey(new Date())}.csv"`,
      },
    })
  } catch (err) {
    // Only the error's name and message: never row contents, so no phone numbers in the logs.
    console.error('[admin] CSV export failed', err instanceof Error ? `${err.name}: ${err.message}` : err)
    return plain(500, 'Could not read the waitlist table. Check the function logs.')
  }
}
