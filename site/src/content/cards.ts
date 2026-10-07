import priya from '@/assets/priya.png'
import jake from '@/assets/jake.png'
import ava from '@/assets/ava.png'
import leo from '@/assets/leo.png'
import maya from '@/assets/maya.png'
import sam from '@/assets/sam.png'
import type { PhoneHeader } from '@/components/phone/Phone'

export const ENDING_HEADER: PhoneHeader = { title: 'Vegas Trip 2026 🎰', avatars: [maya, sam] }

export const CHAT_CARDS = [
  {
    chat: 'house',
    header: { title: 'Hill St House 🏡', avatars: [priya, jake] } as PhoneHeader,
    title: 'Receipts split themselves',
    body: 'Snap the bill and say what you had. Tax and tip are split to the cent.',
  },
  {
    chat: 'dm',
    header: { title: 'Tab', tab: true } as PhoneHeader,
    title: 'Nobody has to be the one who asks',
    body: 'Tab follows up privately with whoever hasn’t paid, never in front of the group.',
  },
  {
    chat: 'ski',
    header: { title: 'Tahoe Ski Weekend ⛷️', avatars: [ava, leo] } as PhoneHeader,
    title: 'A whole trip, settled in one message',
    body: 'Days of expenses collapse into the fewest possible payments. Nobody collates a thing.',
  },
] as const

export const ENDING_OPTIONS = [
  { value: 'without', label: 'Without Tab' },
  { value: 'with', label: 'With Tab' },
] as const
