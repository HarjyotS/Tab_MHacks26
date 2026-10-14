// The "hacky but well-edited" kit for gen 2: placeholders for AI footage,
// freeze frames with tags / name cards, punch-ins with snap, record-scratch
// freezes, burned-in subtitles, quick cuts, "N days later", side captions,
// portrait cards and the tagline end card. All frame-driven and deterministic.
import React from 'react';
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { DigitRoll, TabMark } from '../components';
import { C, E, FONT_B, FONT_T, glass, lerp, rand, seg } from '../theme';
import { CAST, CastId, firstExisting, monogram, portraitFor } from './cast';

/** Children only inside [from, to); time is NOT shifted (data stays in film frames). */
export const Window: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => {
  const frame = useCurrentFrame();
  return frame >= from && frame < to ? <>{children}</> : null;
};

/** One-frame-ish white flash (cuts, shutter). */
export const Flash: React.FC<{ at: number; dur?: number; peak?: number }> = ({ at, dur = 5, peak = 0.6 }) => {
  const frame = useCurrentFrame();
  const o = frame < at ? 0 : peak * (1 - seg(frame, at + 1, at + dur, E.outQuad));
  return o > 0.001 ? <AbsoluteFill data-bleed="1" style={{ background: '#fff', opacity: o, pointerEvents: 'none' }} /> : null;
};

