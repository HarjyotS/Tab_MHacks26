'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import s from '@/app/admin/admin.module.css'
import { deleteSignups } from '@/app/admin/actions'
import type { AdminRow } from '@/lib/admin/data'

type SortKey = 'position' | 'phone' | 'joined' | 'status' | 'referralCount' | 'referredBy' | 'refCode' | 'source' | 'consentVersion'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'position', label: 'Position', numeric: true },
  { key: 'phone', label: 'Phone' },
  { key: 'joined', label: 'Joined' },
  { key: 'status', label: 'Status' },
  { key: 'referralCount', label: 'Referrals', numeric: true },
  { key: 'referredBy', label: 'Referred by' },
  { key: 'refCode', label: 'Ref code' },
  { key: 'source', label: 'Source' },
  { key: 'consentVersion', label: 'Consent' },
]

function sortValue(r: AdminRow, key: SortKey): string | number {
  switch (key) {
    case 'position':
      return r.position
    case 'phone':
      return r.phone
    case 'joined':
      return r.createdAt
    case 'status':
      return r.status
    case 'referralCount':
      return r.referralCount
    case 'referredBy':
      return r.referredByCode
    case 'refCode':
      return r.refCode
    case 'source':
      return r.source
    case 'consentVersion':
      return r.consentVersion
  }
}

/** Matches the row's own phone (for phone-like queries) or either code. */
function matches(r: AdminRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (r.refCode.includes(q) || r.referredByCode.includes(q)) return true
  const digits = q.replace(/\D/g, '')
  const phoneLike = digits.length > 0 && /^[\d\s()+\-.]+$/.test(q)
  return phoneLike && r.phone.includes(digits)
}

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: 'pending',
  confirmed: 'confirmed',
  opted_out: 'opted out',
}

function Status({ value }: { value: string }) {
  return <span className={`${s.status} ${s[`status_${value}`] ?? ''}`}>{STATUS_LABEL[value] ?? value}</span>
}

