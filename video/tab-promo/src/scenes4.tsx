import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { Caption, Chip, DigitRoll, Field, TabMark } from './components';
import { IBanner } from './imessage';
import { C, E, FONT_B, FONT_T, glass, lerp, rand, seg } from './theme';
import { BEAT, beats, FPS } from './timeline';

/** The growth motif (gen 1 final): a mint ring that grows off a shape and fades. The caller beat-syncs `at`. */
export const Ripple: React.FC<{ at: number; size: number; reach?: number; radius?: number; dur?: number; color?: string }> = ({
  at, size, reach = 2.4, radius, dur = 26, color = C.mintBright,
}) => {
  const frame = useCurrentFrame();
  const t = seg(frame, at, at + dur, E.outCubic);
  if (frame < at || t >= 1) return null;
  return (
    <div data-overlay="1" style={{
      position: 'absolute', left: '50%', top: '50%', width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
      borderRadius: radius ?? size / 2, border: `${lerp(t, 5, 1.6)}px solid ${color}`, opacity: 0.8 * (1 - t),
      transform: `scale(${lerp(t, 1, reach)})`, boxShadow: `0 0 ${20 * (1 - t)}px ${color}`, pointerEvents: 'none',
    }} />
  );
};

/** Pulsing "live" dot, one pulse per beat. */
export const LiveDot: React.FC<{ size?: number }> = ({ size = 16 }) => {
  const frame = useCurrentFrame();
  const ph = (frame % (BEAT * FPS)) / (BEAT * FPS);
  const o = 0.45 + 0.55 * Math.pow(1 - ph, 2);
  return <span style={{ display: 'inline-block', flex: 'none', width: size, height: size, borderRadius: 99, background: C.mintBright, opacity: o, boxShadow: `0 0 ${8 + 10 * (1 - ph)}px ${C.mintBright}` }} />;
};

