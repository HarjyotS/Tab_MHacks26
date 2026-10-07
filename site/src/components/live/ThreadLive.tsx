'use client'

import { useLayoutEffect, useRef } from 'react'
import { animate, motion } from 'motion/react'
import type { ThreadItem } from '@/lib/thread'
import { ThreadParts } from '../phone/ThreadView'
import { tiClass } from '../phone/ti'

const SLIDE = { type: 'spring', stiffness: 380, damping: 34 } as const
const POP = { type: 'spring', stiffness: 520, damping: 24, mass: 0.8 } as const

/**
 * A bottom-anchored iMessage thread. When rows are added the whole thread is
 * pushed back down by exactly the height it grew and springs up (a FLIP
 * layout animation measured in the phone's own pixels, so it stays correct
 * inside the scaled mockup), while the new row pops in.
 */
export function ThreadLive({ items, cycle, fading }: { items: ThreadItem[]; cycle: number; fading: boolean }) {
  const colRef = useRef<HTMLDivElement>(null)
  const lastTop = useRef<number | null>(null)
  const lastCycle = useRef(cycle)
  const firstKeys = useRef<Set<string> | null>(null)
  if (firstKeys.current === null) firstKeys.current = new Set(items.map((i) => `${cycle}:${i.key}`))

  useLayoutEffect(() => {
    const col = colRef.current
    if (!col) return
    const top = col.offsetTop
    const prev = lastTop.current
    lastTop.current = top
    if (prev === null || lastCycle.current !== cycle) {
      lastCycle.current = cycle
      return
    }
    const delta = prev - top
    if (delta > 0.5) animate(col, { y: [delta, 0] }, SLIDE)
  }, [items, cycle])

  return (
    <div className={'thread thread--live' + (fading ? ' is-fading' : '')} ref={colRef}>
      {items.map((it) => {
        const k = `${cycle}:${it.key}`
        const old = firstKeys.current!.has(k)
        return (
          <motion.div
            key={k}
            className={tiClass(it)}
            initial={old ? false : { opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={POP}
          >
            <ThreadParts item={it} popReaction />
          </motion.div>
        )
      })}
    </div>
  )
}
