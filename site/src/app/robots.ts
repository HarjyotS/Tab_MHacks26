import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    // /admin is internal (Basic auth, noindex). The sitemap never lists it.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
