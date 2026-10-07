import s from '@/app/admin/admin.module.css'

type Day = { day: string; count: number }

const M = { top: 14, right: 12, bottom: 44, left: 40 }

/** One viewBox per breakpoint, so labels stay about 11 to 14px wide on any screen. */
const SIZES = [
  { key: 'sm', w: 340, h: 220, labelEvery: 7 },
  { key: 'md', w: 760, h: 240, labelEvery: 5 },
  { key: 'lg', w: 1160, h: 230, labelEvery: 3 },
] as const

const labelFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

function dayDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** A y-axis top and step giving about four gridlines at round numbers. */
function yScale(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 }
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw)!
  return { top: Math.ceil(max / step) * step, step }
}

/** A bar with 4px rounded top corners, anchored flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function Plot({ days, w, h, labelEvery, className }: { days: Day[]; w: number; h: number; labelEvery: number; className: string }) {
  const plotW = w - M.left - M.right
  const plotH = h - M.top - M.bottom
  const max = Math.max(0, ...days.map((d) => d.count))
  const { top, step } = yScale(max)
  const band = plotW / days.length
  const barW = Math.max(2, Math.min(28, band - 4))
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const total = days.reduce((a, d) => a + d.count, 0)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label={`Sign-ups per day for the last ${days.length} days, ${total} in total, peak ${max} in a day.`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={w - M.right} y1={y(v)} y2={y(v)} className={v === 0 ? s.axisLine : s.gridLine} />
          <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className={s.tick}>
            {v}
          </text>
        </g>
      ))}
      <text transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`} textAnchor="middle" className={s.axisTitle}>
        Sign-ups
      </text>

      {days.map((d, i) => {
        const x = M.left + i * band
        const fromEnd = days.length - 1 - i
        const showLabel = fromEnd % labelEvery === 0
        return (
          <g key={d.day} className={s.barGroup}>
            <title>{`${longFmt.format(dayDate(d.day))}: ${d.count} sign-up${d.count === 1 ? '' : 's'}`}</title>
            {/* Full-height hit area so the tooltip works on short and empty days too. */}
            <rect x={x} y={M.top} width={band} height={plotH} className={s.barHit} />
            {d.count > 0 && <path d={barPath(x + (band - barW) / 2, y(d.count), barW, (d.count / top) * plotH)} className={s.bar} />}
            {showLabel && (
              <text x={x + band / 2} y={M.top + plotH + 16} textAnchor="middle" className={s.tick}>
                {labelFmt.format(dayDate(d.day))}
              </text>
            )}
          </g>
        )
      })}
      <text x={M.left + plotW / 2} y={h - 6} textAnchor="middle" className={s.axisTitle}>
        Day (America/Detroit)
      </text>
    </svg>
  )
}

/** Sign-ups per day, last 30 days. Inline SVG, one series, bars in --accent. */
export function SignupsChart({ days }: { days: Day[] }) {
  return (
    <figure className={s.chart}>
      {SIZES.map((z) => (
        <Plot key={z.key} days={days} w={z.w} h={z.h} labelEvery={z.labelEvery} className={`${s.chartSvg} ${s[`chart_${z.key}`]}`} />
      ))}
      <details className={s.chartTable}>
        <summary>Show as a table</summary>
        <table className={s.mini}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className={s.num}>
                Sign-ups
              </th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{longFmt.format(dayDate(d.day))}</td>
                <td className={s.num}>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
