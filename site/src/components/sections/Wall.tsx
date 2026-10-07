import { WALL_POOL, WALL_START_BLUE } from '@/content/chats'
import { WALL_CELLS, bubbleClass, bubbleStyle, cellStyle, floatStyle } from './wall-style'
import { WallIsland } from '../client/Islands'

function StaticWall() {
  return (
    <div className="wall">
      {Array.from({ length: WALL_CELLS }, (_, i) => (
        <span className="wall__cell" style={cellStyle(i)} key={i}>
          <span className="wall__par">
            <span className="wall__float bob" style={floatStyle(i)}>
              <span className={bubbleClass(WALL_START_BLUE[i])} style={bubbleStyle(i)}>
                {WALL_POOL[i].text}
                {WALL_POOL[i].react ? (
                  <span className="wall__react" aria-hidden="true">
                    {WALL_POOL[i].react}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        </span>
      ))}
    </div>
  )
}

export function WallSection() {
  return (
    <section className="pain" aria-labelledby="pain-title" data-section="wall">
      <div className="pain__inner wrap">
        <h2 id="pain-title" className="h2 h2--88" data-split="">
          Every group trip ends in the same forty texts.
        </h2>
        <WallIsland>
          <StaticWall />
        </WallIsland>
        <p className="pain__hint">Pop one. There&apos;s always another.</p>
        <p className="pain__close">Tab ends that conversation before it starts.</p>
      </div>
    </section>
  )
}
