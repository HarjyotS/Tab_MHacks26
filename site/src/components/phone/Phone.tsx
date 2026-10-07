import Image, { type StaticImageData } from 'next/image'
import type { CSSProperties, ReactNode } from 'react'
import { BackIcon, ChevronIcon, ComposerIcons, StatusIcons, VideoIcon } from './icons'

export type PhoneHeader = { title: string; avatars: [StaticImageData, StaticImageData] } | { title: string; tab: true }

/**
 * The design's iPhone mockup: a 402x874 iMessage screen inside a bezel.
 * It is drawn at full size and scaled with a transform (--s), so text inside
 * stays crisp and transform-based animations work in the phone's own pixels.
 * --dh shortens the device on small screens; the bezel is a CSS border-image
 * so it stretches cleanly.
 */
export function Phone({
  header,
  children,
  className,
  style,
  chatClassName,
}: {
  header: PhoneHeader
  children: ReactNode
  className?: string
  style?: CSSProperties
  chatClassName?: string
}) {
  return (
    <div className={'phone ' + (className ?? '')} style={style}>
      <div className="phone__scale">
        <div className="phone__device">
          <div className="phone__screen">
            <div className={'phone__chat ' + (chatClassName ?? '')}>{children}</div>
            <div className="phone__head" aria-hidden="true">
              <div className="phone__nav">
                <BackIcon />
                <VideoIcon />
              </div>
              <div className="phone__who">
                {'tab' in header ? (
                  <span className="phone__tab-avatar">t</span>
                ) : (
                  <div className="phone__avatars">
                    <Image src={header.avatars[0]} alt="" width={40} height={40} className="phone__av1" />
                    <Image src={header.avatars[1]} alt="" width={30} height={30} className="phone__av2" />
                  </div>
                )}
                <div className="phone__title">
                  <span>{header.title}</span>
                  <ChevronIcon />
                </div>
              </div>
            </div>
            <div className="phone__status" aria-hidden="true">
              <span className="phone__time">9:41</span>
              <StatusIcons />
            </div>
            <div className="phone__bottom" aria-hidden="true">
              <ComposerIcons />
            </div>
            <div className="phone__home" aria-hidden="true" />
          </div>
          <div className="phone__frame" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
