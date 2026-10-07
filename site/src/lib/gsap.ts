// The one place GSAP is set up. Only ever loaded through dynamic import(),
// so none of it is in the page's initial JavaScript.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP)
// Phones resize the viewport when the address bar shows and hides; don't re-measure for that.
ScrollTrigger.config({ ignoreMobileResize: true })

let refreshTimer: ReturnType<typeof setTimeout> | undefined
/** Re-measure every trigger once newly added pins and sections have settled. */
export function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    ScrollTrigger.sort()
    ScrollTrigger.refresh()
  }, 150)
}

export { gsap, ScrollTrigger, SplitText, useGSAP }
