'use client'

import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import type { EnhancerProps } from '../client/Enhance'

/** Section headings rise in line by line (SplitText masks) as they scroll into view. */
export default function Headings({ root }: EnhancerProps) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const splits: SplitText[] = []
        root.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
          // Headings already on screen stay put; only ones still below the fold animate.
          if (el.getBoundingClientRect().top < window.innerHeight) return
          splits.push(
            SplitText.create(el, {
              type: 'lines',
              mask: 'lines',
              autoSplit: true,
              onSplit(self) {
                return gsap.from(self.lines, {
                  yPercent: 105,
                  duration: 0.9,
                  stagger: 0.09,
                  ease: 'expo.out',
                  scrollTrigger: { trigger: el, start: 'top 88%', once: true },
                })
              },
            }),
          )
        })
        return () => splits.forEach((s) => s.revert())
      })
      return () => mm.revert()
    },
    { scope: { current: root } },
  )
  return null
}
