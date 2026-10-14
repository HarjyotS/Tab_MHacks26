// Tab's own design tokens (web/src/styles.css) plus the one glass recipe the
// whole film uses. Motion voice: the "friendly" preset from video-shotcraft
// (26f main duration); landings overshoot (y1 > 1), numbers never bounce.
import type { CSSProperties } from 'react';
import { Easing } from 'remotion';

export const C = {
  orange: '#ee5d3f',
  orangeSoft: '#ff8a6b',
  green: '#173c2f',
  greenDeep: '#0b1a13',
  greenNode: '#1f2f27',
  ink: '#18231e',
  mint: '#e7f5ee',
  mintInk: '#19805d',
  mintBright: '#86e3b4',
  paper: '#eef2ef',
  white: '#ffffff',
};

export const FONT_T = "'Manrope', 'DM Sans', system-ui, 'Apple Color Emoji', sans-serif";
export const FONT_B = "'DM Sans', system-ui, 'Apple Color Emoji', sans-serif";

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (t: number, a: number, b: number) => a + (b - a) * t;

// Easing table and segment progress, same primitives as the skill's Motion fixture.
export const E = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inOutSine: (t: number) => 0.5 - Math.cos(Math.PI * clamp01(t)) / 2,
  friendly: Easing.bezier(0.25, 0.46, 0.45, 0.94),
  land: Easing.bezier(0.34, 1.4, 0.44, 1), // outro FLY_EASE: real overshoot
  soft: Easing.bezier(0.2, 0.75, 0.25, 1), // stream-response ease
};

/** Progress of `f` inside [a, b], eased, clamped. */
export const seg = (f: number, a: number, b: number, ease: (x: number) => number = E.linear) =>
  ease(clamp01((f - a) / (b - a)));

/** Deterministic noise in [0,1) from an integer seed. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const money = (cents: number) =>
  `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

type GlassOpts = { tint?: string; blur?: number; radius?: number; edge?: number; shadow?: boolean };

/** Frosted glass: blur + saturate behind, a hairline edge, a top sheen. */
export const glass = ({ tint = 'rgba(255,255,255,0.14)', blur = 28, radius = 28, edge = 0.34, shadow = true }: GlassOpts = {}): CSSProperties => ({
  backgroundColor: tint,
  backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 60%)',
  backdropFilter: `blur(${blur}px) saturate(170%)`,
  WebkitBackdropFilter: `blur(${blur}px) saturate(170%)`,
  border: `1.5px solid rgba(255,255,255,${edge})`,
  borderRadius: radius,
  boxShadow: shadow
    ? `0 30px 80px rgba(4,14,9,0.38), inset 0 1.5px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(255,255,255,0.08)`
    : `inset 0 1.5px 0 rgba(255,255,255,0.5)`,
});

/** Dark glass for light backgrounds. */
export const glassDark = (o: GlassOpts = {}): CSSProperties =>
  glass({ tint: 'rgba(16,40,30,0.55)', edge: 0.22, ...o });
