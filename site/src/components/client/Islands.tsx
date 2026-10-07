'use client'

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { prefersReducedMotion } from '@/lib/motion-prefs'
import { onFirstInteraction } from '@/lib/interaction'

/**
 * Shows the server-rendered children until the section gets near the screen,
 * then swaps in the interactive Motion version from its own lazy chunk. The
 * static children are complete on their own (no JS, reduced motion).
 */
function useIsland<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  opts: { margin?: string; skipWhenReduced?: boolean; readProps?: (el: HTMLElement) => P } = {},
) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ Comp: ComponentType<P>; props: P } | null>(null)
  const { margin = '80% 0px', skipWhenReduced = true, readProps } = opts

  useEffect(() => {
    if (skipWhenReduced && prefersReducedMotion()) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    let near = false
    let active = false
    const maybeLoad = () => {
      if (!near || !active) return
      load().then((m) => {
        if (cancelled) return
        const props = readProps ? readProps(el) : ({} as P)
        setState({ Comp: m.default, props })
      })
    }
    const stop = onFirstInteraction(() => {
      active = true
      maybeLoad()
    })
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        near = true
        maybeLoad()
      },
      { rootMargin: margin },
    )
    // Watch the whole section: an island can be display: contents and have no box of its own.
    io.observe(el.closest('section') ?? el)
    return () => {
      cancelled = true
      stop()
      io.disconnect()
    }
    // load and readProps are fixed per island
  }, [margin, skipWhenReduced])

  return { ref, live: state ? <state.Comp {...state.props} /> : null }
}

const loadWall = () => import('../live/WallLive')
const loadEndings = () => import('../live/EndingsLive')
const loadChats = () => import('../live/ChatsLive')

export function WallIsland({ children }: { children: ReactNode }) {
  // Popping still works with reduced motion (the live wall turns its animation off).
  const { ref, live } = useIsland(loadWall, { skipWhenReduced: false })
  return (
    <div ref={ref} className="island island--wall">
      {live ?? children}
    </div>
  )
}

export function EndingsIsland({ children }: { children: ReactNode }) {
  const { ref, live } = useIsland(loadEndings, {
    skipWhenReduced: true,
    // Keep whatever the visitor already picked with the no-JS radio toggle.
    readProps: (el) => ({
      initial: (el.querySelector<HTMLInputElement>('input[name="ending"]:checked')?.value === 'with' ? 'with' : 'without') as 'with' | 'without',
    }),
  })
  return (
    <div ref={ref} className="island island--endings">
      {live ?? children}
    </div>
  )
}

export function ChatsIsland({ children }: { children: ReactNode }) {
  const { ref, live } = useIsland(loadChats, { skipWhenReduced: true })
  return (
    <div ref={ref} className="island island--chats">
      {live ?? children}
    </div>
  )
}