// ── S13 Tab grows: 66 tangled debts net down to 11 payments, then the group grows to 40 ──
const CX = 960;
const CY = 500;
const inner = (i: number, r = 210) => ({ x: CX + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 12) * r, y: CY + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 12) * r });
const outer = (k: number) => ({ x: CX + Math.cos(-Math.PI / 2 + ((k + 0.5) * 2 * Math.PI) / 28) * 360, y: CY + Math.sin(-Math.PI / 2 + ((k + 0.5) * 2 * Math.PI) / 28) * 360 });
// v3 (the film's visual peak): the group grows ON the beat. Beats 8–13 each add a spread-out
// batch of friends (the counter is always 12 + the dots you can see), rings ripple off tab on
// every beat into drop 2, and the mark itself grows under "tab grows with them".
const BATCH_END = [5, 10, 15, 20, 24, 28]; // cumulative outer friends after growth beats 8..13
const batchOf = (k: number) => k % 6; // batch b = every 6th seat, so each beat densifies the whole ring
const seatInBatch = (k: number) => Math.floor(k / 6);
export const Grows: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  const frame = useCurrentFrame();
  const peak = v === 3;
  const tangle = 1 - seg(frame, 40, 70, E.inOutCubic);
  const netted = seg(frame, 56, 96, E.outCubic);
  const grow = seg(frame, 112, 200, E.inOutCubic);
  const GB = (i: number) => beats(8 + i); // growth beats: 116, 131, 145, 160, 174, 189
  const popAt = (k: number) => (peak ? GB(batchOf(k)) + seatInBatch(k) : 112 + (k / 28) * 88);
  const shown = (k: number) => (peak ? frame >= popAt(k) : k < Math.floor(grow * 28 + 1e-6));
  const steps = peak ? [0, 1, 2, 3, 4, 5].filter((i) => frame >= GB(i)).length : 0;
  const friends = 12 + (steps ? BATCH_END[steps - 1] : 0);
  const lastStep = steps ? GB(steps - 1) : -99;
  const bump = frame - lastStep < 3 ? lerp(seg(frame, lastStep, lastStep + 3, E.outCubic), 1, 1.22) : Math.max(1, lerp(E.outBack(seg(frame, lastStep + 3, lastStep + 13), 2), 1.22, 1));
  // the mark: beat pulse from the first growth beat, and it grows on beats 11–13 ("tab grows with them")
  const beatF = BEAT * FPS;
  const pulse = peak && frame >= GB(0) ? 1 + 0.05 * Math.pow(1 - ((frame - GB(0)) % beatF) / beatF, 3) : 1;
  const markGrow = peak ? 1 + 0.09 * (seg(frame, GB(3), GB(3) + 8, E.land) + seg(frame, GB(4), GB(4) + 8, E.land) + seg(frame, GB(5), GB(5) + 8, E.land)) : 1;
  const RINGS = peak ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => beats(8 + i)) : [];
  const debtsLabel = frame < 60 ? 'debts' : 'awkward texts';
  return (
    <AbsoluteFill>
      <Field opacity={0.92} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={C.mintBright} />
          </marker>
        </defs>
        {RINGS.map((at) => {
          const t = seg(frame, at, at + 30, E.outCubic);
          if (frame < at || t >= 1) return null;
          return <circle key={`r${at}`} cx={CX} cy={CY} r={lerp(t, 70 * markGrow, 620)} fill="none" stroke={C.mintBright} strokeWidth={lerp(t, 8, 2)} opacity={0.75 * Math.pow(1 - t, 1.3)} />;
        })}
        {tangle > 0.01 && Array.from({ length: 12 }).flatMap((_, i) =>
          Array.from({ length: 12 }).map((__, j) => {
            if (j <= i) return null;
            const a = inner(i);
            const b = inner(j);
            return <line key={`t${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,140,110,0.6)" strokeWidth={2.2} opacity={tangle} />;
          }),
        )}
        {Array.from({ length: 11 }).map((_, i) => {
          const a = inner(i + 1, 230);
          const hub = { x: CX, y: CY };
          // Each friend owes the group once: one clean arrow into the netted center.
          const len = Math.hypot(hub.x - a.x, hub.y - a.y);
          const d = seg(frame, 56 + i * 3, 80 + i * 3, E.outCubic);
          return <line key={`n${i}`} x1={a.x} y1={a.y} x2={lerp(0.78, a.x, hub.x)} y2={lerp(0.78, a.y, hub.y)} stroke={C.mintBright} strokeWidth={4} strokeDasharray={len} strokeDashoffset={len * (1 - d)} markerEnd="url(#arr)" opacity={netted} />;
        })}
        {Array.from({ length: 28 }).map((_, k) => {
          if (!shown(k)) return null;
          const o = outer(k);
          const near = inner(Math.round((k / 28) * 12) % 12, 230);
          const len = Math.hypot(near.x - o.x, near.y - o.y) * 0.7;
          const d = peak ? seg(frame, popAt(k) + 2, popAt(k) + 12, E.outCubic) : 1;
          return <line key={`o${k}`} x1={o.x} y1={o.y} x2={lerp(0.7, o.x, near.x)} y2={lerp(0.7, o.y, near.y)} stroke="rgba(134,227,180,0.6)" strokeWidth={2.5} strokeDasharray={len + 20} strokeDashoffset={(len + 20) * (1 - d)} markerEnd="url(#arr)" />;
        })}
      </svg>
      {Array.from({ length: 12 }).map((_, i) => {
        const p = inner(i);
        return (
          <div key={i} style={{ position: 'absolute', left: p.x - 36, top: p.y - 36, width: 72, height: 72, borderRadius: 99, ...glass({ tint: 'rgba(255,255,255,0.16)', radius: 99, blur: 16 }), display: 'grid', placeItems: 'center', font: `800 32px ${FONT_T}`, color: C.white }}>
            {'ASPJKMDLRNEB'[i]}
          </div>
        );
      })}
      {Array.from({ length: 28 }).map((_, k) => {
        if (!shown(k)) return null;
        const p = outer(k);
        const pop = seg(frame, popAt(k), popAt(k) + 10, E.land);
        const hue = peak ? ['#7cc6fe', '#ffb36b', '#c79bff', '#86e3b4', '#ff8fa3', '#ffd36b'][k % 6] : null;
        return <div key={k} data-box={`outer:${k}`} style={{ position: 'absolute', left: p.x - 24, top: p.y - 24, width: 48, height: 48, borderRadius: 99, ...glass({ tint: hue ? `${hue}55` : 'rgba(255,255,255,0.14)', radius: 99, blur: 14 }), transform: `scale(${pop})` }} />;
      })}
      <div style={{ position: 'absolute', left: CX - 70, top: CY - 70, width: 140, height: 140, display: 'grid', placeItems: 'center', opacity: netted, transform: `scale(${lerp(netted, 0.6, 1) * pulse * markGrow})` }}>
        <TabMark size={120} />
      </div>
      <div data-box="counter:debts" style={{ position: 'absolute', left: 90, top: 140, ...glass({ tint: 'rgba(12,30,22,0.45)', radius: 30, blur: 26 }), padding: '20px 34px', width: 330 }}>
        <div style={{ font: `700 30px ${FONT_B}`, color: 'rgba(255,255,255,0.75)' }}>{debtsLabel}</div>
        {frame < 60 ? <span style={{ font: `800 100px ${FONT_T}`, color: C.orangeSoft }}>66</span> : <DigitRoll value=" 0" from="66" delay={60} size={100} color={C.mintBright} />}
      </div>
      <div data-box="counter:friends" style={{ position: 'absolute', right: 90, top: 140, ...glass({ tint: 'rgba(12,30,22,0.45)', radius: 30, blur: 26 }), padding: '20px 34px', width: 330 }}>
        <div style={{ font: `700 30px ${FONT_B}`, color: 'rgba(255,255,255,0.75)' }}>friends</div>
        {peak ? (
          <span style={{ display: 'inline-block', font: `800 100px ${FONT_T}`, color: steps === 6 ? C.mintBright : C.white, fontVariantNumeric: 'tabular-nums', transform: `scale(${bump})`, transformOrigin: 'left center' }}>{friends}</span>
        ) : frame < 112 ? <span style={{ font: `800 100px ${FONT_T}`, color: C.white }}>12</span> : <DigitRoll value="40" from="12" delay={114} size={100} color={C.white} />}
      </div>
      <Caption text={peak ? 'as friendships grow, tab grows with them.' : 'the bigger the group, the more tab does.'} start={8} end={dur - 2} />
    </AbsoluteFill>
  );
};

// ── S14 outro: every feature's element flies in around the wordmark (group photo) ──
const FLY = Easing.bezier(0.34, 1.4, 0.44, 1);
const CRANE = Easing.bezier(0.3, 0, 0.2, 1);
type El = { key: string; cx: number; cy: number; rot: number; dx: number; dy: number; node: React.ReactNode };
const ELS_BASE: El[] = [
  { key: 'bubble', cx: 400, cy: 230, rot: -4, dx: -520, dy: -80, node: <div style={{ background: '#e9e9eb', borderRadius: 34, padding: '14px 26px 16px', font: `400 34px/1.28 -apple-system, 'SF Pro Text', sans-serif`, color: '#000', width: 440, boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}>pizza $48.00 split 4 ways, so $12.00 each</div> },
  { key: 'receipt', cx: 1560, cy: 300, rot: 5, dx: 520, dy: -40, node: <Img src={staticFile('img/bistro-receipt.png')} style={{ width: 190, borderRadius: 16, border: '1.5px solid rgba(255,255,255,0.6)', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }} /> },
  { key: 'thumbs', cx: 1730, cy: 780, rot: -8, dx: 420, dy: 260, node: <div style={{ width: 110, height: 110, borderRadius: 99, ...glass({ tint: 'rgba(255,255,255,0.9)', radius: 99, blur: 10 }), display: 'grid', placeItems: 'center', fontSize: 64 }}>👍</div> },
  { key: 'alex', cx: 240, cy: 900, rot: 3, dx: -460, dy: 280, node: <Chip label="Alex" value="$27.15" size={36} style={{ width: 330 }} /> },
  { key: 'food', cx: 1010, cy: 930, rot: -2, dx: 0, dy: 340, node: <Chip label="y'all spent" value="$158.07" size={36} /> },
  { key: 'ledger', cx: 600, cy: 925, rot: 2, dx: -300, dy: 320, node: <div style={{ width: 280, height: 210, borderRadius: 18, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.6)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', background: '#fbfcfb' }}><Img src={staticFile('img/ledger@2x.png')} style={{ width: 833, marginLeft: -153, marginTop: -280 }} /></div> },
  { key: 'net', cx: 980, cy: 150, rot: 1.5, dx: 0, dy: -300, node: <Chip label="66 debts →" value="0 awkward texts" size={34} /> },
  { key: 'pill', cx: 1475, cy: 930, rot: -3, dx: 380, dy: 300, node: <div style={{ ...glass({ tint: 'rgba(14,30,22,0.55)', radius: 999, blur: 20 }), padding: '14px 40px', font: `800 40px ${FONT_T}`, color: '#fff', whiteSpace: 'nowrap' }}>only money talk 🛡️</div> },
];
// v3: no screenshots anywhere, the ledger flies in as a text chip.
const LEDGER_CHIP: El = { key: 'ledger', cx: 600, cy: 925, rot: 2, dx: -300, dy: 320, node: <Chip label={<span style={{ display: 'flex', alignItems: 'center', gap: 14 }}><LiveDot />live ledger</span>} size={34} /> };
const elsFor = (v: number) => (v === 3 ? ELS_BASE.map((el) => (el.key === 'ledger' ? LEDGER_CHIP : el)) : ELS_BASE);
const DUST = Array.from({ length: 20 }, (_, i) => ({ x: (i * 439 + 137) % 1920, y0: (i * 613 + 271) % 1080, rise: 0.3 + (i % 5) * 0.11, amp: 9 + (i % 4) * 5, freq: 0.022 + (i % 3) * 0.008, ph: (i * 0.83) % (Math.PI * 2), size: 3 + (i % 3), o: 0.18 + ((i * 7) % 5) * 0.06 }));
export const Outro: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  const frame = useCurrentFrame();
  const craneT = interpolate(frame, [0, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: CRANE });
  const pushT = interpolate(frame, [40, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const camScale = 1.06 - 0.06 * craneT + 0.035 * pushT;
  const tilt = 4 * (1 - craneT);
  const sweepX = interpolate(frame, [2, 14], [-700, 2020], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sweepO = interpolate(frame, [2, 5, 11, 14], [0, 0.14, 0.14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const stage = interpolate(frame, [42, 50, 58], [0, 0.55, 0.3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const recede = seg(frame, 42, 50);
  const tag = seg(frame, 66, 80, E.soft);
  const letters = 'Tab'.split('');
  return (
    <AbsoluteFill style={{ transform: `perspective(1400px) rotateX(${tilt}deg) scale(${camScale})`, transformOrigin: '50% 45%' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(900px 600px at 50% 47%, rgba(238,93,63,0.4), rgba(238,93,63,0) 70%)', opacity: stage }} />
      {elsFor(v).map((el, i) => {
        const cue = 4 + i * 3;
        const t = interpolate(frame, [cue, cue + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: FLY });
        const glow = interpolate(frame, [cue + 12, cue + 20], [0.4, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        if (frame < cue) return null;
        return (
          <div key={el.key} data-box={`fly:${el.key}`} style={{ position: 'absolute', left: el.cx, top: el.cy, transform: `translate(-50%, -50%) translate(${el.dx * (1 - t)}px, ${el.dy * (1 - t)}px) rotate(${el.rot * t + el.rot * 3 * (1 - t)}deg)`, opacity: Math.min(1, t * 2) * (1 - recede * 0.15), filter: `saturate(${1 - recede * 0.1}) drop-shadow(0 0 ${24 * glow}px rgba(238,93,63,${glow}))` }}>
            {el.node}
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 40 }}><div data-box="wordmark" style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        <div style={{ transform: `scale(${seg(frame, 40, 54, E.land)})` }}><TabMark size={170} /></div>
        <div style={{ font: `800 220px/1 ${FONT_T}`, letterSpacing: '-0.06em', color: C.white, display: 'flex' }}>
          {letters.map((ch, i) => {
            const p = seg(frame, 44 + i * 2, 58 + i * 2, E.land);
            return <span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${lerp(p, 1.25, 1)})` }}>{ch}</span>;
          })}
        </div>
      </div></div>
      <div data-box="tagline" style={{ position: 'absolute', left: 260, right: 260, top: 640, textAlign: 'center', opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
        <div style={{ font: `800 64px ${FONT_T}`, letterSpacing: '-0.04em', color: C.white }}>{v >= 2 ? 'money should never get between friends.' : 'it grows with your group.'}</div>
        <div style={{ marginTop: 14, font: `600 36px ${FONT_B}`, color: 'rgba(255,255,255,0.75)' }}>
          {v === 3 ? <><span style={{ color: C.orangeSoft, fontWeight: 800 }}>tab grows with your group</span> · built at mhacks 2026</> : v === 2 ? 'tab grows with your group · built at mhacks 2026' : 'built at mhacks 2026'}
        </div>
      </div>
      {DUST.map((d, i) => {
        const y = ((d.y0 - frame * d.rise * 2) % 1080 + 1080) % 1080;
        const x = d.x + Math.sin(frame * d.freq + d.ph) * d.amp;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: d.size, height: d.size, borderRadius: 99, background: C.orangeSoft, opacity: d.o * seg(frame, 30, 50), boxShadow: `0 0 8px ${C.orange}` }} />;
      })}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: sweepX, width: 420, background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,1), rgba(255,255,255,0))', opacity: sweepO, transform: 'skewX(-12deg)' }} />
    </AbsoluteFill>
  );
};

