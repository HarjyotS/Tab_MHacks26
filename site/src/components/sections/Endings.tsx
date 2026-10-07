import { ENDINGS } from '@/content/chats'
import { ENDING_HEADER, ENDING_OPTIONS } from '@/content/cards'
import { buildThread } from '@/lib/thread'
import { Phone } from '../phone/Phone'
import { ThreadParts } from '../phone/ThreadView'
import { tiClass } from '../phone/ti'
import { EndingsIsland } from '../client/Islands'

/**
 * No-JS version: a native radio group, and both endings in the phone with CSS
 * (:has(:checked)) showing the chosen one. Works with no JavaScript at all.
 */
function EndingsStatic() {
  return (
    <>
      <fieldset className="seg endings__toggle">
        <legend className="sr-only">Choose an ending</legend>
        {ENDING_OPTIONS.map((o) => (
          <label className="seg__opt" key={o.value}>
            <input type="radio" name="ending" value={o.value} defaultChecked={o.value === 'without'} className="seg__input" />
            <span className="seg__text">{o.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="endings__phone">
        <Phone header={ENDING_HEADER} className="phone--ending">
          {ENDING_OPTIONS.map((o) => (
            <div className={'ending-thread ending-thread--' + o.value} key={o.value}>
              {buildThread(ENDINGS[o.value], { group: true }).map((it) => (
                <div className={tiClass(it)} key={it.key}>
                  <ThreadParts item={it} />
                </div>
              ))}
            </div>
          ))}
        </Phone>
      </div>
    </>
  )
}

export function EndingsSection() {
  return (
    <section className="endings wrap" aria-labelledby="endings-title" data-section="endings">
      <div className="endings__intro">
        <h2 id="endings-title" className="h2 h2--64" data-split="">
          Same trip. Two endings.
        </h2>
        <p className="lede lede--28">
          Five friends, one Vegas weekend, fourteen expenses. One version ends three weeks later with a group chat nobody wants to open. The other
          ends before the flight home.
        </p>
      </div>
      <EndingsIsland>
        <EndingsStatic />
      </EndingsIsland>
    </section>
  )
}
