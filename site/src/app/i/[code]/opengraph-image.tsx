import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

export const alt = 'You’re invited to the Tab waitlist'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * The invite link preview, made to read at a glance in an iMessage bubble:
 * one big line, high contrast, everything well inside the edges. The same
 * image for every code, so it says nothing about who sent it.
 */
export default async function InviteImage() {
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
          background: '#F7F6F2',
          color: '#1C1A17',
          padding: '72px 96px',
          fontFamily: 'Geist',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
          {/* The Tab mark at the site's proportions: 22 x 28, top radius 4/22 of the width, flat base. */}
          <div style={{ width: 44, height: 56, background: '#FF5B1F', borderRadius: '8px 8px 0 0' }} />
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 0.8 }}>tab</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 164, fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.06em' }}>You’re invited</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 64, fontWeight: 500, letterSpacing: '-0.035em', color: '#4A4640' }}>
            to the Tab waitlist
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 500, color: '#4A4640', letterSpacing: '-0.01em' }}>
            Your group chat keeps the tab now.
          </div>
          <div
            style={{
              display: 'flex',
              background: '#1C1A17',
              color: '#FFFFFF',
              padding: '14px 26px',
              borderRadius: 999,
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            addtab.app
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
