// Single source of truth for timing. Everything is computed in float seconds
// from the music grid (bgm-tech-house: 123.99 BPM, grid fitted to 99% of beats,
// 3.6ms mean error) and only converted to frames at the end.
export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const BEAT = 0.483907; // seconds per beat
export const T0 = 0.1707; // first downbeat in the source track
export const BAR = 4 * BEAT; // 1.935628s
export const srcBar = (n: number) => T0 + n * BAR;
export const f = (sec: number) => Math.round(sec * FPS);
/** Frames for n beats, measured from a shot that starts on a downbeat. */
export const beats = (n: number) => Math.round(n * BEAT * FPS);

// Cold open: the real clip plays to "all right, bet." (6.28s), then freezes.
const COLD_END = 6.3;
const FREEZE_END = 8.8; // music enters here, on the build (source bar 4)
const DROP1 = FREEZE_END + 4 * BAR; // four bars of "the mess grows" → drop

// Shots that ride the music, in bars after the drop.
const BARS: [string, number][] = [
  ['brand', 2],
  ['textIt', 3],
  ['receipt', 4],
  ['drinks', 4],
  ['remembers', 2],
  ['ask', 4],
  ['settle', 4],
  ['ledger', 4],
  ['hood', 4], // music naturally falls into its breakdown here (source bars 35–39)
  ['grows', 4], // second music clip: the build into drop 2 (source bars 58–62)
  ['outro', 3], // drop 2
];

type Shot = { from: number; dur: number; startSec: number };
const secs: Record<string, [number, number]> = {
  cold: [0, COLD_END],
  freeze: [COLD_END, FREEZE_END],
  mess: [FREEZE_END, DROP1],
};
let t = DROP1;
for (const [name, n] of BARS) {
  secs[name] = [t, t + n * BAR];
  t += n * BAR;
}
const OUTRO_END = t;
secs.payoff = [OUTRO_END, OUTRO_END + 4.0];
secs.endcard = [OUTRO_END + 4.0, OUTRO_END + 6.0];

export const SHOTS: Record<string, Shot> = Object.fromEntries(
  Object.entries(secs).map(([k, [a, b]]) => [k, { from: f(a), dur: f(b) - f(a), startSec: a }]),
);
export const TOTAL = f(secs.endcard[1]);

// Music edit: clip 1 rides from the build (source bar 4) through the breakdown
// (source bar 39); clip 2 jumps to the build at source bar 58 so drop 2 lands
// on the outro, and stops dead on the downbeat of source bar 65 (the "button").
export const MUSIC = [
  { from: f(FREEZE_END), trimBefore: f(srcBar(4)), trimAfter: f(srcBar(39)) },
  { from: f(secs.grows[0]), trimBefore: f(srcBar(58)), trimAfter: f(srcBar(65)) },
];

// Narration (ElevenLabs). Variant 1: voice "Will", original script.
// Variant 2: voice "Lulu", adds the awkward-asking / third-party / "money should
// never get between friends" lines. Variant 3 (gen 1 final): the v2 script read by
// Will, with the growth hook on the brand reveal ("a third party that grows with
// your group") and "as your friendships grow, tab grows with them" on the Grows
// peak. Starts in seconds, durations measured.
const VO_AT = (v: number) => [
  COLD_END + 0.15,
  FREEZE_END + (v === 1 ? 0.15 : 0.05),
  secs.brand[0] + (v === 1 ? 1.6 : v === 2 ? 0.55 : 0.7), // v3: "tab." lands on the lockup
  secs.textIt[0] + (v === 3 ? 0.8 : 0.7),
  secs.receipt[0] + 0.5,
  secs.drinks[0] + 0.3,
  secs.remembers[0] + 0.45,
  secs.ask[0] + 0.5,
  secs.settle[0] + 0.5,
  secs.ledger[0] + 0.8,
  secs.hood[0] + 0.7,
  secs.grows[0] + (v === 3 ? 0.15 : 0.2), // v3: clears the drop-2 riser
  secs.outro[0] + (v === 1 ? 1.7 : 1.5),
];
const VO_DUR: Record<number, number[]> = {
  1: [2.51, 7.52, 1.25, 1.57, 3.76, 3.53, 2.04, 3.16, 4.21, 3.47, 4.41, 6.4, 2.04],
  2: [1.99, 7.42, 3.47, 4.86, 3.11, 2.82, 2.32, 3.6, 4.36, 3.6, 4.6, 6.3, 3.06],
  3: [2.22, 7.58, 3.29, 3.97, 2.9, 2.82, 1.67, 2.53, 3.47, 3.19, 4.49, 6.77, 3.29],
};
const VO_DIR: Record<number, string> = { 1: 'will', 2: 'lulu', 3: 'will3' };
export const voFor = (v: number) =>
  VO_AT(v).map((at, i) => ({ file: `${VO_DIR[v] ?? 'will'}/vo${String(i + 1).padStart(2, '0')}`, at, dur: (VO_DUR[v] ?? VO_DUR[1])[i] }));
