'use client'

import { gsap, scheduleRefresh, useGSAP } from '@/lib/gsap'
import type { EnhancerProps } from '../client/Enhance'

/** The eight usual steps cross themselves out as you scroll past, then Tab's one message drops in. */
export default function DinnerTimeline({ root }: EnhancerProps) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ wide: '(min-width: 860px)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        const { wide, reduce } = ctx.conditions as { wide: boolean; reduce: boolean }
        if (reduce) return
        const q = gsap.utils.selector(root)
        const strikes = q('.dinner__strike')
        const steps = q('.dinner__step')
        const bubble = q('[data-bubble]')
        const logged = q('[data-logged]')

        const strike = (tl: gsap.core.Timeline) => {
          strikes.forEach((s, i) => {
            tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'power2.inOut' }, i)
            tl.fromTo(steps[i], { opacity: 1 }, { opacity: 0.72, duration: 1 }, i)
          })
          return tl
        }
        const drop = (tl: gsap.core.Timeline, at: number | string) => {
          tl.fromTo(bubble, { y: -70, autoAlpha: 0, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 1.4, ease: 'back.out(1.8)' }, at)
          tl.fromTo(logged, { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, '>-0.3')
        }

        if (wide) {
          // Side by side: one scrubbed timeline, crossing out first, then the bubble.
          const tl = gsap.timeline({
            scrollTrigger: { trigger: q('[data-cards]')[0], start: 'top 72%', end: 'bottom 60%', scrub: 0.6 },
          })
          strike(tl)
          drop(tl, '+=0.4')
        } else {
          // Stacked on phones: cross out while the list passes, drop the bubble when its card arrives.
          strike(gsap.timeline({ scrollTrigger: { trigger: q('[data-steps]')[0], start: 'top 82%', end: 'bottom 50%', scrub: 0.4 } }))
          drop(gsap.timeline({ scrollTrigger: { trigger: q('[data-new]')[0], start: 'top 78%', end: 'center 62%', scrub: 0.4 } }), 0)
        }
        scheduleRefresh()
      })
      return () => mm.revert()
    },
    { scope: { current: root } },
  )
  return null
}
