import { CHATS } from '@/content/chats'
import { CHAT_CARDS } from '@/content/cards'
import { buildThread } from '@/lib/thread'
import { Phone } from '../phone/Phone'
import { ThreadParts } from '../phone/ThreadView'
import { tiClass } from '../phone/ti'
import { ChatsIsland } from '../client/Islands'

function ChatsStatic() {
  return (
    <div className="chats__row">
      {CHAT_CARDS.map((c) => {
        const chat = CHATS[c.chat]
        return (
          <div className="chat-card" key={c.chat}>
            <Phone header={c.header} className="phone--card">
              <div className="thread">
                {buildThread(chat.msgs, { group: chat.group }).map((it) => (
                  <div className={tiClass(it)} key={it.key}>
                    <ThreadParts item={it} />
                  </div>
                ))}
              </div>
            </Phone>
            <div className="chat-card__caption">
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ChatsSection() {
  return (
    <section id="chats" className="chats" data-section="chats">
      <div className="chats__inner wrap">
        <div className="intro intro--640">
          <h2 className="h2 h2--56" data-split="">
            Watch Tab work the group chat.
          </h2>
          <p className="lede lede--150">Tab stays quiet while you talk, logs what matters, and only speaks up when there&apos;s something to settle.</p>
        </div>
        <ChatsIsland>
          <ChatsStatic />
        </ChatsIsland>
      </div>
    </section>
  )
}
