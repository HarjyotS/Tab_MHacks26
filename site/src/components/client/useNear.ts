'use client'

import { useEffect, useState, type RefObject } from 'react'

/** True once the element comes within `margin` of the viewport (then stays true). */
export function useNear(ref: RefObject<Element | null>, margin = '100% 0px'): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (!('IntersectionObserver' in window)) {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin, near])
  return near
}
