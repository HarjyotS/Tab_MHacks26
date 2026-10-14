import React, { useId } from 'react';
import { AbsoluteFill, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { Caption, DigitRoll, Field, TabMark } from './components';
import { C, E, FONT_B, FONT_T, glass, lerp, rand, seg } from './theme';
import { beats } from './timeline';
import { Ripple } from './scenes4';

// ── S1 cold open: the real clip, natural audio, glass subtitles on the words ──
const SUBS: [string, number, number][] = [
  ['how much for tacos, by the way?', 2.86, 4.7],
  ["i'll just text you later.", 4.84, 6.18],
];
export const Cold: React.FC = () => {
  const frame = useCurrentFrame();
  const chip = seg(frame, 12, 28, E.soft);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <OffthreadVideo src={staticFile('footage/tacos.mp4')} volume={0.85} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.04) saturate(1.08)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.35))' }} />
      <div data-box="chip:mhacks" style={{ position: 'absolute', left: 56, top: 48, opacity: chip, transform: `translateY(${(1 - chip) * -12}px)`, ...glass({ tint: 'rgba(10,20,15,0.3)', radius: 999, blur: 22 }), padding: '10px 26px', font: `700 32px ${FONT_B}`, color: C.white }}>
        mhacks 2026
      </div>
      {SUBS.map(([t, a, b]) => (
        <Caption key={t} text={t} start={Math.round(a * 30) - 2} end={Math.round(b * 30)} bottom={64} size={58} fade={4} />
      ))}
    </AbsoluteFill>
  );
};

// ── S2 freeze-annotate: freeze on "bet", mark the tacos, the punchline ──
export const Freeze: React.FC = () => {
  const frame = useCurrentFrame();
  const roughId = `rough-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const sat = lerp(seg(frame, 0, 10, E.outCubic), 1, 0.3);
  const push = lerp(seg(frame, 0, 75, E.inOutSine), 1, 1.05);
  const flash = interpolate(frame, [0, 1, 4], [0.35, 0.35, 0], { extrapolateRight: 'clamp' });
  const draw = seg(frame, 6, 15, E.outCubic);
  const arrow = seg(frame, 15, 21, E.outCubic);
  const label = seg(frame, 17, 24, E.land);
  const card = seg(frame, 22, 36, E.land);
  const ELL = 1500;
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: '52% 70%' }}>
        <Img src={staticFile('img/freeze-bet.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: `saturate(${sat}) contrast(1.05)` }} />
        <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <filter id={roughId}>
              <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="7" />
            </filter>
          </defs>
          <ellipse cx={985} cy={958} rx={250} ry={78} fill="none" stroke={C.orange} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={ELL} strokeDashoffset={ELL * (1 - draw)} transform="rotate(-4 985 958)" filter={`url(#${roughId})`} />
          <path d="M 975 790 Q 1010 840 990 885" fill="none" stroke={C.orange} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={260} strokeDashoffset={260 * (1 - arrow)} filter={`url(#${roughId})`} />
        </svg>
        <div style={{ position: 'absolute', left: 880, top: 690, transform: `scale(${label}) rotate(-6deg)`, transformOrigin: 'left bottom', font: `800 64px ${FONT_T}`, color: C.orange, textShadow: '0 4px 18px rgba(0,0,0,0.35)' }}>
          $ ???
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
      <Caption text="all right, bet." start={-12} end={34} bottom={64} size={58} fade={4} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 120, display: 'flex', justifyContent: 'center' }}>
        <div data-box="card:never" style={{ ...glass({ tint: 'rgba(12,30,22,0.45)', radius: 36, blur: 30 }), padding: '26px 56px 30px', font: `800 88px/1 ${FONT_T}`, letterSpacing: '-0.045em', color: C.white, opacity: card, transform: `translateY(${(1 - card) * -40}px) scale(${lerp(card, 0.94, 1)})` }}>
          he never texted.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── S3 the mess grows: one bar per group size, debts multiply (n·(n−1)/2) ──
