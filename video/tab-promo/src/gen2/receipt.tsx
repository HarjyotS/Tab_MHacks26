// The receipt: a DOM thermal-paper graphic (40 chars/line, 34px Courier Prime,
// 900px wide, ~2,300px tall). One component, three uses, identical by
// construction:
//   <ReceiptScroll>  head-on macro scroll / unfurl (readable)
//   <ReceiptPlate>   composited onto the H05 POV plate (texture, name readable)
//   <ReceiptPhoto>   the same plate, scaled into an iMessage photo bubble
import React, { useEffect, useId, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img, staticFile, useCurrentFrame } from 'remotion';
import { E, lerp, money, rand, seg } from '../theme';
import { firstExisting } from './cast';

export type ReceiptItem = { qty: number; name: string; cents: number };
export type ReceiptData = {
  name: string;
  cjk?: string;
  address: string;
  phone?: string;
  /** 3-column header rows: [left, center, right] */
  meta?: [string, string, string][];
  items: ReceiptItem[];
  tax: { label: string; rate: number };
  gratuity?: { label: string; rate: number };
  footer?: string[];
};

export const receiptTotals = (d: ReceiptData) => {
  const subtotal = d.items.reduce((a, it) => a + it.cents, 0);
  const tax = Math.round(subtotal * d.tax.rate);
  const gratuity = d.gratuity ? Math.round(subtotal * d.gratuity.rate) : 0;
  return { subtotal, tax, gratuity, total: subtotal + tax + gratuity };
};

// ── font ──
let fontLoading: Promise<void> | null = null;
/** Load Courier Prime (OFL, public/fonts) before frames render. Call once at the comp root. */
export const useReceiptFont = () => {
  const [handle] = useState(() => delayRender('Loading Courier Prime', { timeoutInMilliseconds: 60000 }));
  useEffect(() => {
    if (!fontLoading) {
      const faces = [
        new FontFace('Courier Prime', `url(${staticFile('fonts/CourierPrime-Regular.woff2')}) format('woff2')`, { weight: '400' }),
        new FontFace('Courier Prime', `url(${staticFile('fonts/CourierPrime-Bold.woff2')}) format('woff2')`, { weight: '700' }),
      ];
      fontLoading = Promise.all(faces.map((f) => f.load())).then((ls) => ls.forEach((f) => document.fonts.add(f)));
    }
    fontLoading.catch((e) => console.error('receipt font', e)).finally(() => continueRender(handle));
  }, [handle]);
};

// ── layout (fixed row heights, so any row's y is known without measuring) ──
export const PAPER_W = 900;
const COLS = 40;
const FS = 34;
const LH = 44;
const MONO = "'Courier Prime', 'Courier New', Courier, monospace";
const CJK = "'PingFang TC', 'Noto Sans TC', 'Hiragino Sans', 'Heiti TC', sans-serif";

type Row = { id: string; kind: 'gap' | 'title' | 'cjk' | 'center' | 'line' | 'total' | 'barcode'; text: string; h: number; bold?: boolean };

const padLR = (l: string, r: string) => l + r.padStart(Math.max(1, COLS - l.length));
const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((COLS - s.length) / 2))) + s;
const cols3 = ([l, c, r]: [string, string, string]) => {
  const mid = center(c).padEnd(COLS);
  const s = (l + mid.slice(l.length)).slice(0, COLS - r.length).padEnd(COLS - r.length) + r;
  return s;
};
const price = (c: number) => (c / 100).toFixed(2);

