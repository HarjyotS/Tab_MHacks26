import { FAQ } from '@/content/faq'
import { SITE_DESCRIPTION, SITE_URL } from './site'

/** schema.org JSON-LD for the home page: the app itself, and the FAQ built from the same data as the page. */
export function homeJsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Tab',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'iOS',
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ]
}

/** Serialized for a <script type="application/ld+json">, with "<" escaped so text can't close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
