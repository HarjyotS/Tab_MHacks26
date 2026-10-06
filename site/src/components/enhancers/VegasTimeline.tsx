'use client'

import { CHATS, IGNORED_AT, LEDGER } from '@/content/chats'
import { chatFrames, money } from '@/lib/thread'
import { gsap, ScrollTrigger, scheduleRefresh, useGSAP } from '@/lib/gsap'
import type { EnhancerProps } from '../client/Enhance'

const msgs = CHATS.vegas.msgs
/** Frame 0 is the empty chat; then one frame per message, plus Tab's typing frame. */
const FRAMES = [{ count: 0, typing: false }, ...chatFrames(msgs)]
/** Index of the first frame where the receipt is settled (Tab's summary is on screen). */
const SETTLED_FRAME = FRAMES.findIndex((f) => f.count > 16 && !f.typing)
const DELIVERED_H = 18
const STEP = 1 // timeline seconds per frame
const LEAD = 0.35 // a little scroll before the first message arrives

/** Who sent each message: 'sys' rows never get "Delivered". */
const isMine = (i: number) => msgs[i]?.who === 'me'
/** Index of the newest person message on screen (the typing bubble counts, as in the design). */
function lastPersonIndex(f: { count: number; typing: boolean }): number {
  if (f.typing) return f.count
  for (let j = f.count - 1; j >= 0; j--) if (msgs[j].who !== 'sys') return j
  return -1
}
/** A tapback shows once someone has replied after that message (the design's rule). */
function reactionFrame(i: number): number {
  return FRAMES.findIndex((f) => f.count > i && i < lastPersonIndex(f))
}

function totalsAt(frame: { count: number }) {
  const printed = LEDGER.filter((l) => frame.count > l.at)
  return {
    ignored: IGNORED_AT.filter((i) => frame.count > i).length,
    expenses: printed.length,
    cents: printed.reduce((s, l) => s + l.cents, 0),
  }
}

