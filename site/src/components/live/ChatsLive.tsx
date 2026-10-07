'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView, useScroll, useTransform } from 'motion/react'
import { CHATS } from '@/content/chats'
import { CHAT_CARDS } from '@/content/cards'
import { buildThread, chatFrames } from '@/lib/thread'
import { isPhoneWidth } from '@/lib/motion-prefs'
import { Phone } from '../phone/Phone'
import { ThreadLive } from './ThreadLive'

/** How far each phone rises as it scrolls in: three slightly different speeds. */
const RISE_WIDE = [80, 130, 180]
const RISE_NARROW = [28, 40, 52]
const TICK_MS = 1500

export default function ChatsLive() {
  const [narrow] = useState(isPhoneWidth)
  return (
    <div className="chats__row">
      {CHAT_CARDS.map((c, i) => (
        <PhoneCard key={c.chat} card={c} rise={(narrow ? RISE_NARROW : RISE_WIDE)[i]} />
      ))}
    </div>
  )
}

function PhoneCard({ card, rise }: { card: (typeof CHAT_CARDS)[number]; rise: number }) {
  const chat = CHATS[card.chat]
  const ref = useRef<HTMLDivElement>(null)
  // Plays only while at least a third of the phone is on screen; pauses when it leaves.
  const onScreen = useInView(ref, { amount: 0.35 })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!onScreen) return
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [onScreen])

  const frames = useMemo(() => chatFrames(chat.msgs), [chat])
  const total = frames.length + 4
  const pos = tick + chat.offset
  const idx = pos % total
  const cycle = Math.floor(pos / total)
  const frame = frames[Math.min(idx, frames.length - 1)]
  const items = useMemo(() => buildThread(chat.msgs, { group: chat.group, count: frame.count, typing: frame.typing }), [chat, frame])

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 35%'] })
  const y = useTransform(scrollYProgress, [0, 1], [rise, 0])

  return (
    <motion.div className="chat-card" ref={ref} style={{ y }}>
      <Phone header={card.header} className="phone--card">
        <ThreadLive items={items} cycle={cycle} fading={idx === total - 1} />
      </Phone>
      <div className="chat-card__caption">
        <h3>{card.title}</h3>
        <p>{card.body}</p>
      </div>
    </motion.div>
  )
}
