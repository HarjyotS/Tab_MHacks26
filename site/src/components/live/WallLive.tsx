'use client'

import { useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { WALL_BLUE_ODDS, WALL_POOL, WALL_START_BLUE, type WallMsg } from '@/content/chats'
import { isPhoneWidth, isTouchFirst } from '@/lib/motion-prefs'
import { WALL_CELLS, bubbleClass, bubbleStyle, cellStyle, floatStyle } from '../sections/wall-style'

/** Parallax travel per bubble (px over the section's pass), so the wall drifts in layers. */
const DEPTH = [70, -40, 110, 45, -70, 90, 30, -85, 120, 25, -55, 60]
const POP_SPRING = { type: 'spring', stiffness: 520, damping: 16, mass: 0.7 } as const

export default function WallLive() {
  const wallRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false
  const [touch] = useState(isTouchFirst)
  const [narrow] = useState(isPhoneWidth)
  // Each cell: which message it shows and its color. Starts fixed (so it matches the server render).
  const [wall, setWall] = useState(() => Array.from({ length: WALL_CELLS }, (_, i) => ({ pi: i, blue: WALL_START_BLUE[i] })))
  const next = useRef(WALL_CELLS)
  const cooldown = useRef<number[]>([])

  const { scrollYProgress } = useScroll({ target: wallRef, offset: ['start end', 'end start'] })
  // Phones get a much gentler parallax; reduced motion gets none.
  const depth = reduced ? 0 : narrow ? 0.14 : 1

  const pop = (cell: number) => {
    const now = Date.now()
    if ((cooldown.current[cell] ?? 0) > now) return
    cooldown.current[cell] = now + 1100
    setWall((cur) => {
      let n = next.current
      let guard = 0
      while (cur.some((c) => c.pi === n) && guard < WALL_POOL.length) {
        n = (n + 1) % WALL_POOL.length
        guard++
      }
      next.current = (n + 1) % WALL_POOL.length
      const copy = cur.slice()
      copy[cell] = { pi: n, blue: Math.random() < WALL_BLUE_ODDS }
      return copy
    })
  }

  return (
    <div className="wall" ref={wallRef}>
      {wall.map((c, i) => (
        <Cell
          key={i}
          cell={i}
          msg={WALL_POOL[c.pi]}
          blue={c.blue}
          poolIndex={c.pi}
          progress={scrollYProgress}
          travel={DEPTH[i] * depth}
          wallRef={wallRef}
          touch={touch}
          reduced={reduced}
          onPop={() => pop(i)}
        />
      ))}
    </div>
  )
}

function Cell({
  cell,
  msg,
  blue,
  poolIndex,
  progress,
  travel,
  wallRef,
  touch,
  reduced,
  onPop,
}: {
  cell: number
  msg: WallMsg
  blue: boolean
  poolIndex: number
  progress: MotionValue<number>
  travel: number
  wallRef: RefObject<HTMLDivElement | null>
  touch: boolean
  reduced: boolean
  onPop: () => void
}) {
  const y = useTransform(progress, [0, 1], [travel, -travel])
  const dragged = useRef(false)
  return (
    <span className="wall__cell" style={cellStyle(cell)}>
      <motion.span className="wall__par" style={{ y }}>
        <span className="wall__float bob" style={floatStyle(cell)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.button
              key={poolIndex}
              type="button"
              className={bubbleClass(blue) + ' wallbtn'}
              style={bubbleStyle(cell)}
              aria-label={'Pop: ' + msg.text}
              // On touch screens only sideways flicks, so a vertical swipe still scrolls the page.
              drag={touch ? 'x' : true}
              dragConstraints={wallRef}
              dragElastic={0.22}
              dragMomentum
              dragTransition={{ power: 0.35, timeConstant: 260, bounceStiffness: 320, bounceDamping: 14 }}
              whileDrag={{ scale: 1.06, zIndex: 5, cursor: 'grabbing' }}
              onDragStart={() => {
                dragged.current = true
              }}
              onDragEnd={() => {
                setTimeout(() => (dragged.current = false), 0)
              }}
              onClick={() => {
                if (!dragged.current) onPop()
              }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1, transition: reduced ? { duration: 0 } : POP_SPRING }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: [1, 1, 0], scale: [1, 1.1, 1.22], transition: { duration: 0.22, ease: 'easeIn' } }
              }
            >
              {msg.text}
              {msg.react ? (
                <span className="wall__react" aria-hidden="true">
                  {msg.react}
                </span>
              ) : null}
            </motion.button>
          </AnimatePresence>
        </span>
      </motion.span>
    </span>
  )
}
