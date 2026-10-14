// Gen 2 group chat: a data-driven flood on the light-mode IPhone. Builds on
// src/imessage.tsx (IBubble, ISystem, Typing, IBanner, IUnread, ContactPhoto)
// and adds what a 20-message avalanche needs: rows that grow in smoothly (the
// thread scrolls instead of jumping), stacked typing bubbles, an anchor-based
// scroll path, the "‹ 99+" back badge, an iOS notification stack (banners that
// collapse into blank slivers), R-top portraits and R-bottom side captions.
import React, { useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { ContactPhoto, IBanner, IBubble, IMsg, IPhone, IUnread, Typing } from '../imessage';
import { clamp01, E, FONT_B, lerp, rand, seg } from '../theme';
import { CastId, Contacts, firstExisting } from './cast';
import { PortraitStage, SideCaption } from './kit';

export type TypingSpan = { from: string; at: number; until: number };
/** Scroll keys: at `at`, move over `dur` frames to either a raw offset `y`
 *  (px up from the newest message; 0 = follow the bottom) or so that message
 *  `anchor`'s top (or bottom) sits `pad` px inside the viewport. Holds until the next key. */
export type ScrollKey = { at: number; dur?: number; y?: number; anchor?: string; align?: 'top' | 'bottom'; pad?: number };
export type NumKey = { at: number; v: number };

/** Piecewise-linear keyframes (holds before the first / after the last). */
export const keyed = (frame: number, keys: NumKey[], fallback = 0) => {
  if (!keys.length) return fallback;
  if (frame <= keys[0].at) return frame < keys[0].at ? fallback : keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (frame <= b.at) return lerp(clamp01((frame - a.at) / Math.max(1, b.at - a.at)), a.v, b.v);
  }
  return keys[keys.length - 1].v;
};

const Grow: React.FC<{ g: number; mt: number; id?: string; children: React.ReactNode }> = ({ g, mt, id, children }) => (
  // grid `fr` interpolates an auto height without measuring: 0fr → 1fr
  <div data-row={id} style={{ display: 'grid', gridTemplateRows: `${g}fr`, marginTop: mt * g }}>
    <div style={{ minHeight: 0 }}>{children}</div>
  </div>
);

/** The thread: names on the first of a run, avatar + tail on the last, system rows centered. */
export const GThread: React.FC<{
  msgs: IMsg[]; me: string; maxW?: number; size?: number;
  typing?: TypingSpan[]; scroll?: ScrollKey[];
}> = ({ msgs, me, maxW = 400, size = 34, typing = [], scroll = [] }) => {
  const frame = useCurrentFrame();
  const view = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const visible = msgs.filter((m) => frame >= m.at);

  useLayoutEffect(() => {
    const v = view.current, c = content.current;
    if (!v || !c) return;
    const vh = v.clientHeight, ch = c.offsetHeight;
    const maxY = Math.max(0, ch - vh);
    const target = (k: ScrollKey) => {
      if (!k.anchor) return Math.min(maxY, Math.max(0, k.y ?? 0));
      const el = c.querySelector<HTMLElement>(`[data-row="${k.anchor}"]`);
      if (!el) return 0;
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      const y = k.align === 'bottom' ? ch - bottom - (k.pad ?? 16) : (k.pad ?? 16) - vh + ch - top;
      return Math.min(maxY, Math.max(0, y));
    };
    const past = scroll.filter((k) => k.at <= frame);
    let y = 0;
    if (past.length) {
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      const t = cur.dur ? E.inOutCubic(clamp01((frame - cur.at) / cur.dur)) : 1;
      y = lerp(t, prev ? target(prev) : 0, target(cur));
    }
    c.style.transform = `translateY(${y.toFixed(2)}px)`;
  });

  return (
    <div ref={view} data-clip="1" style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div ref={content} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 4 }}>
        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const next = visible[i + 1];
          const isMe = m.from === me;
          const samePrev = !!prev && !prev.system && !m.system && prev.from === m.from;
          const sameNext = !!next && !next.system && !m.system && next.from === m.from;
          const showName = !m.system && !isMe && !samePrev;
          const mt = i === 0 ? 0 : m.system || prev?.system ? 16 : samePrev ? 8 : 22;
          const extra = m.tapback && showName ? 22 : 0;
          return (
            <Grow key={m.id} id={m.id} g={seg(frame, m.at, m.at + 8, E.outCubic)} mt={mt + extra}>
              <IBubble m={m} me={isMe} showName={showName} showAvatar={!m.system && !sameNext} maxW={maxW} size={size} />
            </Grow>
          );
        })}
        {typing.filter((t) => frame >= t.at && frame < t.until).map((t) => {
          const exit = seg(frame, t.until - 6, t.until);
          const g = seg(frame, t.at, t.at + 6, E.outCubic) * (1 - E.inCubic(exit));
          // fade out before the row collapses, so a closing row never sits on its neighbour
          const o = Math.min(1, seg(frame, t.at, t.at + 6, E.outCubic) * 1.4) * Math.max(0, 1 - 2.5 * exit);
          return (
            <Grow key={`typing-${t.from}-${t.at}`} g={g} mt={14}>
              <div style={{ opacity: o }}><Typing from={t.from} at={t.at} until={t.until} /></div>
            </Grow>
          );
        })}
      </div>
    </div>
  );
};

