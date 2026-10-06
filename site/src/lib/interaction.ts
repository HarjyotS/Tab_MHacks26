// Runs `cb` on the visitor's first touch, scroll, wheel, pointer press or key
// press (or right away if the page was opened already scrolled). Heavy
// scroll libraries start downloading here, so they never compete with first
// paint, yet are ready before any scrolling reaches the sections they drive.

const EVENTS = ['touchstart', 'pointerdown', 'wheel', 'scroll', 'keydown'] as const
let fired = false
const waiting = new Set<() => void>()

function fire() {
  if (fired) return
  fired = true
  for (const e of EVENTS) window.removeEventListener(e, fire, true)
  waiting.forEach((cb) => cb())
  waiting.clear()
}

export function onFirstInteraction(cb: () => void): () => void {
  if (fired || window.scrollY > 0) {
    fired = true
    cb()
    return () => {}
  }
  if (waiting.size === 0) for (const e of EVENTS) window.addEventListener(e, fire, { capture: true, passive: true })
  waiting.add(cb)
  return () => waiting.delete(cb)
}
