'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import { track } from '@/lib/analytics'
import { isTouchFirst, prefersReducedMotion } from '@/lib/motion-prefs'
import { INVITE_TEXT, INVITE_TITLE, SPOTS_PER_REFERRAL } from '@/lib/waitlist/referral-config'
import { CheckIcon, CloseIcon, CopyIcon, MailIcon, MessageIcon, ShareIcon, WhatsAppIcon, XIcon } from './share-icons'

type Method = 'native' | 'copy' | 'sms' | 'whatsapp' | 'x' | 'email'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Lenis = { stop: () => void; start: () => void }
const lenis = () => (window as unknown as { __tabLenis?: Lenis }).__tabLenis

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and some in-app webviews: fall back to a selected field.
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {}
    field.remove()
    return ok
  }
}

/**
 * "Share your invite". Phones with the Web Share API get the native share
 * sheet; everywhere else (or if that is cancelled) a custom sheet opens with
 * the link, Copy, Messages, WhatsApp, X and Email.
 */
export function ShareInvite({ url }: { url: string }) {
  const titleId = useId()
  const fieldId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)

  const text = INVITE_TEXT
  const enc = encodeURIComponent
  const targets: { method: Exclude<Method, 'native' | 'copy'>; label: string; href: string; external: boolean; Icon: typeof MessageIcon }[] = [
    { method: 'sms', label: 'Messages', href: `sms:&body=${enc(`${text} ${url}`)}`, external: false, Icon: MessageIcon },
    { method: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}`, external: true, Icon: WhatsAppIcon },
    { method: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, external: true, Icon: XIcon },
    { method: 'email', label: 'Email', href: `mailto:?subject=${enc(INVITE_TITLE)}&body=${enc(`${text}\n\n${url}`)}`, external: false, Icon: MailIcon },
  ]

  const openSheet = () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    document.documentElement.classList.add('is-sheet-open')
    lenis()?.stop()
    setOpen(true)
    // Let the closed state paint first so the sheet slides in.
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.setAttribute('data-open', '')))
    dialog.querySelector<HTMLButtonElement>('[data-copy]')?.focus()
  }

  const closeSheet = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || !dialog.open) return
    const finish = () => {
      dialog.close()
      document.documentElement.classList.remove('is-sheet-open')
      lenis()?.start()
      setOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    dialog.removeAttribute('data-open')
    if (prefersReducedMotion()) finish()
    else window.setTimeout(finish, 220)
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(copiedTimer.current)
      document.documentElement.classList.remove('is-sheet-open')
    },
    [],
  )

  const onShare = async () => {
    const data = { title: INVITE_TITLE, text, url }
    if (isTouchFirst() && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data)
        track('invite_share_clicked', { method: 'native' })
        return
      } catch {
        // Cancelled or refused: offer the custom sheet instead.
      }
    }
    openSheet()
  }

  const onCopy = async () => {
    const ok = await copyText(url)
    if (!ok) {
      dialogRef.current?.querySelector<HTMLInputElement>('input')?.select()
      return
    }
    track('invite_share_clicked', { method: 'copy' })
    setCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  // Keep Tab inside the sheet (the native modal makes the page inert; this also wraps around).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // A click on the dialog itself (not the panel inside it) is a click on the backdrop.
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) closeSheet()
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="btn btn--accent share-trigger" onClick={onShare} aria-haspopup="dialog" aria-expanded={open}>
        <ShareIcon className="share-trigger__icon" />
        Share your invite
      </button>
      <dialog
        ref={dialogRef}
        className="share-sheet"
        aria-labelledby={titleId}
        data-lenis-prevent=""
        onCancel={(e) => {
          // Escape: run the closing animation instead of vanishing.
          e.preventDefault()
          closeSheet()
        }}
        onKeyDown={onKeyDown}
        onClick={onDialogClick}
      >
        <div className="share-sheet__panel">
          <div className="share-sheet__grab" aria-hidden="true" />
          <div className="share-sheet__head">
            <h2 id={titleId} className="share-sheet__title">
              Share your invite
            </h2>
            <button type="button" className="share-sheet__close" onClick={closeSheet} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <p className="share-sheet__sub">Each friend who joins with your link moves you up {SPOTS_PER_REFERRAL} spots.</p>
          <div className="share-sheet__link">
            <label htmlFor={fieldId} className="sr-only">
              Your invite link
            </label>
            <input id={fieldId} className="share-sheet__field" type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" data-copy="" className={'btn btn--dark share-sheet__copy' + (copied ? ' is-copied' : '')} onClick={onCopy}>
              {copied ? <CheckIcon className="share-sheet__copy-icon" /> : <CopyIcon className="share-sheet__copy-icon" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copied ? 'Invite link copied' : ''}
          </p>
          <ul className="share-sheet__targets" aria-label="Send it with">
            {targets.map(({ method, label, href, external, Icon }) => (
              <li key={method}>
                <a
                  className="share-sheet__target"
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  onClick={() => track('invite_share_clicked', { method })}
                >
                  <span className={`share-sheet__icon share-sheet__icon--${method}`}>
                    <Icon />
                  </span>
                  <span className="share-sheet__label">{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  )
}
