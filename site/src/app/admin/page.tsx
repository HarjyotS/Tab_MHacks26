import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { AdminTables } from '@/components/admin/AdminTables'
import { SignupsChart } from '@/components/admin/SignupsChart'
import { adminAccess, canSeeAdmin } from '@/lib/admin/auth'
import { loadAdminData, type AdminData } from '@/lib/admin/data'
import { SPOTS_PER_REFERRAL } from '@/lib/waitlist/referral-config'
import { getWaitlistConfig } from '@/lib/waitlist/env'
import { getStore } from '@/lib/waitlist/store'
import s from './admin.module.css'

// Internal. Rendered per request on the server; nothing is cached or prerendered.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Tab admin',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

const pct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })
const int = new Intl.NumberFormat('en-US')

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className={s.stat}>
      <dt className={s.statLabel}>{label}</dt>
      <dd className={s.statValue}>{typeof value === 'number' ? int.format(value) : value}</dd>
      {note && <dd className={s.statNote}>{note}</dd>}
    </div>
  )
}

function Counts({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className={s.card}>
      <h3 className={s.h3}>{title}</h3>
      {rows.length ? (
        <table className={s.mini}>
          <tbody>
            {rows.map(([k, n]) => (
              <tr key={k}>
                <td className={s.ellipsis} title={k}>
                  {k}
                </td>
                <td className={s.num}>{int.format(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={s.empty}>Nothing yet.</p>
      )}
    </div>
  )
}

async function load(): Promise<{ data: AdminData; memory: boolean } | { error: string }> {
  const config = getWaitlistConfig()
  if (!config.ok) return { error: `Waitlist storage is misconfigured: missing ${config.missing.join(', ')}.` }
  try {
    return { data: await loadAdminData(getStore(config.config.dynamo)), memory: config.config.dynamo === null }
  } catch (err) {
    // The error never includes row contents, so no phone numbers reach the logs.
    console.error('[admin] Could not load the waitlist', err instanceof Error ? err.name + ': ' + err.message : err)
    return { error: 'Could not read the waitlist table. Check the function logs.' }
  }
}

export default async function AdminPage() {
  // Checked again here (the proxy already did), so data is never rendered without access.
  const access = adminAccess((await headers()).get('authorization'))
  if (!canSeeAdmin(access)) notFound()

  const result = await load()

  return (
    <main id="main" className={s.page}>
      <header className={s.header}>
        <div className={s.brand}>
          <span className="mark mark--sm" aria-hidden="true" />
          <h1 className={s.h1}>Tab admin</h1>
          <span className={s.tag}>Waitlist</span>
        </div>
        <nav className={s.headerLinks} aria-label="Admin">
          <a href="/admin/export.csv" download>
            Download CSV
          </a>
          <a href="/admin">Refresh</a>
        </nav>
      </header>

      {access === 'open-dev' && (
        <p className={s.warn} role="alert">
          ADMIN_USER and ADMIN_PASSWORD are not set, so this page is open with no password. That only happens under{' '}
          <code>next dev</code>; anywhere else /admin is a 404 until both are set.
        </p>
      )}
      {'data' in result && result.memory && (
        <p className={s.note}>Showing the dev in-memory list (no AWS keys set). It is lost on restart.</p>
      )}

      {'error' in result ? (
        <p className={s.warn} role="alert">
          {result.error}
        </p>
      ) : (
        <Dashboard data={result.data} />
      )}
    </main>
  )
}

function Dashboard({ data }: { data: AdminData }) {
  const m = data.summary
  return (
    <>
      <section className={s.tiles} aria-label="Summary">
        <div className={s.group}>
          <h2 className={s.groupTitle}>Sign-ups</h2>
          <dl className={`${s.groupStats} ${s.four}`}>
            <Stat label="Total" value={m.total} />
            <Stat label="Today" value={m.today} />
            <Stat label="Last 7 days" value={m.last7} />
            <Stat label="Last 30 days" value={m.last30} />
          </dl>
        </div>
        <div className={s.group}>
          <h2 className={s.groupTitle}>Referrals</h2>
          <dl className={`${s.groupStats} ${s.four}`}>
            <Stat label="Referred" value={m.referred} />
            <Stat label="Direct" value={m.direct} />
            <Stat label="Referral rate" value={pct.format(m.referralRate)} />
            <Stat label="Credits" value={m.credits} note={`${SPOTS_PER_REFERRAL} spots each`} />
          </dl>
        </div>
        <div className={s.group}>
          <h2 className={s.groupTitle}>Status</h2>
          <dl className={s.groupStats}>
            <Stat label="Pending" value={m.pending} />
            <Stat label="Confirmed" value={m.confirmed} />
            <Stat label="Opted out" value={m.optedOut} note={m.otherStatus ? `${m.otherStatus} other` : undefined} />
          </dl>
        </div>
      </section>

      <section className={s.section} aria-labelledby="adm-chart">
        <h2 id="adm-chart" className={s.h2}>
          Sign-ups per day <span className={s.count}>last 30 days, {int.format(m.last30)} total</span>
        </h2>
        <SignupsChart days={m.perDay} />
      </section>

      <AdminTables rows={data.rows} topReferrers={data.topReferrers} />

      <section className={s.section} aria-labelledby="adm-sources">
        <h2 id="adm-sources" className={s.h2}>
          Sources
        </h2>
        <div className={s.sources}>
          <Counts title="By utm_source" rows={m.utmSources} />
          <Counts title="By referrer host" rows={m.referrerHosts} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="adm-export">
        <h2 id="adm-export" className={s.h2}>
          Export
        </h2>
        <p className={s.exportRow}>
          <a className={s.button} href="/admin/export.csv" download>
            Download CSV
          </a>
          <span className={s.muted}>
            phone, created_at, status, utm_source, ref_code, referred_by, referral_count, position. Oldest first.
          </span>
        </p>
      </section>

      <footer className={s.footer}>
        <span>
          Data as of <time dateTime={data.asOf}>{data.asOfLabel}</time>
        </span>
        <a href="/admin">Refresh</a>
      </footer>
    </>
  )
}
