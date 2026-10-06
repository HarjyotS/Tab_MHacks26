'use client'

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { prefersReducedMotion } from '@/lib/motion-prefs'
import { onFirstInteraction } from '@/lib/interaction'

export type EnhancerProps = { root: HTMLElement }

const LOADERS = {
  vegas: () => import('../enhancers/VegasTimeline'),
  dinner: () => import('../enhancers/DinnerTimeline'),
  headings: () => import('../enhancers/Headings'),
} satisfies Record<string, () => Promise<{ default: ComponentType<EnhancerProps> }>>

/**
 * Drops a GSAP scroll enhancer into a server-rendered section. The section's
 * HTML is complete on its own; GSAP and the timeline code download only once
 * the visitor starts interacting and the section is near, never with reduced motion.
 */
export function Enhance({ which, margin = '120% 0px' }: { which: keyof typeof LOADERS; margin?: string }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [state, setState] = useState<{ Comp: ComponentType<EnhancerProps>; root: HTMLElement } | null>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const root = which === 'headings' ? document.body : anchor.current?.closest<HTMLElement>('[data-enhance]')
    if (!root) return
    let cancelled = false
    const load = () =>
      LOADERS[which]().then((m) => {
        if (!cancelled) setState({ Comp: m.default, root })
      })

    if (which === 'headings') {
      const stop = onFirstInteraction(() => void load())
      return () => {
        cancelled = true
        stop()
      }
    }

    // Load once the section is near AND the visitor has started interacting.
    let near = false
    let active = false
    const maybeLoad = () => {
      if (near && active) void load()
    }
    const stop = onFirstInteraction(() => {
      active = true
      maybeLoad()
    })
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          near = true
          maybeLoad()
        }
      },
      { rootMargin: margin },
    )
    io.observe(root)
    return () => {
      cancelled = true
      stop()
      io.disconnect()
    }
  }, [which, margin])

  return <span ref={anchor} hidden>{state ? <state.Comp root={state.root} /> : null}</span>
}
