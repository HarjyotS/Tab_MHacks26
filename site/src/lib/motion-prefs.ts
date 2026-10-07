// Small, dependency-free checks shared by the client islands.

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Touch-first device: no hover and a coarse pointer (phones, most tablets). */
export function isTouchFirst(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

export function isPhoneWidth(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 859px)').matches
}
