'use client'

import { useEffect } from 'react'
import { isPhoneWidth, prefersReducedMotion } from '@/lib/motion-prefs'

/**
 * The hero's waitlist card lifts a little and gains a soft shadow as the page
 * starts to scroll. Transform and opacity only; will-change only while moving.
 */
export function HeroFloat({ target }: { target: string }) {
  useEffect(() => {
    if (prefersReducedMotion()) return
    const el = document.getElementById(target)
    if (!el) return
    const lift = isPhoneWidth() ? 10 : 22
    let frame = 0
    let idle: ReturnType<typeof setTimeout> | undefined
    const apply = () => {
      frame = 0
      const p = Math.min(1, Math.max(0, window.scrollY / 420))
      el.style.transform = p ? `translate3d(0, ${(-lift * p).toFixed(2)}px, 0)` : ''
      el.style.setProperty('--float', p.toFixed(3))
    }
    const onScroll = () => {
      if (window.scrollY > 900 && !el.style.transform) return
      el.style.willChange = 'transform'
      clearTimeout(idle)
      idle = setTimeout(() => (el.style.willChange = ''), 200)
      if (!frame) frame = requestAnimationFrame(apply)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    apply()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(idle)
      el.style.transform = ''
      el.style.willChange = ''
    }
  }, [target])
  return null
}
