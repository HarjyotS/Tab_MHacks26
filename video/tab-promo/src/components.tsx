import React from 'react';
import { AbsoluteFill, Easing, interpolate, Loop, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { C, E, FONT_B, FONT_T, glass, lerp, seg } from './theme';

/** The blurred, slowed footage everything floats over, tinted deep green. */
export const Backdrop: React.FC<{ dim?: number }> = ({ dim = 0.42 }) => (
  <AbsoluteFill style={{ background: C.greenDeep }}>
    <Loop durationInFrames={1003}>
      <OffthreadVideo
        src={staticFile('footage/backdrop.mp4')}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.15)' }}
      />
    </Loop>
    <AbsoluteFill style={{ background: `linear-gradient(160deg, rgba(11,26,19,${dim}) 0%, rgba(11,26,19,${dim + 0.22}) 100%)` }} />
    <Glows />
  </AbsoluteFill>
);

/** Deep-green stage with two soft brand glows (for abstract shots). */
export const Field: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <AbsoluteFill style={{ opacity, background: 'radial-gradient(1300px 900px at 50% 45%, #163a2b 0%, #0d2219 55%, #07140e 100%)' }}>
    <Glows />
  </AbsoluteFill>
);

const Glows: React.FC = () => {
  const frame = useCurrentFrame();
  const dx = Math.sin(frame / 90) * 40;
  const dy = Math.cos(frame / 110) * 30;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 120 + dx, top: 40 + dy, width: 900, height: 700, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(238,93,63,0.34), rgba(238,93,63,0))', filter: 'blur(20px)' }} />
      <div style={{ position: 'absolute', right: 80 - dx, bottom: -60 - dy, width: 1000, height: 760, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(134,227,180,0.22), rgba(134,227,180,0))', filter: 'blur(24px)' }} />
    </AbsoluteFill>
  );
};

