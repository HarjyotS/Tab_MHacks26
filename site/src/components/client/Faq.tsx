'use client'

import { useId, useState } from 'react'

import type { FaqItem } from '@/content/faq'

/**
 * WAI-ARIA accordion: each question is a button inside a heading, with
 * aria-expanded and aria-controls. Without JavaScript every answer simply
 * shows (the collapsed state only applies under html.js).
 */
export function Faq({ items }: { items: FaqItem[] }) {
  const base = useId()
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const toggle = (i: number) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="faq__list">
      {items.map((it, i) => {
        const isOpen = open.has(i)
        const btn = `${base}-q${i}`
        const panel = `${base}-a${i}`
        return (
          <div className={'faq__item' + (isOpen ? ' is-open' : '')} key={i}>
            <h3 className="faq__q">
              <button type="button" id={btn} aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(i)}>
                {it.q}
              </button>
            </h3>
            <div id={panel} role="region" aria-labelledby={btn} className="faq__a" data-open={isOpen}>
              <p>{it.a}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