// ── AI footage placeholder (auto-swaps to the real still/clip once it lands in public/) ──
export const Placeholder: React.FC<{
  id: string; label: string; hue?: number;
  /** public/ paths to try first, e.g. 'gen2/clips/M1.mp4', 'gen2/stills/H02.png' */
  clip?: string; still?: string;
  /** source frame offset for the clip */ trimBefore?: number;
  /** show the id/label slate (off for blurred backdrops) */ slate?: boolean;
}> = ({ id, label, hue = 20, clip, still, trimBefore, slate = true }) => {
  const frame = useCurrentFrame();
  const c = clip ? firstExisting(clip) : undefined;
  const s = still ? firstExisting(still) : undefined;
  if (c) return <AbsoluteFill data-bleed="1"><OffthreadVideo src={staticFile(c)} muted trimBefore={trimBefore} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
  if (s) return <AbsoluteFill data-bleed="1"><Img src={staticFile(s)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
  return (
    <AbsoluteFill data-bleed="1" style={{ background: `linear-gradient(135deg, hsl(${hue} 42% 30%), hsl(${hue + 25} 48% 16%))` }}>
      <AbsoluteFill style={{ background: `repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 2px, rgba(255,255,255,0) 2px 46px)` }} />
      <AbsoluteFill style={{ border: '6px solid rgba(255,255,255,0.18)' }} />
      {/* slate (bottom-left, compact): placeholder only, so it never counts as an overlap */}
      {slate && (
        <div data-overlay="1" style={{ position: 'absolute', left: 64, bottom: 64, width: 340 }}>
          <div data-box={`slate:${id}`} style={{ ...glass({ tint: 'rgba(0,0,0,0.30)', radius: 22, blur: 10, edge: 0.2 }), padding: '12px 20px', opacity: 0.85 }}>
            <div style={{ font: `800 34px ${FONT_T}`, color: '#fff', letterSpacing: '-0.02em' }}>{id} · AI <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>f{frame}</span></div>
            <div style={{ font: `600 30px/1.2 ${FONT_B}`, color: 'rgba(255,255,255,0.82)', marginTop: 4 }}>{label}</div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── camera: Ken Burns drift with optional snap punch-ins ──
export type CamKey = {
  at: number; s: number;
  /** focal point, 0..1 of the frame */ x?: number; y?: number;
  /** snap into this key over the last `snapDur` frames (default 4) instead of drifting */ snap?: boolean; snapDur?: number;
  ease?: (t: number) => number;
};
export const camState = (frame: number, keys: CamKey[]) => {
  const k = keys.map((q) => ({ ...q, x: q.x ?? 0.5, y: q.y ?? 0.5 }));
  if (frame <= k[0].at) return k[0];
  for (let i = 1; i < k.length; i++) {
    const a = k[i - 1], b = k[i];
    if (frame <= b.at) {
      const t = b.snap ? seg(frame, b.at - (b.snapDur ?? 4), b.at, E.outCubic) : seg(frame, a.at, b.at, b.ease ?? E.inOutSine);
      return { ...b, s: lerp(t, a.s, b.s), x: lerp(t, a.x, b.x), y: lerp(t, a.y, b.y) };
    }
  }
  return k[k.length - 1];
};
/** Full-bleed punch-in / push on whatever it wraps (still, video, placeholder). */
export const PunchIn: React.FC<{ keys: CamKey[]; children: React.ReactNode }> = ({ keys, children }) => {
  const frame = useCurrentFrame();
  const c = camState(frame, keys);
  const p = camState(frame - 1, keys);
  const blur = Math.min(3, Math.abs(c.s - p.s) * 30);
  return (
    <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${c.s})`, transformOrigin: `${c.x * 100}% ${c.y * 100}%`, filter: blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : undefined }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── freeze frames ──
/** Freeze the wrapped media at `at`: flash, desaturate (or B&W), slow push. */
export const FreezeFrame: React.FC<{
  at: number; children: React.ReactNode;
  desat?: number; bw?: boolean; push?: [number, number]; pushDur?: number; flash?: boolean;
  /** freeze the media at this frame instead of `at` (e.g. a cleaner frame) */ hold?: number;
}> = ({ at, children, desat = 0.4, bw = false, push = [1, 1.06], pushDur = 90, flash = true, hold }) => {
  const frame = useCurrentFrame();
  const on = frame >= at;
  const k = seg(frame, at, at + 6, E.outCubic);
  const sat = bw ? 1 - k : 1 - desat * k;
  const s = on ? lerp(seg(frame, at, at + pushDur, E.inOutSine), push[0], push[1]) : 1;
  return (
    <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${s})`, filter: on ? `saturate(${sat.toFixed(3)}) contrast(${1 + 0.06 * k})` : undefined }}>
        <Freeze frame={hold ?? at} active={(f) => f >= at}>{children}</Freeze>
      </AbsoluteFill>
      {flash && <Flash at={at} peak={0.45} />}
    </AbsoluteFill>
  );
};

/** Record-scratch freeze: hard stop, a decaying jolt, desaturation, optional SFX. */
export const RecordScratch: React.FC<{ at: number; children: React.ReactNode; desat?: number; sfx?: string | false; sfxVolume?: number; jolt?: number }> = ({
  at, children, desat = 0.4, sfx = 'vinyl-scratch-small', sfxVolume = 0.45, jolt = 18,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  const dx = t >= 0 && t < 8 ? jolt * Math.sin(t * 2.4) * (1 - t / 8) : 0;
  const zoom = t >= 0 ? lerp(seg(frame, at, at + 3, E.outCubic), 1.04, 1) : 1;
  return (
    <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translateX(${dx}px) scale(${zoom})` }}>
        <FreezeFrame at={at} desat={desat} push={[1, 1.03]} flash>{children}</FreezeFrame>
      </AbsoluteFill>
      {sfx && <Sequence from={Math.max(0, at - 1)} durationInFrames={30} layout="none"><Audio src={staticFile(`audio/sfx/${sfx}.mp3`)} volume={sfxVolume} /></Sequence>}
    </AbsoluteFill>
  );
};

/** Freeze-frame tag pill pointing at a head. (x, y) is the point the pointer
 *  touches; `dir` says where the pill sits relative to it (default above). */
export const Tag: React.FC<{ text: string; x: number; y: number; at: number; until?: number; accent?: boolean; size?: number; id?: string; dir?: 'up' | 'down' | 'left' | 'right' }> = ({
  text, x, y, at, until = 1e9, accent = false, size = 36, id, dir = 'up',
}) => {
  const frame = useCurrentFrame();
  const p = seg(frame, at, at + 8, E.land);
  const out = seg(frame, until - 5, until, E.inQuad);
  if (frame < at || frame >= until) return null;
  const rot = (rand(at * 3.1 + x) - 0.5) * 5;
  const bg = accent ? C.orange : 'rgba(255,255,255,0.96)';
  const fg = accent ? '#fff' : '#111';
  const T = 12; // pointer size
  const place: Record<string, { box: React.CSSProperties; origin: string; ptr: React.CSSProperties }> = {
    up: { box: { left: 0, bottom: 14, transform: `translateX(-50%) scale(${p}) rotate(${rot}deg)` }, origin: '50% 100%', ptr: { left: '50%', bottom: -11, marginLeft: -T, borderLeft: `${T}px solid transparent`, borderRight: `${T}px solid transparent`, borderTop: `${T}px solid ${bg}` } },
    down: { box: { left: 0, top: 14, transform: `translateX(-50%) scale(${p}) rotate(${rot}deg)` }, origin: '50% 0%', ptr: { left: '50%', top: -11, marginLeft: -T, borderLeft: `${T}px solid transparent`, borderRight: `${T}px solid transparent`, borderBottom: `${T}px solid ${bg}` } },
    right: { box: { left: 14, top: 0, transform: `translateY(-50%) scale(${p}) rotate(${rot}deg)` }, origin: '0% 50%', ptr: { top: '50%', left: -11, marginTop: -T, borderTop: `${T}px solid transparent`, borderBottom: `${T}px solid transparent`, borderRight: `${T}px solid ${bg}` } },
    left: { box: { right: 14, top: 0, transform: `translateY(-50%) scale(${p}) rotate(${rot}deg)` }, origin: '100% 50%', ptr: { top: '50%', right: -11, marginTop: -T, borderTop: `${T}px solid transparent`, borderBottom: `${T}px solid transparent`, borderLeft: `${T}px solid ${bg}` } },
  };
  const P = place[dir];
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, opacity: 1 - out }}>
      <div style={{ position: 'absolute', ...P.box, transformOrigin: P.origin }}>
        <div data-box={`tag:${id ?? text}`} style={{ position: 'relative', background: bg, color: fg, borderRadius: 999, padding: '8px 24px 10px', font: `700 ${size}px ${FONT_B}`, whiteSpace: 'nowrap', boxShadow: '0 10px 26px rgba(0,0,0,0.35)' }}>
          {text}
          <div style={{ position: 'absolute', width: 0, height: 0, ...P.ptr }} />
        </div>
      </div>
    </div>
  );
};

// ── media: AI clip (or its approved still) with camera, blur boxes, freeze ──
export type BlurKey = { t: number; x: number; y: number; w: number; h: number };
/** A feathered blur patch (hides AI gibberish text); keys in local frames, frame coords. */
export const BlurBox: React.FC<{ keys: BlurKey[]; px?: number; from?: number }> = ({ keys, px = 7, from = 0 }) => {
  const frame = useCurrentFrame() + from;
  if (!keys.length) return null;
  let k = keys[keys.length - 1];
  if (frame <= keys[0].t) k = keys[0];
  else {
    for (let i = 1; i < keys.length; i++) {
      if (frame <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        const u = (frame - a.t) / Math.max(1, b.t - a.t);
        k = { t: frame, x: lerp(u, a.x, b.x), y: lerp(u, a.y, b.y), w: lerp(u, a.w, b.w), h: lerp(u, a.h, b.h) };
        break;
      }
    }
  }
  const mask = 'radial-gradient(closest-side, #000 62%, transparent 100%)';
  return <div style={{ position: 'absolute', left: k.x, top: k.y, width: k.w, height: k.h, backdropFilter: `blur(${px}px)`, WebkitBackdropFilter: `blur(${px}px)`, maskImage: mask, WebkitMaskImage: mask, pointerEvents: 'none' }} />;
};

/** A shot: plays `clip` from `in` seconds (cover-scaled 1080p), falling back to
 *  `still` (with its own camera) and then a labeled placeholder. Time is local. */
export const Media: React.FC<{
  id: string; label: string; hue?: number;
  clip?: string; in?: number; still?: string;
  cam?: CamKey[]; clipCam?: CamKey[];
  blur?: BlurKey[]; blurFrom?: number;
  filter?: string;
}> = ({ id, label, hue, clip, in: inSec = 0, still, cam, clipCam, blur, blurFrom = 0, filter }) => {
  const hasClip = !!(clip && firstExisting(clip));
  const keys = hasClip ? clipCam : cam;
  const body = (
    <AbsoluteFill style={{ filter }}>
      <Placeholder id={id} label={label} hue={hue} clip={clip} still={still} trimBefore={Math.round(inSec * 30)} />
      {hasClip && blur && <BlurBox keys={blur} from={blurFrom} />}
    </AbsoluteFill>
  );
  return keys?.length ? <PunchIn keys={keys}>{body}</PunchIn> : body;
};

/** One cell of the H08 reaction grid, cropped 16:9 and scaled to fill the frame. */
export const H08_CELLS = {
  grandpa: { x: 25, y: 140 },
  baby: { x: 937, y: 90 },
  captain: { x: 1850, y: 95 },
  gym: { x: 25, y: 800 },
  ceo: { x: 937, y: 800 },
  astronaut: { x: 1850, y: 780 }, // keeps the lower-right flag patch out of frame
} as const;
export const GridCell: React.FC<{ cell: keyof typeof H08_CELLS; src?: string; w?: number }> = ({ cell, src = 'gen2/stills/H08.png', w = 877 }) => {
  const c = H08_CELLS[cell];
  const k = 1920 / w;
  const file = firstExisting(src);
  if (!file) return <Placeholder id="H08" label={`reaction: ${cell}`} hue={20} />;
  return (
    <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden', background: '#000' }}>
      <Img src={staticFile(file)} style={{ position: 'absolute', left: -c.x * k, top: -c.y * k, width: 2752 * k, height: 1536 * k, maxWidth: 'none' }} />
    </AbsoluteFill>
  );
};

/** Lower-third name card ("kien." / "probably fine."). */
export const NameCard: React.FC<{ name: string; sub?: string; at: number; until?: number; x?: number; y?: number }> = ({
  name, sub, at, until = 1e9, x = 96, y = 96,
}) => {
  const frame = useCurrentFrame();
  if (frame < at || frame >= until) return null;
  const bar = seg(frame, at, at + 8, E.outCubic);
  const nm = seg(frame, at + 4, at + 16, E.land);
  const sb = seg(frame, at + 10, at + 22, E.soft);
  const out = seg(frame, until - 8, until, E.inQuad);
  return (
    <div data-box={`namecard:${name}`} style={{ position: 'absolute', left: x, top: y, opacity: 1 - out, transform: `translateX(${-30 * out}px)`, ...glass({ tint: 'rgba(10,14,12,0.48)', radius: 28, blur: 22, edge: 0.18 }), padding: '22px 40px 26px 34px', display: 'flex', gap: 26, alignItems: 'stretch' }}>
      <div style={{ width: 10, borderRadius: 5, background: C.orange, transform: `scaleY(${bar})`, transformOrigin: 'top' }} />
      <div>
        <div style={{ font: `800 96px/1 ${FONT_T}`, letterSpacing: '-0.045em', color: '#fff', opacity: nm, transform: `translateX(${(1 - nm) * -24}px)` }}>{name}</div>
        {sub && <div style={{ font: `600 46px/1.2 ${FONT_B}`, color: 'rgba(255,255,255,0.88)', marginTop: 10, opacity: sb, transform: `translateY(${(1 - sb) * 10}px)` }}>{sub}</div>}
      </div>
    </div>
  );
};

// ── text ──
export type SubLine = { text: string; from: number; to: number; speaker?: string };
/** Burned-in dialogue subtitles: white, soft shadow, ≥56px, bottom band. */
export const Subtitles: React.FC<{ lines: SubLine[]; bottom?: number; size?: number }> = ({ lines, bottom = 80, size = 58 }) => {
  const frame = useCurrentFrame();
  const l = lines.find((x) => frame >= x.from && frame < x.to);
  if (!l) return null;
  const o = seg(frame, l.from, l.from + 4) * (1 - seg(frame, l.to - 4, l.to));
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div data-box={`caption:sub:${l.text}`} style={{ maxWidth: 1500, textAlign: 'center', font: `700 ${Math.max(56, size)}px/1.18 ${FONT_B}`, color: '#fff', opacity: o, textShadow: '0 2px 3px rgba(0,0,0,0.75), 0 4px 22px rgba(0,0,0,0.55)', letterSpacing: '-0.01em' }}>
        {l.speaker && <span style={{ color: 'rgba(255,255,255,0.72)' }}>{l.speaker}: </span>}
        {l.text}
      </div>
    </div>
  );
};

/** R-bottom side caption (chat scenes): 60px, max 2 lines, left-aligned glass. */
export const SideCaption: React.FC<{ text: string; from: number; to: number; x?: number; y?: number; w?: number; size?: number }> = ({
  text, from, to, x = 860, y = 840, w = 940, size = 60,
}) => {
  const frame = useCurrentFrame();
  const inP = seg(frame, from, from + 12, E.soft);
  const outP = seg(frame, to - 8, to, E.inQuad);
  const o = inP * (1 - outP);
  if (frame < from || frame >= to || o <= 0.001) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: 160, display: 'flex', alignItems: 'center' }}>
      <div data-box={`caption:side:${text}`} style={{ ...glass({ tint: 'rgba(12,30,22,0.46)', radius: 34, blur: 30, edge: 0.26 }), padding: '16px 36px 20px', font: `800 ${size}px/1.12 ${FONT_T}`, letterSpacing: '-0.035em', color: '#fff', opacity: o, transform: `translateY(${18 * (1 - inP)}px)`, filter: `blur(${6 * (1 - inP)}px)`, maxWidth: w }}>
        {text}
      </div>
    </div>
  );
};

/** "N days later": full-frame glass card, or the R-bottom side caption. */
export const DaysLater: React.FC<{ text?: string; from: number; to: number; variant?: 'glass' | 'side' }> = ({ text = '3 days later', from, to, variant = 'glass' }) => {
  const frame = useCurrentFrame();
  if (variant === 'side') return <SideCaption text={text} from={from} to={to} />;
  if (frame < from || frame >= to) return null;
  const inP = seg(frame, from, from + 10, E.outCubic);
  const out = seg(frame, to - 8, to, E.inQuad);
  const words = text.split(' ');
  return (
    <AbsoluteFill data-bleed="1" style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - out }}>
      <AbsoluteFill style={{ background: 'rgba(6,10,8,0.5)', backdropFilter: `blur(${18 * inP}px)`, WebkitBackdropFilter: `blur(${18 * inP}px)`, opacity: inP }} />
      <div data-box={`card:${text}`} style={{ ...glass({ tint: 'rgba(255,255,255,0.12)', radius: 48, blur: 30 }), padding: '48px 80px 56px', display: 'flex', gap: 36, transform: `scale(${lerp(inP, 0.94, 1)})` }}>
        {words.map((w, i) => {
          const p = seg(frame, from + 3 + i * 4, from + 15 + i * 4, E.land);
          return <span key={i} style={{ font: `800 128px/1 ${FONT_T}`, letterSpacing: '-0.05em', color: i === 0 ? C.orange : '#fff', opacity: p, transform: `translateY(${(1 - p) * 30}px)`, display: 'inline-block' }}>{w}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── cuts ──
export type Cut = { dur: number; node: React.ReactNode; zoom?: [number, number]; focus?: [number, number] };
/** Hard cuts through a list of shots; each gets a snap punch (1.00→1.08 by default). */
export const QuickCuts: React.FC<{ cuts: Cut[]; flash?: boolean }> = ({ cuts, flash = true }) => {
  let t = 0;
  return (
    <AbsoluteFill>
      {cuts.map((c, i) => {
        const from = t;
        t += c.dur;
        const [z0, z1] = c.zoom ?? [1, 1.08];
        const [fx, fy] = c.focus ?? [0.5, 0.45];
        return (
          <Sequence key={i} from={from} durationInFrames={c.dur} layout="none">
            <PunchIn keys={[{ at: 0, s: z0, x: fx, y: fy }, { at: 3, s: lerp(0.7, z0, z1), x: fx, y: fy, snap: true, snapDur: 3 }, { at: c.dur, s: z1, x: fx, y: fy, ease: E.linear }]}>{c.node}</PunchIn>
            {flash && i > 0 && <Flash at={0} dur={3} peak={0.22} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// ── R-top portrait cards ──
export const PORTRAIT = { w: 520, h: 640 };
const emojiOf = (name: string) => name.replace(/^[^\p{Extended_Pictographic}]*/u, '').trim();

export const PortraitCard: React.FC<{ id: CastId; label?: string }> = ({ id, label }) => {
  const m = CAST[id];
  const src = portraitFor(id);
  const emoji = emojiOf(m.name);
  return (
    <div style={{ width: PORTRAIT.w }}>
      <div data-box={`portrait:${id}`} style={{ width: PORTRAIT.w, height: PORTRAIT.h, borderRadius: 40, overflow: 'hidden', background: monogram(m.tint), boxShadow: '0 30px 70px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', position: 'relative' }}>
        {src ? (
          <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 190, lineHeight: 1 }}>{emoji || '🙂'}</div>
            <div style={{ font: `700 110px ${FONT_T}`, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.04em' }}>{m.initials}</div>
          </div>
        )}
      </div>
      <div data-box={`portrait-label:${id}`} style={{ marginTop: 14, textAlign: 'center', font: `700 40px ${FONT_B}`, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
        {label ?? m.name}
      </div>
    </div>
  );
};

/** A run of portrait cards that blur-swap; `who: null` clears the stage. */
export const PortraitStage: React.FC<{ beats: { at: number; who: CastId | null }[]; x?: number; y?: number; swap?: number }> = ({ beats, x = 1070, y = 70, swap = 6 }) => {
  const frame = useCurrentFrame();
  const past = beats.filter((b) => b.at <= frame);
  const cur = past[past.length - 1];
  const prev = past[past.length - 2];
  const p = cur ? seg(frame, cur.at, cur.at + swap, E.outCubic) : 0;
  return (
    <>
      {prev?.who && p < 1 && (
        <div data-overlay="1" style={{ position: 'absolute', left: x, top: y, opacity: 1 - p, filter: `blur(${10 * p}px)`, transform: `scale(${lerp(p, 1, 0.96)})` }}>
          <PortraitCard id={prev.who} />
        </div>
      )}
      {cur?.who && (
        <div style={{ position: 'absolute', left: x, top: y, opacity: p, filter: `blur(${12 * (1 - p)}px)`, transform: `scale(${lerp(p, 1.05, 1)})` }}>
          <PortraitCard id={cur.who} />
        </div>
      )}
    </>
  );
};

// ── growth + end card ──
/** Glass counter chip, e.g. "11 → 100 friends". */
export const CountChip: React.FC<{ from: number; to: number; at: number; label: string; right?: number; y?: number }> = ({ from, to, at, label, right = 64, y = 64 }) => {
  const frame = useCurrentFrame();
  const inP = seg(frame, at - 10, at, E.outCubic);
  return (
    <div data-box={`chip:${label}`} style={{ position: 'absolute', right, top: y, ...glass({ tint: 'rgba(12,30,22,0.45)', radius: 30, blur: 26 }), padding: '14px 30px', display: 'flex', alignItems: 'center', gap: 18, opacity: inP }}>
      <span style={{ font: `800 60px ${FONT_T}`, color: 'rgba(255,255,255,0.7)' }}>{from}</span>
      <span style={{ font: `800 48px ${FONT_T}`, color: C.orange }}>→</span>
      {frame < at ? <span style={{ font: `800 60px ${FONT_T}`, color: '#fff' }}>{from}</span> : <DigitRoll value={String(to)} delay={at} size={60} color="#fff" />}
      <span style={{ font: `700 40px ${FONT_B}`, color: '#fff' }}>{label}</span>
    </div>
  );
};

/** Tagline end card: tagline (two lines), then mark + wordmark, descriptor, feature row, credit. */
export const TaglineCard: React.FC<{
  tagline: string; at: number; lockAt: number;
  descriptor?: string; features?: string[]; credit?: string;
}> = ({ tagline, at, lockAt, descriptor = 'the friend in your group chat who keeps the tab.', features = ['text it', 'snap the receipt', '👍 to settle', 'live ledger'], credit = 'built at mhacks 2026' }) => {
  const frame = useCurrentFrame();
  const lines = tagline.split(/(?<=\.)\s+/);
  const lock = seg(frame, lockAt, lockAt + 14, E.land);
  const sub = seg(frame, lockAt + 10, lockAt + 24, E.soft);
  const row = seg(frame, lockAt + 18, lockAt + 32, E.soft);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div data-box="tagline" style={{ textAlign: 'center' }}>
        {lines.map((l, i) => {
          const p = seg(frame, at + i * 8, at + i * 8 + 14, E.land);
          return <div key={i} style={{ font: `800 96px/1.08 ${FONT_T}`, letterSpacing: '-0.045em', color: i === lines.length - 1 ? C.orange : '#fff', opacity: p, transform: `translateY(${(1 - p) * 36}px) scale(${lerp(p, 1.08, 1)})`, filter: `blur(${(1 - p) * 8}px)` }}>{l}</div>;
        })}
      </div>
      <div style={{ height: 56 }} />
      <div data-box="wordmark" style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: lock > 0 ? 1 : 0, transform: `scale(${lerp(lock, 0.9, 1)})` }}>
        <TabMark size={118} />
        <div style={{ font: `800 150px/1 ${FONT_T}`, letterSpacing: '-0.06em', color: '#fff' }}>Tab</div>
      </div>
      <div data-box="descriptor" style={{ marginTop: 22, font: `600 44px ${FONT_B}`, color: 'rgba(255,255,255,0.9)', opacity: sub }}>{descriptor}</div>
      <div data-box="features" style={{ marginTop: 22, font: `600 34px ${FONT_B}`, color: 'rgba(255,255,255,0.78)', opacity: row, display: 'flex', gap: 18 }}>
        {features.map((f, i) => <span key={f}>{i ? <span style={{ color: C.orange, marginRight: 18 }}>·</span> : null}{f}</span>)}
      </div>
      <div data-box="credit" style={{ marginTop: 18, font: `600 30px ${FONT_B}`, color: 'rgba(255,255,255,0.6)', opacity: row }}>{credit}</div>
    </AbsoluteFill>
  );
};