// ── S15 the payoff: the friend's phone buzzes. Tab already texted. ──
export const Payoff: React.FC = () => {
  const frame = useCurrentFrame();
  const banner = seg(frame, 26, 40, E.land);
  const bannerOut = seg(frame, 108, 118, E.inQuad);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <OffthreadVideo src={staticFile('footage/payoff-ai.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.04) saturate(1.08)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 40, display: 'flex', justifyContent: 'center', opacity: 1 - bannerOut }}>
        <div style={{ transform: `translateY(${(1 - banner) * -300}px)` }}>
          <IBanner app="Messages · taco crew 🌮" title="Tab" body="already did 😉 tacos were $14.00, so $7.00 each" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── S16 end card: the logo, held ──
export const EndCard: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const inP = seg(frame, 0, 10, E.outCubic);
  const out = seg(frame, dur - 10, dur, E.inQuad);
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <Field />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: inP, transform: `scale(${lerp(inP, 0.96, 1)})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <TabMark size={140} />
          <div style={{ font: `800 180px/1 ${FONT_T}`, letterSpacing: '-0.06em', color: C.white }}>Tab</div>
        </div>
        <div style={{ marginTop: 30, font: `700 48px ${FONT_B}`, color: 'rgba(255,255,255,0.85)' }}>the friend who actually texts back.</div>
        <div data-box="url" style={{ marginTop: 22, font: `600 40px ${FONT_B}`, color: C.orangeSoft }}>tab-ledger.vercel.app</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