const SIZES = [2, 4, 8, 12];
const NAMES = ['A', 'S', 'P', 'J', 'K', 'M', 'D', 'L', 'R', 'N', 'E', 'B'];
const HUES = ['#7cc6fe', '#ffb36b', '#c79bff', '#86e3b4', '#ff8fa3', '#ffd36b', '#8fd3ff', '#b4f08f', '#f7a8ff', '#9fe7da', '#ffc49b', '#a7b8ff'];
export const nodePos = (i: number, n: number, cx = 960, cy = 555, r = 255) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0);
  return { x: cx + Math.cos(a) * r * (n === 2 ? 0.7 : 1), y: cy + Math.sin(a) * r * (n === 2 ? 0.7 : 1) };
};

export const Mess: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  const frame = useCurrentFrame();
  const BARF = beats(4); // ≈58f
  const bar = Math.min(3, Math.floor(frame / BARF));
  const inBar = frame - bar * BARF;
  const converge = seg(frame, dur - 14, dur, E.inQuart);
  // Node positions ease from the previous layout to the current one.
  const posAt = (i: number) => {
    const n = SIZES[bar];
    const prevN = bar > 0 ? SIZES[bar - 1] : n;
    const p = seg(inBar, 0, 18, E.outCubic);
    const target = nodePos(i, n);
    const from = i < prevN ? nodePos(i, prevN) : target;
    const x = lerp(p, from.x, target.x);
    const y = lerp(p, from.y, target.y);
    return { x: lerp(converge, x, 960), y: lerp(converge, y, 540) };
  };
  const n = SIZES[bar];
  const debts = (n * (n - 1)) / 2;
  const chaos = seg(frame, 3 * BARF + 24, dur - 14, E.inQuad);
  return (
    <AbsoluteFill>
      <Field />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: n }).flatMap((_, i) =>
          Array.from({ length: n }).map((__, j) => {
            if (j <= i) return null;
            const a = posAt(i);
            const b = posAt(j);
            const isNew = j >= (bar > 0 ? SIZES[bar - 1] : 0);
            const draw = isNew ? seg(inBar, 20 + rand(i * 31 + j) * 14, 34 + rand(i * 31 + j) * 14, E.outCubic) : 1;
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const wob = chaos * 14 * Math.sin(frame * 0.7 + i * 3 + j);
            return (
              <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x + wob} y2={b.y - wob}
                stroke={chaos > 0.2 && (i + j) % 3 === 0 ? '#ff7a5c' : 'rgba(255,170,140,0.55)'} strokeWidth={2.4}
                strokeDasharray={len} strokeDashoffset={len * (1 - draw)} opacity={(1 - converge) * (0.5 + 0.5 * chaos)} />
            );
          }),
        )}
      </svg>
      {Array.from({ length: n }).map((_, i) => {
        const pos = posAt(i);
        const isNew = i >= (bar > 0 ? SIZES[bar - 1] : 0);
        const pop = isNew ? seg(inBar, 16, 28, E.land) : 1; // new friends wait for the others to make room
        const size = 96 * (1 - converge * 0.8);
        return (
          <div key={i} data-box={`friend:${i}`} style={{
            position: 'absolute', left: pos.x - size / 2, top: pos.y - size / 2, width: size, height: size, borderRadius: '50%',
            ...glass({ tint: 'rgba(255,255,255,0.16)', radius: 999, blur: 18 }),
            display: 'grid', placeItems: 'center', transform: `scale(${pop})`, opacity: 1 - converge,
            font: `800 ${size * 0.4}px ${FONT_T}`, color: HUES[i],
          }}>
            {NAMES[i]}
          </div>
        );
      })}
      <div data-box="counter:mess" style={{ position: 'absolute', left: 760, right: 760, top: 34, textAlign: 'center', opacity: 1 - converge }}>
        <div style={{ font: `700 36px ${FONT_B}`, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.02em' }}>who owes who</div>
        <div style={{ marginTop: 4 }}>
          <DigitRoll key={bar} value={String(debts)} from={bar > 0 ? String((SIZES[bar - 1] * (SIZES[bar - 1] - 1)) / 2) : undefined} delay={bar * BARF + 16} size={120} color={bar === 3 ? C.orange : C.white} />
        </div>
      </div>
      <Caption text={v >= 2 ? 'asking friends for money? awkward.' : 'two friends? easy.'} start={6} end={v >= 2 ? 2 * BARF - 2 : BARF + 6} />
      <Caption text="a weekend trip? 66 debts." start={2 * BARF + 4} end={dur - 8} />
    </AbsoluteFill>
  );
};

