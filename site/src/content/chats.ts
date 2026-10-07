// Conversation scripts, ported verbatim from the design (landing/Main.dc.html).

export type PersonId = 'maya' | 'jordan' | 'sam' | 'ava' | 'jake' | 'priya' | 'leo' | 'tab'
export type Who = PersonId | 'me' | 'sys'
export type Reaction = 'heart' | 'haha' | 'thumbs'

export interface Msg {
  who: Who
  kind?: 'text' | 'time' | 'logged' | 'note' | 'receipt' | 'link'
  text?: string
  dir?: 'in' | 'out'
  react?: Reaction
  rTitle?: string
  rTotal?: number
  rLines?: [string, number][]
  title?: string
  sub?: string
}

export interface Chat {
  group: boolean
  /** Frame offset so the looping phones don't all start in sync (from the design). */
  offset: number
  msgs: Msg[]
}

export const PEOPLE: Record<PersonId, { name: string }> = {
  maya: { name: 'Maya' },
  jordan: { name: 'Jordan' },
  sam: { name: 'Sam' },
  ava: { name: 'Ava' },
  jake: { name: 'Jake' },
  priya: { name: 'Priya' },
  leo: { name: 'Leo' },
  tab: { name: 'Tab' },
}

/** Tab's wrap-up for the Vegas chat, shared by the scroll story and the "with Tab" ending. */
const SUMMARY =
  'Trip’s over! 7 expenses, $2,003.10 total, $400.62 each. Settled in 4 payments:\nSam pays Maya $186.62\nAva pays Maya $342.32\nJordan pays Maya $310.62\nYou pay Maya $57.82'

export const CHATS = {
  vegas: {
    group: true,
    offset: 0,
    msgs: [
      { who: 'sys', kind: 'time', text: 'Fri 6:12 PM' },
      { who: 'maya', text: 'landed!! got the uber to the hotel, $38', react: 'heart' },
      { who: 'sys', kind: 'logged', dir: 'in', text: 'Tab logged $38.00' },
      { who: 'maya', text: 'also the airbnb was $1,260, it’s on my card' },
      { who: 'sys', kind: 'logged', dir: 'in', text: 'Tab logged $1,260.00' },
      { who: 'jordan', text: 'who’s down for the buffet tomorrow' },
      { who: 'sam', text: 'obviously' },
      { who: 'sys', kind: 'time', text: 'Sat 12:40 PM' },
      {
        who: 'me',
        kind: 'receipt',
        rTitle: 'Lucky Brunch Co.',
        rTotal: 14280,
        rLines: [['Eggs Benny', 1850], ['Chx + waffles', 2100], ['Avo toast', 1600], ['Mimosa x6', 5400], ['Fries', 900], ['Tax + tip', 2430]],
      },
      { who: 'sys', kind: 'logged', dir: 'out', text: 'Tab read the receipt: $142.80, 5 items' },
      { who: 'sys', kind: 'time', text: 'Sat 11:48 PM' },
      { who: 'me', text: 'covered club entry for all of us, $200', react: 'haha' },
      { who: 'sys', kind: 'logged', dir: 'out', text: 'Tab logged $200.00' },
      { who: 'sam', text: 'i got the buffet earlier btw, $214 💀' },
      { who: 'sys', kind: 'logged', dir: 'in', text: 'Tab logged $214.00' },
      { who: 'ava', text: 'the fountain show was unreal 😭', react: 'heart' },
      { who: 'sys', kind: 'time', text: 'Sun 11:20 AM' },
      { who: 'jordan', text: 'airbnb cleaning fee was $90 btw' },
      { who: 'sys', kind: 'logged', dir: 'in', text: 'Tab logged $90.00' },
      { who: 'ava', text: 'gas for the drive home, $58.30' },
      { who: 'sys', kind: 'logged', dir: 'in', text: 'Tab logged $58.30' },
      { who: 'sys', kind: 'time', text: 'Sun 2:05 PM' },
      {
        who: 'tab',
        text: SUMMARY,
        react: 'thumbs',
      },
      { who: 'me', text: 'wait it even read the brunch receipt??' },
    ],
  },
  house: {
    group: true,
    offset: 4,
    msgs: [
      {
        who: 'me',
        kind: 'receipt',
        rTitle: 'Frita Batidos',
        rTotal: 6630,
        rLines: [['Cuban', 1500], ['Chorizo', 1500], ['Fries', 800], ['Batido x2', 1400], ['Tax + tip', 1430]],
      },
      { who: 'tab', text: 'Frita Batidos, $66.30. Who had what?\n1. Cuban burger $15.00\n2. Chorizo burger $15.00\n3. Fries $8.00\n4. Batido x2 $14.00' },
      { who: 'jake', text: '1' },
      { who: 'me', text: '2, and we all split the fries' },
      { who: 'priya', text: 'the batidos were mine lol', react: 'heart' },
      { who: 'tab', text: 'Done. Jake $22.53, Maya $22.52, Priya $21.25. Tax and tip split proportionally.' },
    ],
  },
  dm: {
    group: false,
    offset: 2,
    msgs: [
      { who: 'tab', text: 'Hey Jake, quick one: you still owe Maya $22.53 for Frita Batidos.' },
      { who: 'me', text: 'my bad 😭 how do i pay' },
      { who: 'tab', kind: 'link', title: 'Pay Maya $22.53', sub: 'Opens Venmo with the amount filled in' },
      { who: 'me', text: 'sent' },
      { who: 'tab', text: 'Thanks! Once Maya confirms, you’re all square.' },
    ],
  },
  ski: {
    group: true,
    offset: 7,
    msgs: [
      { who: 'tab', text: 'Trip’s wrapped! 23 expenses, settled in 2 payments:\nSam pays Ava $186.40\nLeo pays Ava $92.15', react: 'thumbs' },
      { who: 'ava', text: 'wait that’s it??' },
      { who: 'me', text: 'paid 🫡', react: 'heart' },
      { who: 'tab', text: 'Thanks Sam. Ava, can you confirm it came through?' },
      { who: 'ava', text: 'got it' },
      { who: 'tab', text: 'Sam is square. Leo, you’re the last one.' },
    ],
  },
} satisfies Record<string, Chat>

