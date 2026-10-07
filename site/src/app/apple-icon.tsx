import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// The design's Tab mark on white, for home screens and iMessage contact cards.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: '#FFFFFF' }}>
        <div style={{ width: 92, height: 117, background: '#FF5B1F', borderRadius: '16px 16px 0 0', marginBottom: 32 }} />
      </div>
    ),
    size,
  )
}
