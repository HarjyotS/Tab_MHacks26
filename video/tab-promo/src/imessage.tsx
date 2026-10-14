// Authentic iMessage (iOS light mode) pieces. Measurements follow iOS at ~2.3x
// so they read on a 1080p frame: 17pt body → 38px, 13pt names → 28px.
import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { E, lerp, seg } from './theme';

export const IOS = {
  font: "-apple-system, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Apple Color Emoji', sans-serif",
  blue: '#007aff',
  gray: '#e9e9eb',
  grayLight: '#e5e5ea',
  name: '#8a8a8e',
  bg: '#ffffff',
  text: '#000000',
  textMe: '#ffffff',
};

export const AVATAR_COLORS: Record<string, string> = {
  Alex: '#5e9ef4', Sam: '#f2a65a', Priya: '#b07cf0', Jordan: '#57c48b', Tab: '#ee5d3f', Kien: '#6aa5e8',
};

/** Optional contact book (gen 2): resolves a sender name to a photo / initials / tint.
 *  Without a provider nothing changes. */
export type ContactInfo = { img?: string; initials?: string; background?: string };
export const ContactBook = React.createContext<(name: string) => ContactInfo | undefined>(() => undefined);

/** iOS contact circle: photo or gradient initials. */
export const ContactPhoto: React.FC<{ name: string; size?: number; img?: string; style?: React.CSSProperties }> = ({ name, size = 52, img, style }) => {
  const info = React.useContext(ContactBook)(name);
  const src = img ?? info?.img;
  return (
    <div
      data-box={`avatar:${name}`}
      style={{
        width: size, height: size, borderRadius: size / 2, flex: 'none', overflow: 'hidden',
        background: name === 'Tab' ? 'linear-gradient(160deg,#ff7a5c,#ee5d3f)' : info?.background ?? `linear-gradient(180deg, ${AVATAR_COLORS[name] ?? '#8e8e93'}, ${shade(AVATAR_COLORS[name] ?? '#8e8e93')})`,
        display: 'grid', placeItems: 'center',
        font: `600 ${Math.round(size * 0.42)}px ${IOS.font}`, color: '#fff',
        ...style,
      }}
    >
      {src ? <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : name === 'Tab' ? 'T' : info?.initials ?? name.slice(0, 1)}
    </div>
  );
};
const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40), g = Math.max(0, ((n >> 8) & 255) - 40), b = Math.max(0, (n & 255) - 40);
  return `rgb(${r},${g},${b})`;
};

/** The bubble tail, drawn like iOS (a curl at the bottom corner). */
export const Tail: React.FC<{ side: 'left' | 'right'; color: string }> = ({ side, color }) => (
  <svg width={22} height={26} viewBox="0 0 22 26" style={{ position: 'absolute', bottom: 0, [side]: -7, transform: side === 'right' ? 'scaleX(-1)' : undefined } as React.CSSProperties}>
    <path d="M22 0 C22 12 16 22 0 26 C9 24 14 20 15 14 L15 0 Z" fill={color} />
  </svg>
);

export type IMsg = {
  id: string;
  from: string; // sender name; `me` sends blue
  text?: string;
  img?: string; // photo message
  imgW?: number;
  at: number;
  /** `also`: frames where more people add the same reaction (badge shows a count);
   *  `mine`: the phone owner reacted (blue badge). Both optional (gen 2). */
  tapback?: { glyph: string; at: number; also?: number[]; mine?: boolean };
  photo?: React.ReactNode; // gen 2: a live-rendered photo message (sized by imgW)
  system?: boolean; // gen 2: centered gray system / timestamp row (uses `text`)
};

const DAY = /^(Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

/** Centered gray row: "You added Tab to the conversation." / "Today 10:52 PM" (day in semibold). */
export const ISystem: React.FC<{ text: string; id?: string; style?: React.CSSProperties }> = ({ text, id = text, style }) => {
  const day = text.match(DAY)?.[0];
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0', ...style }}>
      <div data-box={`system:${id}`} style={{ font: `400 30px/1.25 ${IOS.font}`, color: IOS.name, textAlign: 'center', maxWidth: '92%' }}>
        {day ? <><span style={{ fontWeight: 600 }}>{day}</span>{text.slice(day.length)}</> : text}
      </div>
    </div>
  );
};