export const ENDINGS: Record<'without' | 'with', Msg[]> = {
  without: [
    { who: 'sys', kind: 'time', text: 'Sun 9:02 PM' },
    { who: 'maya', text: 'ok who owes who for vegas' },
    { who: 'sam', text: 'i paid for the buffet' },
    { who: 'me', text: 'brunch AND club' },
    { who: 'ava', text: 'gas home' },
    { who: 'maya', text: 'the airbnb and the uber 💀' },
    { who: 'sam', text: 'can someone make a spreadsheet' },
    { who: 'maya', text: 'i’ll do it tmrw' },
    { who: 'sys', kind: 'time', text: 'Wed 4:47 PM' },
    { who: 'ava', text: 'did anyone do the spreadsheet' },
    { who: 'jordan', text: 'just venmo me whatever' },
    { who: 'sys', kind: 'time', text: '3 weeks later' },
    { who: 'me', text: 'so... about vegas' },
    { who: 'sys', kind: 'note', dir: 'out', text: 'Read by nobody' },
  ],
  with: [
    { who: 'sys', kind: 'time', text: 'Sun 2:05 PM' },
    { who: 'tab', text: SUMMARY, react: 'thumbs' },
    { who: 'me', text: 'paid' },
    { who: 'sam', text: 'same' },
    { who: 'jordan', text: 'done' },
    { who: 'tab', text: 'Everyone’s square on Vegas. See you next trip.' },
    { who: 'ava', text: 'ok we’re adding tab to every chat' },
  ],
}

/**
 * Each receipt line prints when its "Tab logged" row (message index `at`) shows up in the
 * Vegas chat, so every line on the receipt is an expense someone posted.
 */