/** Narrative caption on a glass pill. Lowercase, Manrope 800, ≥56px (Q11). */
export const Caption: React.FC<{ text: string; start?: number; end?: number; bottom?: number; size?: number; fade?: number }> = ({
  text, start = 0, end = 99999, bottom = 72, size = 62, fade = 14,
}) => {
  const frame = useCurrentFrame();
  const inP = seg(frame, start, start + fade, E.soft);
  const outP = seg(frame, end - Math.min(8, fade), end, E.inQuad);
  const o = inP * (1 - outP);
  if (o <= 0.001) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        data-box={`caption:${text}`}
        style={{
          ...glass({ tint: 'rgba(12,30,22,0.42)', radius: 999, blur: 30, edge: 0.28 }),
          padding: '18px 44px 22px',
          font: `800 ${size}px/1.1 ${FONT_T}`,
          letterSpacing: '-0.035em',
          color: C.white,
          opacity: o,
          transform: `translateY(${24 * (1 - inP)}px)`,
          filter: `blur(${8 * (1 - inP)}px)`,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Headline words enter one by one: y 40→0, blur 10→0, opacity (blur-slide card). */
export const Headline: React.FC<{
  text: string; start?: number; size?: number; color?: string; accent?: string[]; stagger?: number; align?: 'left' | 'center';
  style?: React.CSSProperties;
}> = ({ text, start = 0, size = 120, color = C.white, accent = [], stagger = 4, align = 'left', style }) => {
  const frame = useCurrentFrame();
  const words = text.split(' ');
  return (
    <div style={{ font: `800 ${size}px/1.02 ${FONT_T}`, letterSpacing: '-0.045em', color, textAlign: align, ...style }}>
      {words.map((w, i) => {
        const p = seg(frame, start + i * stagger, start + i * stagger + 16, E.outCubic);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: '0.24em',
              opacity: p,
              transform: `translateY(${40 * (1 - p)}px)`,
              filter: `blur(${10 * (1 - p)}px)`,
              color: accent.includes(w) ? C.orange : undefined,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

export const PEOPLE: Record<string, { color: string }> = {
  Alex: { color: '#7cc6fe' },
  Sam: { color: '#ffb36b' },
  Priya: { color: '#c79bff' },
  Jordan: { color: '#86e3b4' },
};

export const Avatar: React.FC<{ name: string; size?: number; style?: React.CSSProperties; color?: string }> = ({ name, size = 64, style, color }) => (
  <div
    style={{
      width: size, height: size, borderRadius: size / 2, flex: 'none',
      background: `linear-gradient(160deg, ${color ?? PEOPLE[name]?.color ?? '#9fb8ad'}, rgba(255,255,255,0.15))`,
      border: '2px solid rgba(255,255,255,0.55)',
      display: 'grid', placeItems: 'center',
      font: `800 ${size * 0.42}px ${FONT_T}`, color: C.ink, boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
      ...style,
    }}
  >
    {name[0]}
  </div>
);

/** Tab's mark: the orange rounded square from the ledger header. */
export const TabMark: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 120, style }) => (
  <div
    style={{
      width: size, height: size, borderRadius: size * 0.3, flex: 'none',
      background: `linear-gradient(160deg, #ff7a5c, ${C.orange})`,
      display: 'grid', placeItems: 'center',
      font: `800 ${size * 0.56}px ${FONT_T}`, color: C.white,
      boxShadow: `0 ${size * 0.15}px ${size * 0.4}px rgba(238,93,63,0.45), inset 0 2px 0 rgba(255,255,255,0.4)`,
      ...style,
    }}
  >
    T
  </div>
);

/** Odometer digits (skill DigitRoll), any characters pass through. */
export const DigitRoll: React.FC<{ value: string; from?: string; delay?: number; size?: number; color?: string; weight?: number; font?: string }> = ({
  value, from, delay = 0, size = 30, color = C.white, weight = 800, font = FONT_T,
}) => {
  const frame = useCurrentFrame();
  const lineH = size * 1.15;
  const DIGITS = '0123456789';
  return (
    <span style={{ display: 'inline-flex', overflow: 'hidden', height: lineH, verticalAlign: 'bottom', font: `${weight} ${size}px ${font}`, color }}>
      {value.split('').map((ch, i) => {
        const target = DIGITS.indexOf(ch);
        if (target < 0) return <span key={i} style={{ lineHeight: `${lineH}px` }}>{ch}</span>;
        const t = interpolate(frame, [delay + i * 4, delay + i * 4 + 22], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.25, 0.8, 0.25, 1),
        });
        // From a previous value: roll forward from its digit (right-aligned), never from zero.
        const fp = from ? from.padStart(value.length, ' ') : undefined;
        const start = fp ? Math.max(0, DIGITS.indexOf(fp[i])) : 0;
        const steps = fp ? ((target - start + 10) % 10) + 10 : 10 + target;
        const offset = (start + steps * t) * lineH;
        return (
          <span key={i} style={{ display: 'inline-block', height: lineH }}>
            <span style={{ display: 'block', transform: `translateY(${-offset}px)` }}>
              {(DIGITS + DIGITS + DIGITS).split('').map((d, j) => (
                <span key={j} style={{ display: 'block', lineHeight: `${lineH}px`, fontVariantNumeric: 'tabular-nums' }}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** A value that rolls from one money string to another at `at`. */
export const MoneySwap: React.FC<{ from: string; to: string; at: number; size: number; color?: string }> = ({ from, to, at, size, color }) => {
  const frame = useCurrentFrame();
  if (frame < at) return <span style={{ font: `800 ${size}px ${FONT_T}`, color, fontVariantNumeric: 'tabular-nums' }}>{from}</span>;
  return <DigitRoll value={to} delay={at} size={size} color={color} />;
};

export type Msg = {
  id: string;
  who: string; // member name or 'Tab'
  text?: string;
  img?: string;
  at: number; // frame it lands
  h: number; // reserved height in px
  tapback?: { emoji: string; at: number };
};

/** One chat message: incoming glass bubble with name, or Tab's orange bubble. */
export const Bubble: React.FC<{ m: Msg; width?: number; size?: number }> = ({ m, width = 380, size = 31 }) => {
  const frame = useCurrentFrame();
  const p = seg(frame, m.at, m.at + 12, E.land);
  const isTab = m.who === 'Tab';
  const tb = m.tapback ? seg(frame, m.tapback.at, m.tapback.at + 10, E.land) : 0;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 30}px) scale(${lerp(p, 0.92, 1)})`, transformOrigin: 'left bottom' }}>
      {isTab ? <TabMark size={50} /> : <Avatar name={m.who} size={50} />}
      <div style={{ position: 'relative', maxWidth: width }}>
        <div style={{ font: `600 22px ${FONT_B}`, color: 'rgba(255,255,255,0.7)', margin: '0 0 6px 16px' }}>{isTab ? 'Tab' : m.who}</div>
        {m.img ? (
          <img src={staticFile(m.img)} style={{ width: 210, borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.4)', display: 'block', boxShadow: '0 12px 30px rgba(0,0,0,0.3)' }} />
        ) : (
          <div
            style={{
              ...(isTab
                ? { background: 'linear-gradient(160deg, rgba(255,122,92,0.95), rgba(238,93,63,0.92))', border: '1.5px solid rgba(255,255,255,0.35)', borderRadius: 30, boxShadow: '0 16px 40px rgba(238,93,63,0.35), inset 0 1.5px 0 rgba(255,255,255,0.45)' }
                : glass({ tint: 'rgba(255,255,255,0.18)', radius: 30, blur: 24 })),
              padding: '16px 24px 18px',
              font: `500 ${size}px/1.3 ${FONT_B}`,
              color: C.white,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.text}
          </div>
        )}
        {m.tapback && tb > 0 && (
          <div
            style={{
              position: 'absolute', right: -18, top: 14,
              ...glass({ tint: 'rgba(255,255,255,0.85)', radius: 999, blur: 10, edge: 0.6 }),
              width: 56, height: 56, display: 'grid', placeItems: 'center', fontSize: 30,
              transform: `scale(${tb})`,
            }}
          >
            {m.tapback.emoji}
          </div>
        )}
      </div>
    </div>
  );
};

/** A glass phone showing a group thread; messages stack from the bottom. */
export const Phone: React.FC<{ msgs: Msg[]; title?: string; width?: number; height?: number; style?: React.CSSProperties }> = ({
  msgs, title = 'taco crew 🌮', width = 520, height = 960, style,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', width, height, ...glass({ tint: 'rgba(14,34,25,0.45)', radius: 70, blur: 34, edge: 0.4 }), overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', top: 18, left: '50%', marginLeft: -62, width: 124, height: 34, borderRadius: 20, background: 'rgba(0,0,0,0.75)' }} />
      <div style={{ position: 'absolute', top: 70, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex' }}>
          {['Alex', 'Sam', 'Priya', 'Jordan'].map((n, i) => (
            <Avatar key={n} name={n} size={46} style={{ marginLeft: i ? -12 : 0 }} />
          ))}
          <TabMark size={46} style={{ marginLeft: -12, borderRadius: 23 }} />
        </div>
        <div style={{ font: `700 26px ${FONT_B}`, color: C.white }}>{title}</div>
      </div>
      <div style={{ position: 'absolute', left: 26, right: 26, bottom: 36, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {msgs.map((m) => {
          const reveal = seg(frame, m.at - 2, m.at + 10, E.outCubic);
          if (reveal <= 0) return null;
          return (
            <div key={m.id} style={{ maxHeight: m.h * reveal, overflow: 'visible' }}>
              <Bubble m={m} width={width - 140} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Small glass chip with label + value. */
export const Chip: React.FC<{ label: React.ReactNode; value?: React.ReactNode; style?: React.CSSProperties; size?: number }> = ({ label, value, style, size = 34 }) => (
  <div
    data-box={`chip:${typeof label === 'string' ? label : 'x'}`}
    style={{
      ...glass({ tint: 'rgba(255,255,255,0.16)', radius: 24, blur: 26 }),
      display: 'flex', alignItems: 'center', gap: 24, padding: '16px 26px',
      font: `600 ${size}px ${FONT_B}`, color: C.white, whiteSpace: 'nowrap',
      ...style,
    }}
  >
    <span style={{ flex: 1 }}>{label}</span>
    {value !== undefined && <span style={{ font: `800 ${size}px ${FONT_T}`, fontVariantNumeric: 'tabular-nums' }}>{value}</span>}
  </div>
);
