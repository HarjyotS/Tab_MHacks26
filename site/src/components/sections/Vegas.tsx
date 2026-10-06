import { CHATS, IGNORED_AT, LEDGER, VEGAS_PEOPLE } from '@/content/chats'
import { buildThread, money, type MsgItem } from '@/lib/thread'
import { Phone } from '../phone/Phone'
import { ThreadParts } from '../phone/ThreadView'
import { Enhance } from '../client/Enhance'
import maya from '@/assets/maya.png'
import jordan from '@/assets/jordan.png'

const vegas = CHATS.vegas
const TOTAL_CENTS = LEDGER.reduce((s, l) => s + l.cents, 0)
const EACH_CENTS = Math.round(TOTAL_CENTS / VEGAS_PEOPLE)

/**
 * The Vegas weekend. Server-rendered in its finished state (whole chat, full
 * receipt, SETTLED stamp), which is what no-JS and reduced-motion visitors
 * see. The scroll timeline (enhancers/VegasTimeline) rewinds it to empty and
 * lets the scroll position play the weekend.
 */
export function VegasSection() {
  const items = buildThread(vegas.msgs, { group: true })
  // The typing indicator Tab shows right before its summary (SETTLE_AT).
  const tabIndex = vegas.msgs.findIndex((m) => m.who === 'tab')
  const typing = buildThread(vegas.msgs, { group: true, count: tabIndex, typing: true }).at(-1) as MsgItem

  return (
    <section className="vegas" aria-label="Tab logging a Vegas trip over a weekend" data-enhance="" data-section="vegas">
      <div className="vegas__stage">
        <Phone header={{ title: 'Vegas Trip 2026 🎰', avatars: [maya, jordan] }} className="vegas__phone">
          <div className="vegas-col" data-col="">
            {items.map((it, i) => (
              <div
                key={it.key}
                className={'ti ti--' + it.type + (it.type === 'msg' ? (it.incoming ? ' ti--in' : ' ti--out') : '')}
                data-i={i}
              >
                <ThreadParts item={it} deliveredMode="absolute" />
              </div>
            ))}
            <div className="ti ti--msg ti--in ti--typing is-off" data-typing="" aria-hidden="true">
              <ThreadParts item={typing} />
            </div>
          </div>
        </Phone>

        <div className="receipt" data-receipt="">
          <div className="receipt__bar" aria-hidden="true" />
          <div className="receipt__paper">
            <div className="receipt__body">
              <div className="receipt__head">
                <span className="receipt__brand">
                  <span className="mark mark--receipt" aria-hidden="true" />
                  tab
                </span>
                <span className="receipt__titles">
                  <span className="receipt__title">Vegas Trip 2026</span>
                  <span className="receipt__sub">{VEGAS_PEOPLE} people, running tab</span>
                </span>
              </div>
              <div className="r-window" data-window="">
                <div className="r-lines" data-lines="">
                  {LEDGER.map((l, i) => (
                    <div className="r-line" key={i} data-at={l.at}>
                      <span className="r-line__what">{l.what}</span>
                      <span className="r-line__who">{l.who}</span>
                      <span className="r-fill" aria-hidden="true" />
                      <span className="r-line__amt">{money(l.cents)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="r-listen is-off" data-listen="" aria-hidden="true">
                <span className="dot" />
                <span>Listening to the chat</span>
              </div>
              <div className="receipt__foot">
                <div className="r-row r-row--ign">
                  <span>Messages ignored</span>
                  <span className="r-fill r-fill--soft" aria-hidden="true" />
                  <span data-ignored="">{IGNORED_AT.length}</span>
                </div>
                <div className="r-row r-row--exp">
                  <span>Expenses logged</span>
                  <span className="r-fill r-fill--soft" aria-hidden="true" />
                  <span data-expenses="">{LEDGER.length}</span>
                </div>
                <div className="r-row r-row--total">
                  <span>Total</span>
                  <span className="r-flex" />
                  <span data-total="">{money(TOTAL_CENTS)}</span>
                </div>
                <div className="r-row r-row--each" data-settled="">
                  <span>Each</span>
                  <span className="r-fill r-fill--soft" aria-hidden="true" />
                  <span>{money(EACH_CENTS)}</span>
                </div>
                <div className="r-row r-row--pay" data-settled="">
                  <span>Payments needed</span>
                  <span className="r-fill r-fill--soft" aria-hidden="true" />
                  <span>4</span>
                </div>
              </div>
            </div>
            <svg className="receipt__edge" viewBox="0 0 300 14" preserveAspectRatio="none" width="100%" height="14" aria-hidden="true">
              <polygon
                points="0,0 300,0 300,4 290,14 280,4 270,14 260,4 250,14 240,4 230,14 220,4 210,14 200,4 190,14 180,4 170,14 160,4 150,14 140,4 130,14 120,4 110,14 100,4 90,14 80,4 70,14 60,4 50,14 40,4 30,14 20,4 10,14 0,4"
                fill="#F7F6F2"
                stroke="#E7E5DF"
                strokeWidth="1"
              />
            </svg>
            <div className="stamp" data-stamp="">
              SETTLED
            </div>
          </div>
        </div>
      </div>
      <Enhance which="vegas" />
    </section>
  )
}
