import type { CSSProperties } from 'react'
import { WALL_BLUE, WALL_JUSTIFY, WALL_TILT } from '@/content/chats'

export const WALL_CELLS = 12

export function bubbleStyle(i: number): CSSProperties {
  return { rotate: WALL_TILT[i % WALL_TILT.length] + 'deg' }
}
export function bubbleClass(i: number): string {
  return 'wall__bubble' + (WALL_BLUE[i % WALL_BLUE.length] ? ' wall__bubble--blue' : '')
}
export function cellStyle(i: number): CSSProperties {
  return { justifyContent: WALL_JUSTIFY[i % WALL_JUSTIFY.length] }
}
export function floatStyle(i: number): CSSProperties {
  return { animationDelay: (i * 0.41).toFixed(2) + 's' }
}