export function AdminTables({ rows, topReferrers }: { rows: AdminRow[]; topReferrers: AdminRow[] }) {
  const [showFull, setShowFull] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'position', dir: 'asc' })
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, startDelete] = useTransition()
  const router = useRouter()

  // Only rows still on the list count (a refresh may have removed some).
  const selected = useMemo(() => rows.filter((r) => picked.has(r.phone)), [rows, picked])

  const phone = (r: AdminRow) => (showFull ? r.phoneFull : r.phoneMasked)

  const visible = useMemo(() => {
    const out = rows.filter((r) => matches(r, query))
    const sign = sort.dir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return c * sign || a.position - b.position
    })
    return out
  }, [rows, query, sort])

  const allVisiblePicked = visible.length > 0 && visible.every((r) => picked.has(r.phone))
  const togglePick = (phone: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
  const toggleAllVisible = () =>
    setPicked((cur) => {
      const next = new Set(cur)
      for (const r of visible) {
        if (allVisiblePicked) next.delete(r.phone)
        else next.add(r.phone)
      }
      return next
    })
  const runDelete = () =>
    startDelete(async () => {
      const res = await deleteSignups(selected.map((r) => r.phone))
      setConfirming(false)
      if (res.ok) {
        setPicked(new Set())
        setNotice({ kind: 'ok', text: `Deleted ${res.deleted} sign-up${res.deleted === 1 ? '' : 's'}.` })
        router.refresh()
      } else {
        setNotice({ kind: 'error', text: res.error })
      }
    })

  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'referralCount' ? 'desc' : 'asc' }))

  return (
    <>
      <section className={s.section} aria-labelledby="adm-top">
        <div className={s.sectionHead}>
          <h2 id="adm-top" className={s.h2}>
            Top referrers <span className={s.count}>{topReferrers.length ? `top ${topReferrers.length}` : 'none yet'}</span>
          </h2>
          <label className={s.check}>
            <input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} />
            Show full numbers
          </label>
        </div>
        {topReferrers.length > 0 ? (
          <div className={`${s.tableScroll} ${s.fit}`}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col" className={s.num}>
                    Rank
                  </th>
                  <th scope="col">Phone</th>
                  <th scope="col">Ref code</th>
                  <th scope="col" className={s.num}>
                    Referrals
                  </th>
                  <th scope="col" className={s.num}>
                    Position
                  </th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {topReferrers.map((r, i) => (
                  <tr key={r.phone}>
                    <td className={s.num}>{i + 1}</td>
                    <td className={`${s.mono} ${s.nowrap}`}>{phone(r)}</td>
                    <td className={s.mono}>{r.refCode}</td>
                    <td className={s.num}>{r.referralCount}</td>
                    <td className={s.num}>#{r.position}</td>
                    <td className={s.nowrap}>{r.joined}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.empty}>Nobody has brought a friend yet.</p>
        )}
      </section>

      <section className={s.section} aria-labelledby="adm-all">
        <div className={s.sectionHead}>
          <h2 id="adm-all" className={s.h2}>
            All sign-ups{' '}
            <span className={s.count}>
              {visible.length === rows.length ? rows.length : `${visible.length} of ${rows.length}`}
            </span>
          </h2>
          <label className={s.search}>
            <span className="sr-only">Search by phone or code</span>
            <input
              type="search"
              placeholder="Search phone or code"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <div className={s.bulk} role="region" aria-label="Delete sign-ups">
          {confirming && selected.length > 0 ? (
            <>
              <span className={s.bulkWarn}>
                Delete {selected.length} sign-up{selected.length === 1 ? '' : 's'} for good? This can&apos;t be undone.
              </span>
              <button type="button" className={`${s.button} ${s.danger}`} onClick={runDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className={s.ghost} onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${s.button} ${s.danger}`}
                onClick={() => {
                  setNotice(null)
                  setConfirming(true)
                }}
                disabled={selected.length === 0}
              >
                Delete selected{selected.length ? ` (${selected.length})` : ''}
              </button>
              {selected.length > 0 && (
                <button type="button" className={s.ghost} onClick={() => setPicked(new Set())}>
                  Clear selection
                </button>
              )}
              <span className={s.muted}>Tick rows to delete them. A friend who invited them loses that referral credit.</span>
            </>
          )}
          {notice && (
            <span className={notice.kind === 'ok' ? s.bulkOk : s.bulkWarn} role="status">
              {notice.text}
            </span>
          )}
        </div>
        <div className={s.tableScroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col" className={s.pick}>
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allVisiblePicked}
                    onChange={toggleAllVisible}
                    disabled={visible.length === 0}
                  />
                </th>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={c.numeric ? s.num : undefined}
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={s.sortBtn} onClick={() => toggleSort(c.key)}>
                        {c.label}
                        <span className={s.sortMark} aria-hidden="true">
                          {active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.phone} className={picked.has(r.phone) ? s.picked : undefined}>
                  <td className={s.pick}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.phoneMasked}`}
                      checked={picked.has(r.phone)}
                      onChange={() => togglePick(r.phone)}
                    />
                  </td>
                  <td className={s.num}>#{r.position}</td>
                  <td className={`${s.mono} ${s.nowrap}`}>{phone(r)}</td>
                  <td className={s.nowrap}>{r.joined}</td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td className={s.num}>{r.referralCount}</td>
                  <td className={`${s.mono} ${s.nowrap}`}>
                    {r.referredByCode ? (
                      r.referredByFull ? (
                        <span title={`code ${r.referredByCode}`}>{showFull ? r.referredByFull : r.referredByMasked}</span>
                      ) : (
                        r.referredByCode
                      )
                    ) : (
                      <span className={s.muted}>direct</span>
                    )}
                  </td>
                  <td className={s.mono}>{r.refCode || <span className={s.muted}>none</span>}</td>
                  <td className={s.ellipsis} title={r.source || undefined}>
                    {r.source || <span className={s.muted}>none</span>}
                  </td>
                  <td className={`${s.mono} ${s.nowrap}`}>{r.consentVersion}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className={s.empty}>
                    {rows.length ? 'No sign-ups match that search.' : 'No sign-ups yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