export const receiptLayout = (d: ReceiptData) => {
  const t = receiptTotals(d);
  const rows: Row[] = [];
  const add = (r: Omit<Row, 'h'> & { h?: number }) => rows.push({ h: LH, ...r });
  const rule = (id: string, ch = '-') => add({ id, kind: 'line', text: ch.repeat(COLS) });
  add({ id: 'top', kind: 'gap', text: '', h: 64 });
  add({ id: 'name', kind: 'title', text: d.name, h: 64, bold: true });
  if (d.cjk) add({ id: 'cjk', kind: 'cjk', text: d.cjk, h: 60 });
  add({ id: 'address', kind: 'center', text: d.address });
  if (d.phone) add({ id: 'phone', kind: 'center', text: d.phone });
  rule('rule-1');
  (d.meta ?? []).forEach((m, i) => add({ id: `meta-${i}`, kind: 'line', text: cols3(m) }));
  rule('rule-2');
  d.items.forEach((it, i) => add({ id: `item-${i}`, kind: 'line', text: padLR(`${String(it.qty).padEnd(3)}${it.name}`, price(it.cents)) }));
  rule('rule-3');
  add({ id: 'subtotal', kind: 'line', text: padLR('SUBTOTAL', price(t.subtotal)) });
  add({ id: 'tax', kind: 'line', text: padLR(d.tax.label, price(t.tax)) });
  if (d.gratuity) add({ id: 'gratuity', kind: 'line', text: padLR(d.gratuity.label, price(t.gratuity)) });
  rule('rule-4', '=');
  add({ id: 'total', kind: 'total', text: padLR('TOTAL', money(t.total)), h: 76, bold: true });
  rule('rule-5', '=');
  (d.footer ?? []).forEach((s, i) => add({ id: `footer-${i}`, kind: 'center', text: s, h: s ? LH : 22 }));
  add({ id: 'gap-b', kind: 'gap', text: '', h: 30 });
  add({ id: 'barcode', kind: 'barcode', text: '', h: 84 });
  add({ id: 'bottom', kind: 'gap', text: '', h: 70 });
  let y = 0;
  const placed = rows.map((r) => { const o = { ...r, y }; y += r.h; return o; });
  const byId = Object.fromEntries(placed.map((r) => [r.id, r]));
  return {
    rows: placed,
    height: y,
    /** y (px, receipt space) of a row's top / center */
    yOf: (id: string, at: 'top' | 'center' = 'center') => (byId[id] ? byId[id].y + (at === 'center' ? byId[id].h / 2 : 0) : 0),
    totals: t,
  };
};

// Torn thermal edges (zig-zag top and bottom).
const zigzag = (w: number, h: number, tooth = 18, depth = 8) => {
  const pts: string[] = [];
  for (let x = 0; x <= w; x += tooth) pts.push(`${x}px ${(x / tooth) % 2 ? 0 : depth}px`);
  pts.push(`${w}px ${depth}px`, `${w}px ${h - depth}px`);
  for (let x = w; x >= 0; x -= tooth) pts.push(`${x}px ${h - ((x / tooth) % 2 ? 0 : depth)}px`);
  pts.push(`0px ${h - depth}px`);
  return `polygon(${pts.join(',')})`;
};

const Barcode: React.FC = () => {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; x < 520; i++) {
    const w = 2 + Math.floor(rand(i * 7 + 3) * 4) * 2;
    bars.push({ x, w });
    x += w + 3 + Math.floor(rand(i * 13 + 1) * 3) * 2;
  }
  return (
    <svg width={520} height={64} style={{ display: 'block', margin: '0 auto' }}>
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={64} fill="#1d1b19" />)}
    </svg>
  );
};

export type ReceiptMark = { row: string; p: number; color?: string };

/** The receipt itself, at its native 900px width. `texture`: which rows the
 *  layout audit should treat as unreadable texture ('body' keeps the name readable). */