// ── S4 brand: glass pill pops (1.25→1), orange glow types "tab", becomes the mark ──
export const Brand: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  const frame = useCurrentFrame();
  const s = lerp(seg(frame, 0, 7, E.outCubic), 1.25, 1);
  const pillO = seg(frame, 0, 2) * (1 - seg(frame, 38, 46));
  const typed = 'tab'.slice(0, Math.floor(seg(frame, 4, 18) * 3 + 1e-6));
  const glow = 1 - seg(frame, 6, 30, E.inOutQuad);
  const lock = seg(frame, 38, 56, E.land);
  const sub = seg(frame, 58, 74, E.soft);
  const sheen = seg(frame, 66, 84, E.inOutCubic);
  const letters = 'Tab'.split('');
  return (
    <AbsoluteFill>
      {/* pill */}
      <div style={{
        position: 'absolute', left: 960 - 330, top: 540 - 58, width: 660, height: 116, borderRadius: 58,
        ...glass({ tint: 'rgba(14,30,22,0.55)', radius: 58, blur: 30 }),
        opacity: pillO, transform: `scale(${s * lerp(seg(frame, 34, 46, E.inCubic), 1, 0.4)})`,
        boxShadow: `inset 0 0 0 1.5px rgba(255,255,255,${0.2 + 0.15 * glow}), 0 0 ${60 * glow}px rgba(238,93,63,${0.45 * glow})`,
        display: 'flex', alignItems: 'center', padding: '0 40px', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: glow, background: 'linear-gradient(90deg, rgba(238,93,63,0) 0%, rgba(238,93,63,0.35) 42%, rgba(255,122,92,0.95) 100%)' }} />
        <span style={{ position: 'relative', font: `800 64px ${FONT_T}`, color: C.white, letterSpacing: '-0.03em' }}>{typed}</span>
        <span style={{ position: 'relative', width: 4, height: 60, marginLeft: 6, background: C.white, opacity: seg(frame, 2, 4) * (1 - seg(frame, 26, 30)) }} />
      </div>
      {/* lockup */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 360, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 44, opacity: lock > 0 ? 1 : 0 }}>
        <div style={{ position: 'relative' }}>
        {v === 3 && <Ripple at={beats(6)} size={180} reach={2.6} radius={54} />}
        <div style={{ position: 'relative', transform: `scale(${lock})`, borderRadius: 54, overflow: 'hidden' }}>
          <TabMark size={180} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, rgba(255,255,255,0) ${lerp(sheen, -40, 110)}%, rgba(255,255,255,0.55) ${lerp(sheen, -20, 130)}%, rgba(255,255,255,0) ${lerp(sheen, 0, 150)}%)` }} />
        </div>
        </div>
        <div style={{ font: `800 230px/1 ${FONT_T}`, letterSpacing: '-0.06em', color: C.white, display: 'flex' }}>
          {letters.map((ch, i) => {
            const p = seg(frame, 44 + i * 2, 58 + i * 2, E.land);
            return <span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${lerp(p, 1.2, 1)})` }}>{ch}</span>;
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, textAlign: 'center', opacity: sub, transform: `translateY(${(1 - sub) * 20}px)`, font: `600 48px ${FONT_B}`, color: 'rgba(255,255,255,0.92)' }}>
        {v === 3 ? (
          // gen 1 final: the growth hook, said and shown as the brand lands
          <>a third party in your chat that <span style={{ color: C.orangeSoft, fontWeight: 800 }}>grows</span> with your group.</>
        ) : v === 2 ? 'a third party in your group chat that does the asking.' : 'the friend in your group chat who keeps the tab.'}
      </div>
    </AbsoluteFill>
  );
};
