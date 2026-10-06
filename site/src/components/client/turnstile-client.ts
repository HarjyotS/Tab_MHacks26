// Loads Cloudflare Turnstile only once someone starts filling in the form,
// so the script never touches first load.

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
  getResponse: (id: string) => string | undefined
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => {
      loading = null
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** One invisible-unless-needed widget per form. Resolves with a fresh token on demand. */
export class TurnstileWidget {
  private id: string | null = null
  private token: string | null = null
  private waiters: ((t: string | null) => void)[] = []

  constructor(
    private container: HTMLElement,
    private siteKey: string,
  ) {}

  async mount() {
    if (this.id) return
    const api = await loadTurnstile()
    if (this.id) return
    this.id = api.render(this.container, {
      sitekey: this.siteKey,
      action: 'waitlist',
      appearance: 'interaction-only',
      size: 'flexible',
      'response-field': false,
      callback: (t: string) => {
        this.token = t
        this.flush(t)
      },
      'expired-callback': () => {
        this.token = null
      },
      'error-callback': () => {
        this.token = null
        this.flush(null)
        return true
      },
    })
  }

  private flush(t: string | null) {
    const w = this.waiters
    this.waiters = []
    w.forEach((fn) => fn(t))
  }

  /** Waits up to `ms` for a token. */
  async getToken(ms = 12000): Promise<string | null> {
    try {
      await this.mount()
    } catch {
      return null
    }
    if (this.token) return this.token
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms)
      this.waiters.push((t) => {
        clearTimeout(timer)
        resolve(t)
      })
    })
  }

  /** Tokens are single-use: get a new one after every submit. */
  reset() {
    this.token = null
    if (this.id && window.turnstile) window.turnstile.reset(this.id)
  }

  destroy() {
    if (this.id && window.turnstile) window.turnstile.remove(this.id)
    this.id = null
  }
}