export const Receipt: React.FC<{
  data: ReceiptData;
  texture?: 'none' | 'body' | 'all';
  /** 0..1 unfurl: paper is revealed top-down with a roll at the edge */
  reveal?: number;
  marks?: ReceiptMark[];
  shadow?: boolean;
  /** 'ink': print only (no paper, grain, edges or shadow), for compositing onto a photo's blank paper */
  paper?: 'full' | 'ink';
  style?: React.CSSProperties;
}> = ({ data, texture = 'none', reveal = 1, marks = [], shadow = true, paper = 'full', style }) => {
  const L = receiptLayout(data);
  const ink = paper === 'ink';
  const noiseId = `paper-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const H = L.height;
  const shown = reveal >= 1 ? H : Math.max(0, reveal * H);
  const tex = (id: string) => (texture === 'all' || (texture === 'body' && id !== 'name') ? { 'data-texture': '1' } : {});
  return (
    <div style={{ position: 'relative', width: PAPER_W, height: reveal >= 1 ? H : shown + 26, ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: PAPER_W, height: shown, overflow: 'hidden', filter: shadow && !ink ? 'drop-shadow(0 22px 26px rgba(0,0,0,0.30)) drop-shadow(0 2px 3px rgba(0,0,0,0.20))' : undefined }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: PAPER_W, height: H, clipPath: ink ? undefined : zigzag(PAPER_W, H), background: ink ? 'transparent' : 'linear-gradient(180deg, #fdfbf6 0%, #faf7f0 40%, #f7f3ea 100%)' }}>
          {/* paper grain + faint thermal banding */}
          {!ink && <svg data-texture="1" width={PAPER_W} height={H} style={{ position: 'absolute', inset: 0, opacity: 0.5, mixBlendMode: 'multiply' }}>
            <filter id={noiseId}>
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
              <feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0.10 0" />
            </filter>
            <rect width="100%" height="100%" filter={`url(#${noiseId})`} />
          </svg>}
          {!ink && <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(120,110,95,0.025) 3px, rgba(120,110,95,0.025) 4px)' }} />}
          {/* rows */}
          {L.rows.map((r, i) => {
            const fade = 0.84 + 0.14 * rand(i * 3.7 + 11);
            const base: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: r.y, height: r.h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `rgba(28,26,24,${fade})`, whiteSpace: 'pre', textShadow: '0 0 0.7px rgba(20,18,16,0.45)' };
            if (r.kind === 'gap') return null;
            if (r.kind === 'barcode') return <div key={r.id} {...tex(r.id)} style={base}><Barcode /></div>;
            if (r.kind === 'title') return <div key={r.id} {...tex(r.id)} data-box="receipt:name" style={{ ...base, left: 40, right: 40, font: `700 42px/1 ${MONO}`, letterSpacing: '-0.02em' }}>{r.text}</div>;
            if (r.kind === 'cjk') return <div key={r.id} {...tex(r.id)} style={{ ...base, font: `600 40px/1 ${CJK}`, letterSpacing: '0.2em' }}>{r.text}</div>;
            if (r.kind === 'total') return (
              <div key={r.id} {...tex(r.id)} style={{ ...base, justifyContent: 'flex-start', paddingLeft: 42 }}>
                <span style={{ display: 'inline-block', font: `700 ${FS}px/1 ${MONO}`, transform: 'scaleY(1.7)', transformOrigin: 'center' }}>{r.text}</span>
              </div>
            );
            const text = r.kind === 'center' ? center(r.text) : r.text;
            return <div key={r.id} {...tex(r.id)} style={{ ...base, justifyContent: 'flex-start', paddingLeft: 42, font: `${r.bold ? 700 : 400} ${FS}px/1 ${MONO}` }}>{text}</div>;
          })}
          {/* highlighter marks (edit flourish) */}
          {marks.map((mk) => {
            const r = L.rows.find((x) => x.id === mk.row);
            if (!r || mk.p <= 0) return null;
            return <div key={mk.row} style={{ position: 'absolute', left: 30, top: r.y + 6, height: r.h - 12, width: (PAPER_W - 60) * Math.min(1, mk.p), background: mk.color ?? 'rgba(255,214,10,0.45)', mixBlendMode: 'multiply', borderRadius: 6 }} />;
          })}
          {/* edge curl: paper lifts slightly at the sides */}
          {!ink && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(60,45,30,0.10) 0%, rgba(60,45,30,0) 7%, rgba(255,255,255,0.0) 50%, rgba(60,45,30,0) 93%, rgba(60,45,30,0.09) 100%)' }} />}
        </div>
      </div>
      {reveal < 1 && (
        // the roll at the unfurl edge
        <div style={{ position: 'absolute', left: -10, right: -10, top: shown - 22, height: 48, borderRadius: 24, background: 'linear-gradient(180deg, #ffffff 0%, #f3efe6 35%, #d9d2c3 75%, #b9b09f 100%)', boxShadow: '0 16px 26px rgba(0,0,0,0.35)' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 6, background: 'rgba(255,255,255,0.8)', borderRadius: 3 }} />
        </div>
      )}
    </div>
  );
};

// ── macro scroll / unfurl ──
export type ReceiptCamKey = {
  at: number;
  /** a row id (e.g. 'name', 'item-0', 'total') or a raw receipt-space y */
  row?: string;
  y?: number;
  /** where that y sits in the frame, 0 = top, 1 = bottom (default 0.5) */
  anchor?: number;
  s?: number;
  /** easing for the move INTO this key */
  ease?: (t: number) => number;
};

const camAt = (frame: number, keys: { at: number; y: number; s: number; anchor: number; ease: (t: number) => number }[]) => {
  if (frame <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (frame <= b.at) {
      const t = b.ease(Math.min(1, Math.max(0, (frame - a.at) / Math.max(1, b.at - a.at))));
      return { at: frame, y: lerp(t, a.y, b.y), s: lerp(t, a.s, b.s), anchor: lerp(t, a.anchor, b.anchor), ease: b.ease };
    }
  }
  return keys[keys.length - 1];
};

/** Full-frame head-on receipt with a camera path (and optional unfurl). Vertical
 *  motion blur follows camera speed. */
