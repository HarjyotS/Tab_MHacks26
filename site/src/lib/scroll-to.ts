// Scrolls to an element through Lenis when it is running, natively otherwise.
import { prefersReducedMotion } from './motion-prefs'

type LenisLike = { scrollTo: (target: HTMLElement, opts?: { offset?: number; duration?: number; onComplete?: () => void }) => void }

export function scrollToElement(el: HTMLElement, opts: { offset?: number; onDone?: () => void } = {}) {
  const lenis = (window as unknown as { __tabLenis?: LenisLike }).__tabLenis
  const offset = opts.offset ?? -24
  if (lenis) {
    lenis.scrollTo(el, { offset, duration: 1.1, onComplete: opts.onDone })
    return
  }
  const top = el.getBoundingClientRect().top + window.scrollY + offset
  window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  if (opts.onDone) setTimeout(opts.onDone, prefersReducedMotion() ? 0 : 600)
}
