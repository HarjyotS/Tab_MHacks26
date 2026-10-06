'use client'

import { useSyncExternalStore } from 'react'

// Both forms on the page share one result, as in the design: sign up in one,
// both show you're on the list.
export type Joined = { display: string; duplicate: boolean } | null

let joined: Joined = null
const listeners = new Set<() => void>()

export function setJoined(j: Joined) {
  joined = j
  listeners.forEach((l) => l())
}

export function useJoined(): Joined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => joined,
    () => null,
  )
}
