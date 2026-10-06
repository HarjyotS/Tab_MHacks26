'use client'

import { useEffect } from 'react'
import { analyticsEnabled, startAnalytics, track } from '@/lib/analytics'

/** Page view (via PostHog), scroll depth milestones and one event per section seen. */
export function Analytics() {
  useEffect(() => {
    if (!analyticsEnabled()) return

    const begin = () => void startAnalytics()
    if ('requestIdleCallback' in window) window.requestIdleCallback(begin, { timeout: 3000 })
    else setTimeout(begin, 1500)

    const milestones = [25, 50, 75, 100]
    const hit = new Set<number>()
    let frame = 0
    const measure = () => {
      frame = 0
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      const pct = max <= 0 ? 100 : (window.scrollY / max) * 100
      for (const m of milestones) {
        if (pct >= m - 0.5 && !hit.has(m)) {
          hit.add(m)
          track('scroll_depth', { percent: m })
        }
      }
      if (hit.size === milestones.length) window.removeEventListener('scroll', onScroll)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    const seen = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const name = (e.target as HTMLElement).dataset.section
          if (!name || seen.has(name)) continue
          seen.add(name)
          track('section_viewed', { section: name })
          io.unobserve(e.target)
        }
      },
      // Counts a section once it crosses the middle band of the screen.
      { rootMargin: '-45% 0px -45% 0px' },
    )
    document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => io.observe(el))

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      io.disconnect()
    }
  }, [])
  return null
}
