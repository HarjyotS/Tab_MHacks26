/** True on the internal /admin pages (browser only). Analytics and Lenis stay off there. */
export function isAdminPath(): boolean {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname
  return p === '/admin' || p.startsWith('/admin/')
}