export const ReceiptScroll: React.FC<{
  data: ReceiptData;
  /** camera path; omit with `unfurl` to follow the unrolling edge */
  keys?: ReceiptCamKey[];
  unfurl?: { from: number; to: number; s?: number };
  marks?: ReceiptMark[];
  background?: React.ReactNode;
}> = ({ data, keys, unfurl, marks, background }) => {
  const frame = useCurrentFrame();
  const L = receiptLayout(data);
  const blurId = `rblur-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const K = (keys ?? [{ at: 0, row: 'name', anchor: 0.3 }]).map((k) => ({ at: k.at, y: k.row ? L.yOf(k.row) : k.y ?? 0, s: k.s ?? 1, anchor: k.anchor ?? 0.5, ease: k.ease ?? E.inOutCubic }));
  const revealAt = (f: number) => (unfurl ? seg(f, unfurl.from, unfurl.to, E.inOutSine) : 1);
  const reveal = revealAt(frame);
  // follow mode: keep the unrolling edge at 80% of frame height once it gets there
  const follow = (f: number) => {
    const s = unfurl?.s ?? 1;
    const edge = revealAt(f) * L.height;
    return { at: f, y: Math.max(0, edge - (0.8 * 1080 - 60) / s), s, anchor: 60 / 1080, ease: E.linear };
  };
  const auto = !keys && !!unfurl;
  const cam = auto ? follow(frame) : camAt(frame, K);
  const prev = auto ? follow(frame - 1) : camAt(frame - 1, K);
  const speed = Math.abs(cam.y * cam.s - prev.y * prev.s);
  const blur = Math.min(10, speed * 0.06);
  const left = 960 - (PAPER_W / 2) * cam.s;
  const top = cam.anchor * 1080 - cam.y * cam.s;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {background ?? <TableBackdrop />}
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={blurId}><feGaussianBlur stdDeviation={`0 ${blur.toFixed(2)}`} /></filter>
      </svg>
      <div data-box="receipt" data-bleed="1" style={{ position: 'absolute', left, top, width: PAPER_W, transform: `scale(${cam.s})`, transformOrigin: '0 0', filter: blur > 0.3 ? `url(#${blurId})` : undefined }}>
        <Receipt data={data} reveal={reveal} marks={marks} />
      </div>
    </AbsoluteFill>
  );
};

/** Warm, out-of-focus restaurant table (stand-in until a plate exists). */
export const TableBackdrop: React.FC = () => (
  <AbsoluteFill data-bleed="1" style={{ background: 'radial-gradient(1200px 800px at 50% 40%, #4a3426 0%, #2a1c14 55%, #140d09 100%)' }}>
    <AbsoluteFill style={{ background: 'radial-gradient(500px 360px at 18% 20%, rgba(255,170,90,0.20), rgba(255,170,90,0)), radial-gradient(600px 420px at 85% 80%, rgba(210,60,40,0.18), rgba(210,60,40,0))' }} />
  </AbsoluteFill>
);

// ── POV plate composite (H05) ──
export type Placement = { x: number; y: number; s: number; rot: number };
export const DEFAULT_PLACE: Placement = { x: 573, y: 120, s: 0.86, rot: -1.2 };
type Pt = [number, number];

/** CSS matrix3d mapping the rect (0,0)–(w,h) onto quad tl, tr, br, bl (frame px). */
export const quadMatrix = (w: number, h: number, q: [Pt, Pt, Pt, Pt]) => {
  const src: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const B: number[] = [];
  src.forEach(([x, y], i) => {
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  });
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = c + 1; r < 8; r++) {
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      B[r] -= k * B[c];
    }
  }
  const x = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let acc = B[r];
    for (let j = r + 1; j < 8; j++) acc -= A[r][j] * x[j];
    x[r] = acc / A[r][r];
  }
  const [a, b, c, d, e, f, g, hh] = x;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
};

/** H05's blank strip, measured on the 2688×1520 plate and mapped to the
 *  cover-scaled 1080p frame (k = 0.7143, y offset −2.86): it widens toward
 *  the lens (213 px at the folder clip, 270 px at the frame bottom). */
const k05 = 1920 / 2688;
const y05 = (1080 - 1520 * k05) / 2;
export const H05_STRIP: [Pt, Pt, Pt, Pt] = [
  [1236 * k05, 236 * k05 + y05], [1530 * k05, 236 * k05 + y05],
  [1568 * k05, 1520 * k05 + y05], [1193 * k05, 1520 * k05 + y05],
];

