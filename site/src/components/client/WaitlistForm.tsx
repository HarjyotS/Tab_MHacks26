'use client'

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { joinWaitlist, type WaitlistResult } from '@/app/actions/waitlist'
import { CONSENT_LEAD, ERRORS } from '@/lib/waitlist/consent'
import { track } from '@/lib/analytics'
import { TurnstileWidget } from './turnstile-client'
import { setJoined, useJoined } from './waitlist-state'
import { SpotCard } from './SpotCard'

type Location = 'hero' | 'footer'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

/** Quick check before we bother the server. The server re-validates everything. */
function clientCheck(phone: string, consent: boolean): string | null {
  const raw = phone.trim()
  if (!raw.startsWith('+') || raw.startsWith('+1')) {
    let digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
    if (digits.length !== 10) return ERRORS.phone
  } else if (raw.replace(/\D/g, '').length < 8) {
    return ERRORS.phoneIntl
  }
  if (!consent) return ERRORS.consent
  return null
}

export function WaitlistForm({ location, siteKey, inviteCode = null }: { location: Location; siteKey: string | null; inviteCode?: string | null }) {
  const id = useId()
  const inputId = `phone-${location}`
  const errorId = `${id}-error`
  const joined = useJoined()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [waiting, setWaiting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const widgetBox = useRef<HTMLDivElement>(null)
  const widget = useRef<TurnstileWidget | null>(null)
  const started = useRef(false)
  const doneRef = useRef<HTMLSpanElement>(null)

  useEffect(() => () => widget.current?.destroy(), [])

  // Move focus to the confirmation when this form is the one that was used.
  const submittedHere = useRef(false)
  useEffect(() => {
    if (joined && submittedHere.current) doneRef.current?.focus()
  }, [joined])

  const start = () => {
    if (started.current) return
    started.current = true
    track('waitlist_form_started', { location })
    if (siteKey && widgetBox.current) {
      widget.current = new TurnstileWidget(widgetBox.current, siteKey)
      widget.current.mount().catch(() => {})
    }
  }

  const fail = (reason: string, message: string) => {
    setError(message)
    track('waitlist_failed', { location, reason })
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending || waiting) return
    start()
    const form = e.currentTarget
    const data = new FormData(form)
    const problem = clientCheck(String(data.get('phone') ?? ''), data.get('consent') === 'on')
    if (problem) {
      fail(problem === ERRORS.consent ? 'client_consent' : 'client_phone', problem)
      return
    }
    setError(null)
    track('waitlist_submitted', { location })

    // Turnstile is optional: with no site key there is no widget and no token to send.
    if (widget.current) {
      setWaiting(true)
      const token = await widget.current.getToken()
      setWaiting(false)
      if (!token) {
        fail('captcha_client', ERRORS.captcha)
        widget.current?.reset()
        return
      }
      data.set('cf-turnstile-response', token)
    }
    data.set('location', location)
    data.set('referrer', document.referrer.slice(0, 1024))
    const params = new URLSearchParams(window.location.search)
    for (const k of UTM_KEYS) {
      const v = params.get(k)
      if (v) data.set(k, v.slice(0, 200))
    }

    startTransition(async () => {
      let result: WaitlistResult
      try {
        result = await joinWaitlist({ status: 'idle' }, data)
      } catch {
        result = { status: 'error', code: 'unavailable', message: ERRORS.network }
      }
      if (result.status === 'success') {
        // The form is about to unmount: remove the widget first so Turnstile doesn't look for it.
        widget.current?.destroy()
        widget.current = null
        submittedHere.current = true
        track('waitlist_succeeded', { location, duplicate: result.duplicate, referred: result.referred })
        setJoined({ display: result.display, duplicate: result.duplicate, spot: result.spot })
      } else if (result.status === 'error') {
        widget.current?.reset()
        fail(result.code, result.message)
      }
    })
  }

  const busy = pending || waiting
  const confirmNote = joined
    ? `When your spot opens, Tab will text ${joined.display} from its own number to confirm. Reply STOP anytime to opt out.`
    : ''

  return (
    <div className="join-form" aria-live="polite">
      {joined?.spot ? (
        <SpotCard
          spot={joined.spot}
          eyebrow={joined.duplicate ? 'You’re already on the list' : 'You’re on the list'}
          note={confirmNote}
          level={location === 'hero' ? 2 : 3}
          focusOnShow={submittedHere.current}
          reportShown={submittedHere.current}
        />
      ) : joined ? (
        // The spot couldn't be worked out (the sign-up still went through): the plain confirmation.
        <div className="join-form__done">
          <span className="join-form__done-title" tabIndex={-1} ref={doneRef}>
            {joined.duplicate ? 'You’re already on the list.' : 'You’re on the list.'}
          </span>
          <span className="join-form__done-body">{confirmNote}</span>
        </div>
      ) : (
        <form ref={formRef} className="join-form__form" method="post" noValidate onSubmit={onSubmit} onFocus={start} onPointerDown={start}>
          {location === 'hero' ? (
            <div className="join-form__heading">
              <label htmlFor={inputId} className="join-form__label">
                Get Tab for your group chat
              </label>
              <span className="join-form__hint">Drop your number and we&apos;ll text you when it&apos;s ready.</span>
            </div>
          ) : (
            <label htmlFor={inputId} className="join-form__label">
              Your phone number
            </label>
          )}
          <div className="join-form__row">
            <input
              id={inputId}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="send"
              placeholder="(555) 555-0123"
              maxLength={40}
              className="join-form__input"
              aria-invalid={error === ERRORS.phone || error === ERRORS.phoneIntl ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onInput={() => error && setError(null)}
            />
            <button type="submit" className="btn btn--accent join-form__submit" disabled={busy} aria-disabled={busy}>
              {busy ? 'Joining…' : 'Join the waitlist'}
            </button>
          </div>
          <label className="join-form__consent">
            <input type="checkbox" name="consent" className="join-form__check" onChange={() => error === ERRORS.consent && setError(null)} />
            <span>
              {CONSENT_LEAD} <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.
            </span>
          </label>
          {inviteCode ? <input type="hidden" name="ref" value={inviteCode} /> : null}
          <div ref={widgetBox} className="join-form__captcha" />
          {error ? (
            <p role="alert" id={errorId} className="join-form__error">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}
