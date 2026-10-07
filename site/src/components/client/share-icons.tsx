// Small inline icons for the share sheet. Decorative: every one sits next to a text label.

type IconProps = { className?: string }

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3v12" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

export function MessageIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.15-.16-3.12-.46L4 20l1.4-3.6C4.5 15.1 3 13.4 3 11.5 3 7.36 7.03 4 12 4Z" />
    </svg>
  )
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20l1.3-3.9A8.5 8.5 0 1 1 8 18.8L4 20Z" />
      <path d="M9.2 8.6c.2-.4.6-.5.9-.4l.5.1.8 1.8-.6.8c.5 1 1.3 1.8 2.3 2.3l.8-.6 1.8.8.1.5c.1.3 0 .7-.4.9-.7.4-1.6.5-2.6.1-1.9-.8-3.1-2-3.9-3.9-.4-1-.3-1.9.3-2.4Z" />
    </svg>
  )
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} fill="currentColor" stroke="none">
      <path d="M17.7 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.7 3Zm-1.1 16.2h1.7L7.4 4.7H5.5l11.1 14.5Z" />
    </svg>
  )
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h.5" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}