/** 1920×1080 POV composite: the H05 plate with the receipt's ink laid on its
 *  blank strip in perspective (multiply, so the plate's light falls on it).
 *  Falls back to a CSS stand-in plate. The whole plate reads as texture; the
 *  macro scroll is the readable version. */
export const ReceiptPlate: React.FC<{ data: ReceiptData; place?: Placement; plate?: string | null }> = ({ data, place = DEFAULT_PLACE, plate }) => {
  const src = plate === null ? undefined : plate ?? firstExisting('gen2/stills/H05.png', 'gen2/stills/H05.jpg');
  const H = receiptLayout(data).height;
  return (
    <div data-texture="1" style={{ position: 'relative', width: 1920, height: 1080, overflow: 'hidden' }}>
      {src ? (
        <>
          <Img src={staticFile(src)} style={{ position: 'absolute', inset: 0, width: 1920, height: 1080, objectFit: 'cover' }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: PAPER_W, height: H, transformOrigin: '0 0', transform: quadMatrix(PAPER_W, H, H05_STRIP), mixBlendMode: 'multiply', opacity: 0.92 }}>
            <Receipt data={data} texture="all" paper="ink" />
          </div>
        </>
      ) : (
        <>
          <PlateStandIn place={place} />
          <div style={{ position: 'absolute', left: place.x, top: place.y, width: PAPER_W, transform: `rotate(${place.rot}deg) scale(${place.s})`, transformOrigin: '0 0' }}>
            <Receipt data={data} texture="all" />
          </div>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(1100px 760px at 50% 30%, rgba(255,214,160,0.10), rgba(40,20,5,0.22))', pointerEvents: 'none' }} />
        </>
      )}
    </div>
  );
};

const PlateStandIn: React.FC<{ place: Placement }> = ({ place }) => {
  const fw = PAPER_W * place.s + 150;
  return (
    <div data-texture="1" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(1300px 900px at 50% 40%, #f3ede2 0%, #e2d8c6 60%, #b9ab92 100%)' }}>
      {/* check presenter */}
      <div style={{ position: 'absolute', left: place.x - 75, top: place.y - 70, width: fw, height: 1300, borderRadius: 26, background: 'linear-gradient(160deg, #262120, #121010)', boxShadow: '0 30px 60px rgba(0,0,0,0.35)', transform: `rotate(${place.rot}deg)`, transformOrigin: '75px 70px' }}>
        <div style={{ position: 'absolute', inset: 16, borderRadius: 18, border: '2px dashed rgba(255,255,255,0.12)' }} />
      </div>
      {/* steamers, teacup, chopsticks */}
      {[{ x: 150, y: 160, r: 170 }, { x: 260, y: 520, r: 140 }, { x: 1700, y: 230, r: 160 }].map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: c.x - c.r, top: c.y - c.r, width: c.r * 2, height: c.r * 2, borderRadius: '50%', background: 'radial-gradient(circle, #e8cf9c 0%, #d2b072 55%, #a9824a 70%, #c9a368 72%, #8c6a3a 100%)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', filter: 'blur(1.5px)' }} />
      ))}
      <div style={{ position: 'absolute', left: 1580, top: 640, width: 190, height: 190, borderRadius: '50%', background: 'radial-gradient(circle, #a8743c 0%, #8a5a28 48%, #fafafa 52%, #e6e6e6 100%)', boxShadow: '0 18px 36px rgba(0,0,0,0.3)' }} />
      {[0, 1].map((i) => <div key={i} style={{ position: 'absolute', left: 1460 + i * 26, top: 300, width: 14, height: 520, borderRadius: 7, background: 'linear-gradient(90deg,#5a3a22,#2e1c10)', transform: `rotate(${8 + i * 3}deg)`, boxShadow: '0 10px 18px rgba(0,0,0,0.3)' }} />)}
    </div>
  );
};

/** The plate scaled into a photo (for an iMessage photo bubble). `crop` is in
 *  plate pixels; the default is a 4:5 portrait around the receipt. */
export const ReceiptPhoto: React.FC<{ data: ReceiptData; width: number; crop?: { x: number; y: number; w: number; h: number }; place?: Placement; plate?: string | null }> = ({
  data, width, crop = { x: 556, y: 0, w: 860, h: 1080 }, place, plate,
}) => {
  const k = width / crop.w;
  return (
    <div data-texture="1" style={{ position: 'relative', width, height: Math.round(crop.h * k), overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: -crop.x * k, top: -crop.y * k, width: 1920, height: 1080, transform: `scale(${k})`, transformOrigin: '0 0' }}>
        <ReceiptPlate data={data} place={place} plate={plate} />
      </div>
    </div>
  );
};