export default function VegasTimeline({ root }: EnhancerProps) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        {
          wide: '(min-width: 860px)',
          narrow: '(max-width: 859px)',
          reduce: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const { wide, reduce } = ctx.conditions as { wide: boolean; narrow: boolean; reduce: boolean }
          if (reduce) return

          const q = gsap.utils.selector(root)
          const stage = q('.vegas__stage')[0] as HTMLElement
          const col = q('[data-col]')[0] as HTMLElement
          const items = q('[data-col] > .ti[data-i]') as HTMLElement[]
          const typing = q('[data-typing]')[0] as HTMLElement
          const lines = q('.r-line') as HTMLElement[]
          const linesBox = q('[data-lines]')[0] as HTMLElement
          const windowEl = q('[data-window]')[0] as HTMLElement
          const listen = q('[data-listen]')[0] as HTMLElement
          const settledRows = q('[data-settled]') as HTMLElement[]
          const stamp = q('[data-stamp]')[0] as HTMLElement
          const out = {
            ignored: q('[data-ignored]')[0] as HTMLElement,
            expenses: q('[data-expenses]')[0] as HTMLElement,
            total: q('[data-total]')[0] as HTMLElement,
          }
          if (!stage || !col || !items.length) return

          // Pinned layout: full-height stage, and on phones a shorter phone and a compact receipt.
          root.setAttribute('data-pin', '')
          typing.classList.remove('is-off')
          listen.classList.remove('is-off')
          const compact = !wide

          // ---- measurements (all in the phone's own, unscaled pixels) ----
          const tabIdx = msgs.findIndex((m) => m.who === 'tab')
          const placeTyping = () => {
            typing.style.top = items[tabIdx].offsetTop + 'px'
          }
          placeTyping()
          const bottomOf = (f: { count: number; typing: boolean }) => {
            if (f.typing) return typing.offsetTop + typing.offsetHeight
            if (f.count === 0) return 0
            const el = items[f.count - 1]
            const b = el.offsetTop + el.offsetHeight
            return isMine(f.count - 1) ? b + DELIVERED_H : b
          }
          // The chat is anchored to the bottom like iMessage: shift it down by whatever isn't shown yet.
          const chatY = (k: number) => col.offsetHeight - bottomOf(FRAMES[k])
          const printedBottom = (k: number) => {
            const printed = lines.filter((l) => FRAMES[k].count > Number(l.dataset.at))
            const last = printed.at(-1)
            return last ? last.offsetTop + last.offsetHeight : 0
          }
          // Compact receipt: the newest lines scroll up through a short window.
          const linesY = (k: number) => (compact ? Math.min(0, windowEl.clientHeight - printedBottom(k)) : 0)
          // Full receipt: "Listening to the chat" sits right under the newest line.
          const listenY = (k: number) => (compact ? 0 : printedBottom(k) - linesBox.offsetHeight)

          // ---- initial (empty) state ----
          const counters = { ignored: 0, expenses: 0, cents: 0 }
          const write = () => {
            out.ignored.textContent = String(Math.round(counters.ignored))
            out.expenses.textContent = String(Math.round(counters.expenses))
            out.total.textContent = money(Math.round(counters.cents))
          }
          write()

          // Every tween is an explicit fromTo (never a bare to): ScrollTrigger's refresh invalidates
          // the timeline, and a to() would then re-record its start from wherever the playhead was.
          // lazy: false so a fast scroll that jumps many frames in one tick renders them in order.
          const tl = gsap.timeline({
            defaults: { ease: 'power2.out', lazy: false, immediateRender: false },
            onUpdate: write,
          })
          // The empty starting state renders right away (sets at 0 opt back in to immediateRender).
          const at0 = (targets: gsap.TweenTarget, vars: gsap.TweenVars) => tl.set(targets, { ...vars, immediateRender: true }, 0)
          const HIDDEN = { autoAlpha: 0, y: 12, scale: 0.92 }
          const SHOWN = { autoAlpha: 1, y: 0, scale: 1 }
          at0(col, { y: () => chatY(0) })
          at0(linesBox, { y: () => linesY(0) })
          at0(listen, { y: () => listenY(0), autoAlpha: 1 })
          at0([typing, ...settledRows, stamp], { autoAlpha: 0 })
          q('[data-delivered]').forEach((d) => at0(d, { autoAlpha: 0 }))
          q('.t-react').forEach((r) => at0(r, { autoAlpha: 0, scale: 0.4 }))
          at0(items, HIDDEN)
          at0(lines, { autoAlpha: 0, y: -8 })

          const reactAt = items.map((_, i) => (msgs[i]?.react ? reactionFrame(i) : -1))

          for (let k = 1; k < FRAMES.length; k++) {
            const f = FRAMES[k]
            const p = FRAMES[k - 1]
            const at = LEAD + (k - 1) * STEP

            // Chat slides up to make room, exactly by the new rows' height.
            tl.fromTo(col, { y: () => chatY(k - 1) }, { y: () => chatY(k), duration: 0.55, immediateRender: false }, at)

            if (f.typing) {
              tl.fromTo(typing, { autoAlpha: 0, y: 12, scale: 0.92 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.6)', immediateRender: false }, at)
            }
            if (p.typing && !f.typing) tl.fromTo(typing, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.15 }, at)

            for (let i = p.count; i < f.count; i++) {
              tl.fromTo(items[i], HIDDEN, { ...SHOWN, duration: 0.5, ease: 'back.out(1.6)' }, at + 0.05)
            }

            // "Delivered" follows your newest message while it's the last thing in the chat.
            const wasDelivered = !p.typing && p.count > 0 && isMine(p.count - 1)
            const isDelivered = !f.typing && f.count > 0 && isMine(f.count - 1)
            if (wasDelivered && (!isDelivered || p.count !== f.count)) {
              const d = items[p.count - 1].querySelector('[data-delivered]')
              if (d) tl.fromTo(d, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.15 }, at)
            }
            if (isDelivered) {
              const d = items[f.count - 1].querySelector('[data-delivered]')
              if (d) tl.fromTo(d, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, at + 0.3)
            }

            reactAt.forEach((rk, i) => {
              if (rk !== k) return
              const r = items[i].querySelector('.t-react')
              if (r) tl.fromTo(r, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2.4)' }, at + 0.2)
            })

            // Tab logs it: new receipt lines print, the counters tick.
            const newLines = lines.filter((l) => {
              const a = Number(l.dataset.at)
              return f.count > a && !(p.count > a)
            })
            if (newLines.length) {
              tl.fromTo(newLines, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power1.out' }, at + 0.15)
              tl.fromTo(linesBox, { y: () => linesY(k - 1) }, { y: () => linesY(k), duration: 0.45, immediateRender: false }, at + 0.15)
              tl.fromTo(listen, { y: () => listenY(k - 1) }, { y: () => listenY(k), duration: 0.45, immediateRender: false }, at + 0.15)
            }
            const t = totalsAt(f)
            const pt = totalsAt(p)
            if (t.ignored !== pt.ignored || t.expenses !== pt.expenses || t.cents !== pt.cents) {
              tl.fromTo(counters, { ...pt }, { ...t, duration: 0.5, ease: 'none', onUpdate: write }, at + 0.15)
            }

            if (k === SETTLED_FRAME) {
              tl.fromTo(listen, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.25 }, at + 0.2)
              tl.fromTo(settledRows, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, stagger: 0.1 }, at + 0.3)
            }
          }

          // The stamp lands on the very last bit of scroll, as the pin lets go.
          const stampAt = LEAD + (FRAMES.length - 1) * STEP
          tl.fromTo(
            stamp,
            { autoAlpha: 0, scale: 1.9, rotation: -12 },
            { autoAlpha: 1, scale: 1, rotation: -12, duration: 0.8, ease: 'back.out(1.7)', immediateRender: false },
            stampAt,
          )

          const perFrame = wide ? 170 : 92
          ScrollTrigger.create({
            trigger: stage,
            start: 'top top',
            end: () => '+=' + Math.round(tl.duration() * perFrame),
            pin: true,
            pinSpacing: true,
            scrub: wide ? 0.5 : 0.3,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            animation: tl,
            onRefreshInit: placeTyping,
            // A refresh restores the timeline's progress with events suppressed, so redraw the
            // counters from their (already correct) values here too.
            onRefresh: write,
            onUpdate: write,
          })
          scheduleRefresh()

          return () => {
            root.removeAttribute('data-pin')
            typing.classList.add('is-off')
            listen.classList.add('is-off')
            typing.style.top = ''
          }
        },
      )
      return () => mm.revert()
    },
    { scope: { current: root } },
  )
  return null
}
