'use client'

import { useEffect, useRef, useState } from 'react'
import { scrollToElement } from '@/lib/scroll-to'
import { useJoined } from './waitlist-state'

/**
 * "Join the waitlist" pill that appears once the hero form has scrolled away,
 * and hides again while the footer form is on screen. Tapping it scrolls to
 * the hero form and puts the cursor in the phone field.
 */
export function StickyJoin() {
  const [show, setShow] = useState(false)
  const joined = useJoined()
  const state = useRef({ heroGone: false, footerVisible: false, storyActive: false })

  useEffect(() => {
    const hero = document.getElementById('join')
    const footer = document.getElementById('join-footer')
    if (!hero) return
    const story = document.querySelector('.vegas')
    const s = state.current
    const update = () => setShow(s.heroGone && !s.footerVisible && !s.storyActive)
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) s.heroGone = !e.isIntersecting && e.boundingClientRect.top < 0
        else s.footerVisible = e.isIntersecting
      }
      update()
    })
    io.observe(hero)
    if (footer) io.observe(footer)
    // Stay out of the way while the pinned Vegas story fills the screen.
    const storyIo = new IntersectionObserver(
      (entries) => {
        s.storyActive = entries.some((e) => e.isIntersecting)
        update()
      },
      { rootMargin: '-35% 0px -35% 0px' },
    )
    if (story) storyIo.observe(story)
    return () => {
      io.disconnect()
      storyIo.disconnect()
    }
  }, [])

  const visible = show && !joined
  return (
    <a
      href="#join"
      className={'sticky-join' + (visible ? ' is-on' : '')}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      onClick={(e) => {
        const hero = document.getElementById('join')
        if (!hero) return
        e.preventDefault()
        scrollToElement(hero, {
          offset: -Math.round(window.innerHeight * 0.18),
          onDone: () => document.getElementById('phone-hero')?.focus({ preventScroll: true }),
        })
      }}
    >
      Join the waitlist
    </a>
  )
}
