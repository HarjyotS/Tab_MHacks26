import Image, { type StaticImageData } from 'next/image'
import type { PersonId, Reaction } from '@/content/chats'
import type { MsgItem, ThreadItem } from '@/lib/thread'
import { TapbackShape, Tail } from './icons'
import maya from '@/assets/maya.png'
import jordan from '@/assets/jordan.png'
import sam from '@/assets/sam.png'
import ava from '@/assets/ava.png'
import jake from '@/assets/jake.png'
import priya from '@/assets/priya.png'
import leo from '@/assets/leo.png'
import heart from '@/assets/react-heart.png'
import haha from '@/assets/react-haha.png'
import thumbs from '@/assets/react-thumbs.png'

export const PHOTOS: Partial<Record<PersonId, StaticImageData>> = { maya, jordan, sam, ava, jake, priya, leo }
const EMOJI: Record<Reaction, StaticImageData> = { heart, haha, thumbs }
const REACTION_LABEL: Record<Reaction, string> = { heart: 'loved', haha: 'laughed at', thumbs: 'liked' }

export function Tapback({ item, pop }: { item: MsgItem; pop?: boolean }) {
  if (!item.react) return null
  return (
    <span className={'t-react ' + (item.incoming ? 't-react--in' : 't-react--out') + (pop ? ' t-react--pop' : '')} aria-hidden="true">
      <span className="t-react__circle" />
      <TapbackShape incoming={item.incoming} />
      <Image src={EMOJI[item.react]} alt="" width={18} height={18} className="t-react__emoji" />
    </span>
  )
}

/** One message row's bubble area (avatar, tail, bubble, tapback). */
function MessageRow({ item, showReaction, popReaction }: { item: MsgItem; showReaction: boolean; popReaction?: boolean }) {
  const photo = item.showPhoto ? PHOTOS[item.who as PersonId] : undefined
  const wrapClass =
    't-wrap' +
    (item.padTail ? (item.incoming ? ' t-wrap--pl' : ' t-wrap--pr') : '') +
    (item.reacted ? ' t-wrap--reacted' : '')
  return (
    <div className={'t-row ' + (item.incoming ? 't-row--in' : 't-row--out') + (item.first ? ' t-row--first' : '')}>
      {photo ? <Image src={photo} alt="" width={30} height={30} className="t-photo" /> : null}
      {item.showTabAvatar ? (
        <span className="t-tabav" aria-hidden="true">
          t
        </span>
      ) : null}
      {item.spacer ? <span className="t-spacer" /> : null}
      <div className={wrapClass}>
        {item.tailLeft ? <Tail /> : null}
        {item.kind === 'text' ? <div className={'b ' + (item.incoming ? 'b--in' : 'b--out')}>{item.text}</div> : null}
        {item.kind === 'typing' ? (
          <div className="typing" aria-label="Tab is typing" role="img">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        ) : null}
        {item.kind === 'receipt' && item.receipt ? (
          <div className="t-receipt" role="img" aria-label={item.receipt.label}>
            <span className="t-receipt__title">{item.receipt.title}</span>
            <span className="t-receipt__body">{item.receipt.body}</span>
            <span className="t-receipt__total">
              <span>Total</span>
              <span>{item.receipt.total}</span>
            </span>
          </div>
        ) : null}
        {item.kind === 'link' && item.link ? (
          <div className="t-link">
            <div className="t-link__art" aria-hidden="true">
              <span />
            </div>
            <div className="t-link__text">
              <span className="t-link__title">{item.link.title}</span>
              <span className="t-link__sub">{item.link.sub}</span>
            </div>
          </div>
        ) : null}
        {item.tailRight ? <Tail out /> : null}
        {item.reacted && showReaction ? <Tapback item={item} pop={popReaction} /> : null}
      </div>
    </div>
  )
}

function srLabel(item: MsgItem): string {
  const who = item.who === 'me' ? 'You' : item.name
  const react = item.reacted && item.react ? ` (${REACTION_LABEL[item.react]})` : ''
  return `${who}${react}: `
}

/**
 * Everything one thread item renders, without an outer wrapper, so callers can
 * wrap it in a plain div (scroll timeline) or a motion.div (looping phones).
 *
 * deliveredMode "absolute" hangs "Delivered" below the bubble without taking
 * space, so the scroll-driven Vegas chat can show and hide it without moving
 * anything else.
 */
export function ThreadParts({
  item,
  delivered,
  deliveredMode = 'flow',
  showReaction = true,
  popReaction,
}: {
  item: ThreadItem
  delivered?: boolean
  deliveredMode?: 'flow' | 'absolute'
  showReaction?: boolean
  /** Looping phones: the tapback pops in when it appears. */
  popReaction?: boolean
}) {
  if (item.type === 'time') {
    return (
      <div className="t-time">
        <b>{item.day}</b>
        {item.rest}
      </div>
    )
  }
  if (item.type === 'note') {
    return (
      <div className={'t-note ' + (item.out ? 't-note--out' : item.group ? 't-note--in' : 't-note--dm')}>
        {item.logged ? <span className="t-mark" aria-hidden="true" /> : null}
        {item.text}
      </div>
    )
  }
  const showDelivered = delivered ?? item.delivered
  return (
    <>
      {item.showName ? (
        <div className="t-name" aria-hidden="true">
          {item.name}
        </div>
      ) : null}
      <span className="sr-only">{item.kind === 'typing' ? '' : srLabel(item)}</span>
      <MessageRow item={item} showReaction={showReaction} popReaction={popReaction} />
      {deliveredMode === 'absolute' && !item.incoming ? (
        <div className="t-delivered t-delivered--abs" data-delivered="" aria-hidden={showDelivered ? undefined : true}>
          Delivered
        </div>
      ) : showDelivered ? (
        <div className="t-delivered">Delivered</div>
      ) : null}
    </>
  )
}
