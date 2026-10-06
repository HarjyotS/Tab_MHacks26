// Next.js 16 Proxy (the renamed `middleware.ts`). Only runs on /admin: HTTP Basic
// auth against ADMIN_USER / ADMIN_PASSWORD, and a 404 when they aren't set
// outside local dev. See src/lib/admin/auth.ts.

import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_HEADERS, ADMIN_REALM, adminAccess } from '@/lib/admin/auth'

function withAdminHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) res.headers.set(k, v)
  return res
}

export function proxy(request: NextRequest) {
  const access = adminAccess(request.headers.get('authorization'))

  if (access === 'disabled') {
    // Renders the site's normal 404 page, so a disabled /admin looks like any missing page.
    return withAdminHeaders(NextResponse.rewrite(new URL('/_admin-disabled', request.url), { status: 404 }))
  }
  if (access === 'unauthorized') {
    return withAdminHeaders(
      new NextResponse('Authentication required.', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      }),
    )
  }
  return withAdminHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
