// Turns a conversation script into renderable iMessage rows. A typed port of the
// design's buildThread(): same grouping rules for names, avatars, tails,
// tapbacks and the "Delivered" receipt.
import { PEOPLE, type Chat, type Msg, type PersonId, type Reaction } from '@/content/chats'

export function money(cents: number): string {
  const [whole, frac] = (cents / 100).toFixed(2).split('.')
  return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac
}

export function receiptBody(lines: [string, number][]): string {
  return lines
    .map(([name, cents]) => name.padEnd(13, ' ') + (cents / 100).toFixed(2).padStart(6, ' '))
    .join('\n')
}

export type TimeItem = { type: 'time'; key: string; day: string; rest: string }
export type NoteItem = { type: 'note'; key: string; text: string; logged: boolean; out: boolean; group: boolean }
export type MsgItem = {
  type: 'msg'
  key: string
  /** Index of the message in its script, or -1 for the typing indicator. */
  index: number
  who: PersonId | 'me'
  incoming: boolean
  isTab: boolean
  name: string
  showName: boolean
  showPhoto: boolean
  showTabAvatar: boolean
  spacer: boolean
  first: boolean
  last: boolean
  kind: 'text' | 'typing' | 'receipt' | 'link'
  text: string
  tailLeft: boolean
  tailRight: boolean
  padTail: boolean
  receipt?: { title: string; body: string; total: string; label: string }
  link?: { title: string; sub: string }
  react?: Reaction
  reacted: boolean
  delivered: boolean
}
export type ThreadItem = TimeItem | NoteItem | MsgItem

type Shown = Msg & { _i: number; _typing?: boolean }

export function buildThread(msgs: Msg[], opts: { count?: number; typing?: boolean; group: boolean }): ThreadItem[] {
  const count = opts.count ?? msgs.length
  const shown: Shown[] = msgs.slice(0, count).map((m, i) => ({ ...m, _i: i }))
  const all: Shown[] = opts.typing ? [...shown, { who: 'tab', _i: -1, _typing: true }] : shown
  const group = opts.group

  const isLogged = (m: Shown) => m.kind === 'logged'
  const prevP = (i: number) => {
    let j = i - 1
    while (j >= 0 && isLogged(all[j])) j--
    return j >= 0 ? all[j] : null
  }
  const nextP = (i: number) => {
    let j = i + 1
    while (j < all.length && isLogged(all[j])) j++
    return j < all.length ? all[j] : null
  }
  let lastMsg = -1
  all.forEach((m, i) => {
    if (m.who !== 'sys') lastMsg = i
  })

  return all.map((m, i): ThreadItem => {
    const key = m._typing ? 'typing' : String(m._i)
    const kind = m._typing ? 'typing' : (m.kind ?? 'text')
    if (m.who === 'sys') {
      const text = String(m.text ?? '')
      if (kind === 'time') {
        const parts = text.split(' ')
        return /\d:\d/.test(text)
          ? { type: 'time', key, day: parts[0], rest: ' ' + parts.slice(1).join(' ') }
          : { type: 'time', key, day: text, rest: '' }
      }
      return { type: 'note', key, text, logged: kind === 'logged', out: m.dir === 'out', group }
    }
    const who = m.who as PersonId | 'me'
    const incoming = who !== 'me'
    const prev = prevP(i)
    const next = nextP(i)
    const first = !prev || prev.who !== m.who
    const last = !next || next.who !== m.who
    const isTab = who === 'tab'
    const bubbleKind = kind === 'text' || kind === 'typing'
    const reacted = !!m.react && i < lastMsg
    const item: MsgItem = {
      type: 'msg',
      key,
      index: m._i,
      who,
      incoming,
      isTab,
      name: who === 'me' ? '' : PEOPLE[who].name,
      showName: group && incoming && first,
      showPhoto: group && incoming && last && !isTab,
      showTabAvatar: group && incoming && last && isTab,
      spacer: group && incoming && !last,
      first,
      last,
      kind: kind as MsgItem['kind'],
      text: m.text ?? '',
      tailLeft: incoming && last && bubbleKind,
      tailRight: !incoming && last && bubbleKind,
      padTail: bubbleKind && !last,
      react: m.react,
      reacted,
      delivered: !incoming && i === all.length - 1,
    }
    if (m.rLines && m.rTitle && m.rTotal != null) {
      item.receipt = {
        title: m.rTitle,
        body: receiptBody(m.rLines),
        total: (m.rTotal / 100).toFixed(2),
        label: 'Photo of a receipt from ' + m.rTitle + ', total ' + money(m.rTotal),
      }
    }
    if (kind === 'link') item.link = { title: m.title ?? '', sub: m.sub ?? '' }
    return item
  })
}

/** Playback frames for a looping chat: a typing frame precedes every message from Tab. */
export function chatFrames(msgs: Msg[]): { count: number; typing: boolean }[] {
  const out: { count: number; typing: boolean }[] = []
  msgs.forEach((m, i) => {
    if (m.who === 'tab') out.push({ count: i, typing: true })
    out.push({ count: i + 1, typing: false })
  })
  return out
}

export function frameAt(chat: Chat, tick: number) {
  const frames = chatFrames(chat.msgs)
  const total = frames.length + 4
  const idx = (tick + chat.offset) % total
  return frames[Math.min(idx, frames.length - 1)]
}