/** The light-mode IPhone at the chat zone, with the "‹ N" unread badge. */
export const ChatPhone: React.FC<{
  x?: number; y?: number; width?: number; height?: number;
  title: string; members: string[]; unread?: NumKey[]; overlay?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties;
}> = ({ x = 180, y = 48, width = 560, height = 984, title, members, unread = [], overlay, children, style }) => {
  const frame = useCurrentFrame();
  const count = Math.round(keyed(frame, unread));
  return (
    <IPhone width={width} height={height} title={title} members={members} back={count > 0 ? <IUnread count={count} /> : undefined} overlay={overlay} style={{ left: x, top: y, ...style }}>
      {children}
    </IPhone>
  );
};

// ── iOS notification stack ──
export type StackItem = {
  at: number; title: string; body: string; app?: string;
  /** label above the banner, e.g. "baby kien's phone" */ owner?: string;
  bodySize?: number;
  /** contact name for the icon (default: Tab's) */ icon?: string;
};

/** Newest banner in front; older ones recede into up to `slivers` blank cards
 *  peeking below (data-overlay). Banners drop in from above. */
export const NotifStack: React.FC<{ items: StackItem[]; x: number; y: number; width?: number; slivers?: number; iconSize?: number; ownerSize?: number }> = ({
  items, x, y, width = 880, slivers = 2, iconSize = 84, ownerSize = 34,
}) => {
  const frame = useCurrentFrame();
  const arrived = items.filter((it) => it.at <= frame);
  if (!arrived.length) return null;
  const front = arrived[arrived.length - 1];
  const prev = arrived[arrived.length - 2];
  // snappy: taps can land 4 frames apart, so nothing lingers half-transparent
  const p = seg(frame, front.at, front.at + 8, E.outCubic);
  const pIn = seg(frame, front.at, front.at + 3);
  const older = arrived.length - 1;
  const hasOwner = items.some((it) => it.owner);
  const owner = (frame > front.at ? front : prev ?? front).owner;
  const icon = (it: StackItem) => (it.icon ? <ContactPhoto name={it.icon} size={iconSize} /> : <ContactPhoto name="Tab" size={iconSize} />);
  const banner = (it: StackItem, extra?: React.CSSProperties) => (
    // near-opaque like iOS light banners, so the slivers behind never show through
    <IBanner app={it.app ?? 'Messages'} title={it.title} body={it.body} bodySize={it.bodySize} icon={icon(it)} style={{ width, background: 'rgba(249,249,251,0.97)', ...extra }} />
  );
  return (
    <div style={{ position: 'absolute', left: x, top: y, width }}>
      {hasOwner && (
        <div style={{ position: 'relative', height: Math.round(ownerSize * 1.3), marginBottom: 12 }}>
          {/* hard switch on the tap (taps land 4+ frames apart; a crossfade would ghost) */}
          {owner && (
            <div style={{ position: 'absolute', left: 24, top: 0 }}>
              <div data-box={`owner:${owner}`} style={{ font: `700 ${ownerSize}px ${FONT_B}`, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.55)', whiteSpace: 'nowrap' }}>{owner}</div>
            </div>
          )}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 0 }}>
        {/* blank slivers behind the front card */}
        <div data-overlay="1">
          {Array.from({ length: Math.min(slivers, older) }).map((_, k) => {
            const isNew = k === Math.min(slivers, older) - 1 && older <= slivers;
            const o = isNew ? p : 1;
            return (
              <div key={k} style={{ position: 'absolute', left: 0, right: 0, bottom: -(k + 1) * 18, height: 120, borderRadius: 44, transform: `scale(${1 - (k + 1) * 0.05})`, transformOrigin: '50% 100%', background: `rgba(246,246,248,${0.78 - k * 0.14})`, boxShadow: '0 16px 40px rgba(0,0,0,0.22)', opacity: o, zIndex: -1 - k }} />
            );
          })}
        </div>
        {/* the previous front recedes */}
        {prev && p < 1 && (
          <div data-overlay="1" style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: 1 - seg(frame, front.at, front.at + 2) }}>
            {banner(prev)}
          </div>
        )}
        <div style={{ position: 'relative', opacity: pIn, transform: `translateY(${(1 - p) * -20}px) scale(${lerp(p, 0.985, 1)})`, transformOrigin: "50% 0%" }}>
          {banner(front)}
        </div>
      </div>
    </div>
  );
};

