'use client'

import { useEffect, useRef } from 'react'
import { track } from '@/lib/analytics'
import {
  BETA_GROUP_LIMIT,
  SHOW_TOTAL_FROM,
  SPOTS_PER_REFERRAL,
  positionBucket,
  spotUrl,
  type WaitlistSpot,
} from '@/lib/waitlist/referral-config'
import { ShareInvite } from './ShareInvite'

function friendsLine(n: number): string {
  if (n === 0) return 'No friends have joined from your link yet.'
  if (n === 1) return '1 friend has joined from your link so far.'
  return `${n.toLocaleString('en-US')} friends have joined from your link so far.`
}

/**
 * The result card after signing up (and on /w/<code>): the real position, the
 * real total once the list is big enough, referral progress and the share
 * button. Both landing page forms show the same result, so only the one that
 * was used takes focus (`focusOnShow`) and reports it (`reportShown`).
 */
export function SpotCard({
  spot,
  eyebrow,
  note,
  level = 2,
  focusOnShow = false,
  reportShown = false,
  showLater = true,
}: {
  spot: WaitlistSpot
  eyebrow: string
  note: string
  level?: 1 | 2 | 3
  focusOnShow?: boolean
  reportShown?: boolean
  /** The "check your spot anytime" link, left off on /w itself. */
  showLater?: boolean
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const Heading = `h${level}` as const

  useEffect(() => {
    if (focusOnShow) headingRef.current?.focus()
  }, [focusOnShow])
  useEffect(() => {
    if (reportShown) track('waitlist_position_shown', { position_bucket: positionBucket(spot.position) })
  }, [reportShown, spot.position])

  const spotLink = spotUrl(spot.refCode)

  return (
    <div className="spot">
      <p className="spot__eyebrow">
        <span className="mark mark--note" aria-hidden="true" />
        {eyebrow}
      </p>
      <Heading className="spot__title" tabIndex={-1} ref={headingRef}>
        You&rsquo;re <span className="spot__num">#{spot.position.toLocaleString('en-US')}</span> on the waitlist
      </Heading>
      {spot.total >= SHOW_TOTAL_FROM ? <p className="spot__total">{spot.total.toLocaleString('en-US')} people are waiting</p> : null}
      <div className="spot__boost">
        <p className="spot__rule">
          Each friend who joins with your link moves you up {SPOTS_PER_REFERRAL} spots. The beta opens to the first {BETA_GROUP_LIMIT} groups.
        </p>
        <p className="spot__friends">
          <span className="spot__count" aria-hidden="true">
            {spot.referralCount.toLocaleString('en-US')}
          </span>
          {friendsLine(spot.referralCount)}
        </p>
      </div>
      <ShareInvite url={spot.inviteUrl} />
      <p className="spot__note">{note}</p>
      {showLater ? (
        <p className="spot__later">
          Check your spot anytime at <a href={spotLink}>{spotLink.replace(/^https?:\/\//, '')}</a>
        </p>
      ) : null}
    </div>
  )
}
