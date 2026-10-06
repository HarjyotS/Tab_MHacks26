'use client'

import { useEffect } from 'react'
import { isTouchFirst, prefersReducedMotion } from '@/lib/motion-prefs'
import { onFirstInteraction } from '@/lib/interaction'

/**
 * Lenis smooth scrolling for mouse and trackpad, driven by GSAP's ticker so
 * ScrollTrigger and Lenis share one clock. Not loaded at all on touch-first
 * devices (native momentum scrolling is better) or with reduced motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion() || isTouchFirst()) return
    let cleanup: (() => void) | undefined
    let cancelled = false

    const start = async () => {
      const [{ default: Lenis }, { gsap, ScrollTrigger }] = await Promise.all([import('lenis'), import('@/lib/gsap')])
      if (cancelled) return
      const lenis = new Lenis({ autoRaf: false, anchors: { offset: -16 }, lerp: 0.11 })
      lenis.on('scroll', ScrollTrigger.update)
      const tick = (time: number) => lenis.raf(time * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
      ;(window as unknown as { __tabLenis?: unknown }).__tabLenis = lenis
      cleanup = () => {
        gsap.ticker.remove(tick)
        lenis.destroy()
        delete (window as unknown as { __tabLenis?: unknown }).__tabLenis
      }
    }

    // Start on the first wheel, key or pointer press, so it never competes with first paint.
    const stop = onFirstInteraction(() => void start())

    return () => {
      cancelled = true
      stop()
      cleanup?.()
    }
  }, [])
  return null
}