// ── backdrop for chat scenes: the blurred, darkened plate (H02 / H10) ──
export const ChatBackdrop: React.FC<{ still?: string; hue?: number }> = ({ still, hue = 12 }) => {
  const src = still ? firstExisting(still) : undefined;
  if (src) {
    return (
      <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden', background: '#000' }}>
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.12)', filter: 'blur(26px) brightness(0.42) saturate(1.1)' }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill data-bleed="1" style={{ background: `radial-gradient(1400px 900px at 60% 40%, hsl(${hue} 40% 20%) 0%, hsl(${hue} 45% 9%) 70%, #070404 100%)` }}>
      {Array.from({ length: 14 }).map((_, i) => {
        const r = 60 + rand(i * 5.1) * 140;
        return <div key={i} style={{ position: 'absolute', left: rand(i * 2.3) * 1920 - r, top: rand(i * 7.7) * 1080 - r, width: r * 2, height: r * 2, borderRadius: '50%', background: `radial-gradient(circle, hsla(${hue + rand(i) * 30} 90% 62% / ${0.10 + rand(i * 3) * 0.12}), hsla(${hue} 90% 50% / 0))` }} />;
      })}
    </AbsoluteFill>
  );
};

// ── the composed chat scene (phone left, R-top stage, R-bottom captions) ──
export type ChatSceneProps = {
  msgs: IMsg[];
  me: string;
  title: string;
  /** header avatars over time: [{ at, members }] (first entry applies from the start) */
  members: { at: number; members: string[] }[];
  typing?: TypingSpan[];
  scroll?: ScrollKey[];
  unread?: NumKey[];
  size?: number;
  maxW?: number;
  portraits?: { at: number; who: CastId | null }[];
  /** R-top banner stack (e.g. per-payer DMs), shown until `dmsUntil` (frame) */
  dms?: StackItem[];
  dmsUntil?: number;
  /** banners inside the phone (top of the screen) */
  phoneNotifs?: StackItem[];
  side?: { text: string; from: number; to: number }[];
  backdrop?: React.ReactNode;
};

export const ChatScene: React.FC<ChatSceneProps> = ({
  msgs, me, title, members, typing, scroll, unread, size = 34, maxW = 400, portraits = [], dms = [], dmsUntil = Infinity, phoneNotifs = [], side = [], backdrop,
}) => {
  const frame = useCurrentFrame();
  const mem = [...members].reverse().find((m) => m.at <= frame)?.members ?? members[0].members;
  return (
    <Contacts>
      <AbsoluteFill>
        {backdrop ?? <ChatBackdrop />}
        <ChatPhone
          title={title}
          members={mem}
          unread={unread}
          overlay={phoneNotifs.length ? <div data-overlay="1"><NotifStack items={phoneNotifs} x={12} y={64} width={504} iconSize={64} slivers={2} /></div> : undefined}
        >
          <GThread msgs={msgs} me={me} typing={typing} scroll={scroll} size={size} maxW={maxW} />
        </ChatPhone>
        <PortraitStage beats={portraits} />
        {dms.length > 0 && frame < dmsUntil && <NotifStack items={dms} x={890} y={70} width={880} />}
        {side.map((s) => <SideCaption key={s.text + s.from} text={s.text} from={s.from} to={s.to} />)}
      </AbsoluteFill>
    </Contacts>
  );
};