/** The blue unread count iOS puts next to the back chevron ("‹ 99+"). */
export const IUnread: React.FC<{ count: number; style?: React.CSSProperties }> = ({ count, style }) => (
  <div data-box="unread" style={{ height: 44, minWidth: 44, padding: '0 13px', borderRadius: 22, background: IOS.blue, color: '#fff', font: `600 30px/44px ${IOS.font}`, textAlign: 'center', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box', ...style }}>
    {count > 99 ? '99+' : count}
  </div>
);

type BubbleProps = { m: IMsg; me: boolean; showName: boolean; showAvatar: boolean; maxW: number; size?: number };

/** One iMessage row: avatar slot + name + bubble (with tail on the last of a run). */
export const IBubble: React.FC<BubbleProps> = ({ m, me, showName, showAvatar, maxW, size = 38 }) => {
  const frame = useCurrentFrame();
  const p = seg(frame, m.at, m.at + 10, E.land);
  if (frame < m.at) return null;
  if (m.system) return <div style={{ opacity: Math.min(1, p * 1.6) }}><ISystem text={m.text ?? ''} id={m.id} /></div>;
  const color = me ? IOS.blue : IOS.gray;
  const tb = m.tapback ? seg(frame, m.tapback.at, m.tapback.at + 9, E.land) : 0;
  const hits = m.tapback?.also?.filter((f) => frame >= f) ?? [];
  const count = 1 + hits.length;
  const lastHit = hits.length ? Math.max(...hits) : -1;
  const bump = lastHit < 0 ? 1 : frame - lastHit < 3 ? lerp(seg(frame, lastHit, lastHit + 3, E.outCubic), 1, 1.28) : Math.max(1, lerp(E.outBack(seg(frame, lastHit + 3, lastHit + 12), 2), 1.28, 1));
  return (
    <div style={{ display: 'flex', flexDirection: me ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 12, paddingTop: m.tapback && !showName ? 52 : 0, opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * 22}px) scale(${lerp(p, 0.94, 1)})`, transformOrigin: me ? 'right bottom' : 'left bottom' }}>
      {!me && <div style={{ width: 52, flex: 'none' }}>{showAvatar && <ContactPhoto name={m.from} size={52} />}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start', maxWidth: maxW }}>
        {showName && !me && <div data-box={`name:${m.id}`} style={{ font: `400 30px ${IOS.font}`, color: IOS.name, margin: '0 0 6px 18px' }}>{m.from}</div>}
        <div style={{ position: 'relative' }}>
          {m.img ? (
            <Img data-box={`photo:${m.id}`} src={staticFile(m.img)} style={{ width: m.imgW ?? 260, borderRadius: 34, display: 'block' }} />
          ) : m.photo ? (
            <div data-box={`photo:${m.id}`} style={{ width: m.imgW ?? 260, borderRadius: 34, overflow: 'hidden', position: 'relative' }}>{m.photo}</div>
          ) : (
            <div data-box={`bubble:${m.id}`} style={{ position: 'relative', background: color, color: me ? IOS.textMe : IOS.text, borderRadius: 36, padding: '14px 26px 16px', font: `400 ${size}px/1.28 ${IOS.font}`, letterSpacing: '-0.01em', whiteSpace: 'pre-wrap' }}>
              {m.text}
              {showAvatar && <Tail side={me ? 'right' : 'left'} color={color} />}
            </div>
          )}
          {m.tapback && tb > 0 && count > 1 && [2, 1].filter((k) => count > k).map((k) => (
            <div key={k} style={{ position: 'absolute', top: -60 - 7 * k, [me ? 'left' : 'right']: 8 + 9 * k, width: 62, height: 54, borderRadius: 27, background: m.tapback!.mine ? '#4da3ff' : '#d8d8dd', border: `3px solid ${IOS.bg}`, transform: `scale(${tb})`, transformOrigin: 'center bottom' } as React.CSSProperties} />
          ))}
          {m.tapback && tb > 0 && (
            <div data-box={`tapback:${m.id}`} style={{ position: 'absolute', top: -60, [me ? 'left' : 'right']: 8, transform: `scale(${tb * bump})`, transformOrigin: 'center bottom', width: 62, height: 54, borderRadius: 27, background: m.tapback.mine ? IOS.blue : IOS.grayLight, border: `3px solid ${IOS.bg}`, boxShadow: '0 2px 6px rgba(0,0,0,0.12)', display: 'grid', placeItems: 'center', fontSize: 34, ...(count > 1 ? { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: 'auto', minWidth: 62, padding: '0 18px 0 12px' } : null) } as React.CSSProperties}>
              {m.tapback.glyph}
              {count > 1 && <span style={{ font: `600 30px ${IOS.font}`, color: m.tapback.mine ? '#fff' : '#3a3a3c', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** A run of messages laid out like iMessage: names on the first of a run, avatar + tail on the last. */
export const IThread: React.FC<{ msgs: IMsg[]; me?: string; maxW?: number; gap?: number; size?: number }> = ({ msgs, me = '', maxW = 560, gap = 8, size }) => {
  const frame = useCurrentFrame();
  const visible = msgs.filter((m) => frame >= m.at);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {visible.map((m, i) => {
        const prev = visible[i - 1];
        const next = visible[i + 1];
        const isMe = m.from === me;
        return (
          <div key={m.id} style={{ marginTop: prev && prev.from !== m.from ? 14 : 0 }}>
            <IBubble m={m} me={isMe} showName={!prev || prev.from !== m.from} showAvatar={!next || next.from !== m.from} maxW={maxW} size={size} />
          </div>
        );
      })}
    </div>
  );
};

/** iOS typing indicator (three pulsing dots in a gray bubble). */
export const Typing: React.FC<{ from: string; at: number; until: number }> = ({ from, at, until }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame >= until) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
      <ContactPhoto name={from} size={52} />
      <div data-box={`typing:${from}`} style={{ position: 'relative', background: IOS.gray, borderRadius: 32, padding: '18px 24px', display: 'flex', gap: 9 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: 8, background: '#8e8e93', opacity: 0.35 + 0.65 * Math.max(0, Math.sin((frame - at) / 4 - i * 0.9)) }} />
        ))}
        <Tail side="left" color={IOS.gray} />
      </div>
    </div>
  );
};

/** iPhone 15-style frame (light-mode Messages): titanium rail, thin bezel, island. */
export const IPhone: React.FC<{
  width?: number; height?: number; title: string; members: string[]; children: React.ReactNode; style?: React.CSSProperties;
  /** gen 2: shown right of the back chevron (e.g. <IUnread count={99} />) */ back?: React.ReactNode;
  /** gen 2: drawn over the whole screen (in-phone banners) */ overlay?: React.ReactNode;
}> = ({ width = 520, height = 1000, title, members, children, style, back, overlay }) => (
  <div data-box="phone" style={{ position: 'absolute', width, height, borderRadius: 86, padding: 5, background: 'linear-gradient(145deg, #e9e9ee 0%, #a9a9b1 35%, #d8d8de 60%, #8e8e96 100%)', boxShadow: '0 50px 110px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.25)', ...style }}>
    {[{ top: 210, h: 70, side: 'left' }, { top: 300, h: 110, side: 'left' }, { top: 430, h: 110, side: 'left' }, { top: 300, h: 160, side: 'right' }].map((b, i) => (
      <div key={i} style={{ position: 'absolute', top: b.top, [b.side]: -4, width: 5, height: b.h, borderRadius: 3, background: 'linear-gradient(90deg,#b8b8bf,#8a8a92)' } as React.CSSProperties} />
    ))}
    <div style={{ width: '100%', height: '100%', borderRadius: 81, padding: 11, background: '#0b0b0c' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 70, background: IOS.bg, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 14, left: '50%', marginLeft: -64, width: 128, height: 38, borderRadius: 20, background: '#000' }} />
        <div style={{ position: 'absolute', top: 18, left: 50, font: `600 30px ${IOS.font}`, color: '#000' }}>9:41</div>
        <div style={{ position: 'absolute', top: 18, right: 46, display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 34, height: 18, borderRadius: 5, border: '2px solid #000', position: 'relative' }}><div style={{ position: 'absolute', inset: 2, right: 6, borderRadius: 2, background: '#000' }} /></div>
        </div>
        <div style={{ position: 'absolute', top: 70, left: 0, right: 0, height: 150, background: 'rgba(247,247,249,0.96)', borderBottom: '1px solid rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ position: 'absolute', left: 24, top: 48, font: `400 46px ${IOS.font}`, color: IOS.blue }}>‹</div>
          {back && <div style={{ position: 'absolute', left: 52, top: 53 }}>{back}</div>}
          <div data-overlay="1" style={{ display: 'flex' }}>
            {members.slice(0, 5).map((n, i) => <ContactPhoto key={n} name={n} size={50} style={{ marginLeft: i ? -14 : 0, border: '2px solid #f7f7f9' }} />)}
          </div>
          <div style={{ font: `500 30px ${IOS.font}`, color: '#000' }}>{title} <span style={{ color: IOS.name }}>›</span></div>
        </div>
        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 112, top: 236, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
          {children}
        </div>
        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 30, height: 64, borderRadius: 32, border: '2px solid #d1d1d6', display: 'flex', alignItems: 'center', padding: '0 26px', font: `400 30px ${IOS.font}`, color: '#8e8e93' }}>
          iMessage
        </div>
        <div style={{ position: 'absolute', bottom: 8, left: '50%', marginLeft: -70, width: 140, height: 6, borderRadius: 3, background: '#000' }} />
        {overlay}
      </div>
    </div>
  </div>
);

/** iOS notification banner. */
export const IBanner: React.FC<{ app: string; title: string; body: string; icon?: React.ReactNode; style?: React.CSSProperties; bodySize?: number }> = ({ app, title, body, icon, style, bodySize = 32 }) => (
  <div data-box={`banner:${title}`} style={{ width: 880, borderRadius: 44, padding: '26px 30px', background: 'rgba(250,250,252,0.82)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', gap: 22, alignItems: 'center', ...style }}>
    {icon ?? <ContactPhoto name="Tab" size={84} />}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 30px ${IOS.font}`, color: '#000' }}>
        <span>{title}</span><span style={{ font: `400 30px ${IOS.font}`, color: IOS.name }}>now</span>
      </div>
      <div style={{ font: `400 ${bodySize}px/1.3 ${IOS.font}`, color: '#000', marginTop: 4, whiteSpace: 'pre-line' }}>{body}</div>
      <div style={{ font: `400 30px ${IOS.font}`, color: IOS.name, marginTop: 4 }}>{app}</div>
    </div>
  </div>
);

/** A cropped light-mode Messages screen for threads shown off the phone. */
export const ICard: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; name?: string }> = ({ children, style, name = 'card' }) => (
  <div data-box={`icard:${name}`} style={{ background: IOS.bg, borderRadius: 48, padding: '30px 30px 34px', boxShadow: '0 30px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04)', ...style }}>
    {children}
  </div>
);
