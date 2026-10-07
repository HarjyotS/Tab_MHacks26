import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

export const alt = 'Tab: Your group chat keeps the tab now.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Link preview (iMessage, Slack, X) built from the hero: the Tab mark and the
 * headline, big enough to read in a small chat bubble, plus the "got dinner"
 * message and Tab's quiet log line from the design.
 */
export default async function OpenGraphImage() {
  const dir = join(process.cwd(), 'src/og-fonts')
  const [bold, medium] = await Promise.all([readFile(join(dir, 'Geist-Bold.ttf')), readFile(join(dir, 'Geist-Medium.ttf'))])
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#FFFFFF',
          color: '#1C1A17',
          padding: '64px 72px',
          fontFamily: 'Geist',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 38, height: 48, background: '#FF5B1F', borderRadius: '7px 7px 0 0' }} />
          <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: '-0.04em' }}>tab</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ display: 'flex', fontSize: 104, fontWeight: 700, lineHeight: 0.92, letterSpacing: '-0.055em', maxWidth: 700 }}>
            Your group chat keeps the tab now.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, marginBottom: 10 }}>
            <div
              style={{
                display: 'flex',
                background: '#0A6EE0',
                color: '#FFFFFF',
                padding: '16px 24px',
                borderRadius: 30,
                fontSize: 30,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              got dinner for everyone, $84
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, color: '#4A4640', fontWeight: 500, paddingRight: 8 }}>
              <div style={{ width: 13, height: 16, background: '#FF5B1F', borderRadius: '3px 3px 0 0' }} />
              Tab logged $84.00
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: bold, weight: 700, style: 'normal' },
        { name: 'Geist', data: medium, weight: 500, style: 'normal' },
      ],
    },
  )
}
