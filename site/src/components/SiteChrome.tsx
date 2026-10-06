import { SUPPORT_EMAIL } from '@/lib/site'

export function Logo({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <>
      <span className={'mark mark--' + size} aria-hidden="true" />
      <span className={'wordmark wordmark--' + size}>tab</span>
    </>
  )
}

export function Header({ home = true }: { home?: boolean }) {
  // On the legal pages the section links point back to the landing page.
  const p = home ? '' : '/'
  return (
    <header className="site-header">
      <a href={`${p}#top`} className="site-header__brand" aria-label="Tab home">
        <Logo />
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href={`${p}#chats`}>See it work</a>
        <a href={`${p}#trust`}>Privacy</a>
        <a href={`${p}#faq`}>Questions</a>
        <a href={`${p}#join`} className="btn btn--dark site-nav__cta">
          Join the waitlist
        </a>
      </nav>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <Logo size="sm" />
        <span>addtab.app</span>
      </div>
      <nav className="site-footer__nav" aria-label="Contact">
        <span className="site-footer__contact">
          Contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </span>
      </nav>
    </footer>
  )
}
