import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import 'lenis/dist/lenis.css'
import './globals.css'
import { SmoothScroll } from '@/components/client/SmoothScroll'
import { Analytics } from '@/components/client/Analytics'
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION } from '@/lib/site'

// One variable file covers every weight the hero uses, so only it is preloaded.
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap', preload: true })
// Monospace only appears below the fold (receipts), so it is not preloaded.
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap', preload: false })

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: 'Tab',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Tab',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks that JavaScript runs, before first paint, so JS-only states (collapsed FAQ) never flash. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <SmoothScroll />
        <Analytics />
      </body>
    </html>
  )
}
