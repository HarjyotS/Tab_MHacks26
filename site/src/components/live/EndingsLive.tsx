'use client'

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, type Variants } from 'motion/react'
import { ENDINGS } from '@/content/chats'
import { ENDING_HEADER, ENDING_OPTIONS } from '@/content/cards'
import { buildThread } from '@/lib/thread'
import { Phone } from '../phone/Phone'
import { ThreadParts } from '../phone/ThreadView'
import { tiClass } from '../phone/ti'

type Ending = 'with' | 'without'

const list: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.16, delayChildren: 0.05 } },
}
const row: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.9 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 26 } },
}

/** The same radio group, now with a sliding pill and the chosen ending replaying message by message. */
export default function EndingsLive({ initial }: { initial: Ending }) {
  const [ending, setEnding] = useState<Ending>(initial)
  const phoneRef = useRef<HTMLDivElement>(null)
  const inView = useInView(phoneRef, { once: true, amount: 0.35 })
  const items = useMemo(() => buildThread(ENDINGS[ending], { group: true }), [ending])

  return (
    <>
      <fieldset className="seg seg--live endings__toggle">
        <legend className="sr-only">Choose an ending</legend>
        {ENDING_OPTIONS.map((o) => (
          <label className={'seg__opt' + (ending === o.value ? ' is-on' : '')} key={o.value}>
            <input
              type="radio"
              name="ending"
              value={o.value}
              checked={ending === o.value}
              onChange={() => setEnding(o.value)}
              className="seg__input"
              aria-controls="ending-phone"
            />
            {ending === o.value ? (
              <motion.span layoutId="ending-pill" className="seg__pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />
            ) : null}
            <span className="seg__text">{o.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="endings__phone" ref={phoneRef} id="ending-phone">
        <Phone header={ENDING_HEADER} className="phone--ending">
          <AnimatePresence mode="wait">
            <motion.div
              key={ending}
              className="ending-thread ending-thread--live"
              variants={list}
              initial="hidden"
              animate={inView ? 'shown' : 'hidden'}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
            >
              {items.map((it) => (
                <motion.div className={tiClass(it)} key={it.key} variants={row}>
                  <ThreadParts item={it} />
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </Phone>
      </div>
    </>
  )
}