export const LEDGER = [
  { at: 2, what: 'Uber to hotel', who: 'Maya', cents: 3800 },
  { at: 4, what: 'Airbnb', who: 'Maya', cents: 126000 },
  { at: 9, what: 'Brunch receipt', who: 'You', cents: 14280 },
  { at: 12, what: 'Club entry', who: 'You', cents: 20000 },
  { at: 14, what: 'Buffet', who: 'Sam', cents: 21400 },
  { at: 18, what: 'Cleaning fee', who: 'Jordan', cents: 9000 },
  { at: 20, what: 'Gas', who: 'Ava', cents: 5830 },
]
/** People on the Vegas tab (the "Each" row splits the total this many ways). */
export const VEGAS_PEOPLE = 5
/** Vegas message indexes that aren't about money (the "Messages ignored" counter). */
export const IGNORED_AT = [5, 6, 15]
/** Index of Tab's summary, where the receipt settles. */
export const SETTLE_AT = 22

/**
 * The side card in the Vegas story: the brunch receipt split by item instead of evenly. It shows
 * while ITEM_SPLIT_FROM < shown messages <= ITEM_SPLIT_TO (from "Tab read the receipt" until the buffet).
 */
export const ITEM_SPLIT: { item: string; who: string }[] = [
  { item: 'Eggs Benny', who: 'Maya' },
  { item: 'Chx + waffles', who: 'You' },
  { item: 'Avo toast', who: 'Ava' },
  { item: 'Fries', who: 'Sam' },
  { item: 'Mimosa x6', who: 'Everyone' },
  { item: 'Tax + tip', who: 'Proportional' },
]
export const ITEM_SPLIT_FROM = 9
export const ITEM_SPLIT_TO = 14

export type WallMsg = { text: string; react?: string }

/** The money texts every group chat has sent. Popping one brings up the next. */
export const WALL_POOL: WallMsg[] = [
  { text: 'wait who paid for the airbnb 🏠' },
  { text: 'i venmo’d you right?? 🤨' },
  { text: 'can someone just make a spreadsheet 📊' },
  { text: 'jake still owes me from cancún btw 🌴', react: '‼️' },
  { text: 'ok i did the math and everyone owes me $47.18?? 🧮' },
  { text: 'why does the spreadsheet have 3 tabs now 😭', react: '😂' },
  { text: 'who has the receipt 🧾' },
  { text: 'i’ll just eat it, it’s fine 🙂' },
  { text: 'it was not fine 💀', react: '😂' },
  { text: 'did you request me or did i request you 🔄' },
  { text: 'venmo says i paid you twice?? 💸💸', react: '❓' },
  { text: 'we said we’d split gas right ⛽' },
  { text: 'i only had a side salad 🥗', react: '👎' },
  { text: 'can i pay you in vibes ✨' },
  { text: 'it’s been 3 business days 📆' },
  { text: 'just round it to $20 and we’re even 🤝' },
  { text: 'why am i being requested $0.37 😐', react: '😂' },
  { text: 'per person or total?? 😵‍💫' },
  { text: 'sending the splitwise link again 🙃' },
  { text: 'not trying to be that guy but 👀' },
  { text: 'ok but who ordered the second bottle 🍾', react: '‼️' },
  { text: 'i’ll venmo you when i get paid 🫠' },
  { text: 'was the tip included or 🤔' },
  { text: 'remind me what i owe you 🥲' },
  { text: 'the airbnb guy charged a cleaning fee?? 🧹' },
  { text: '“i’ll get you back” 🗓️ march 2024', react: '😂' },
  { text: 'did anyone keep the costco receipt 🛒' },
  { text: 'what was my part of the uber from like 3 weeks ago 🚕' },
  { text: 'i paid the deposit, that counts 🫡' },
  { text: 'i’m not paying for drinks i didn’t drink 🧃', react: '👎' },
  { text: 'rent’s due tomorrow, who’s sending utilities 💡' },
  { text: 'let’s just settle up after the trip ✌️' },
]
export const WALL_TILT = [-2, 1.5, 2, -1, -2.5, 1, -1.5, 2.5, -2, 1.5, -1, 2]
/** Starting colors for the 12 cells, blues scattered (about 1 in 3). Popped bubbles roll a new color. */
export const WALL_START_BLUE = [false, true, false, true, false, false, false, false, true, false, true, false]
/** Odds a freshly popped bubble comes back blue. */
export const WALL_BLUE_ODDS = 0.3
export const WALL_JUSTIFY = ['flex-end', 'center', 'flex-start', 'center', 'flex-start', 'flex-end', 'flex-start', 'flex-end', 'center', 'flex-end', 'center', 'flex-start'] as const
