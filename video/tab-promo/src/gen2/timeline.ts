// Gen 2 timing: one source of truth for TabTableFull (80.0 s) and
// TabTableShort (50.0 s). Everything after the first drop rides the music
// grid ("Cat Walk", 130 BPM, t0 0.1638 s, SCRIPT §5): anchors are bar
// multiples, chat events sit on beats / half beats from the nearest anchor.
// Act I has no music, so its shot lengths are free as long as they sum to
// the drop. All times are seconds; `f()` converts at the end.
import type { IMsg } from '../imessage';
import { CAST, CastId, GROUP, HEADER, HEADER_WITH_TAB, ME, n } from './cast';
import type { NumKey, ScrollKey, StackItem, TypingSpan } from './chatChaos';
import { LABEL, M1_HEADS, M1_REAL, OWES, PHOTO_ID, SETTLE_ID, SHARES, TOTAL, TagSpec, m, photo, sys } from './data';
import { tabJoinBeats } from './tabJoins';

export const FPS = 30;
export const f = (s: number) => Math.round(s * FPS);

// ── music grid ──
export const BPM = 130;
export const BEAT = 60 / BPM; // 0.4615 s
export const BAR = 4 * BEAT; // 1.8462 s
export const T0 = 0.1638; // first downbeat in cat-walk.mp3
export const srcBar = (bar: number) => T0 + bar * BAR;

export type CutId = 'full' | 'short';
export type Seg = [number, number];
/** A voice line (or a clip's native audio): `segs` are source-second ranges
 *  spliced back to back, played at `rate` (pitch kept). */
export type VoCue = { id: string; src: string; at: number; rate?: number; segs: Seg[]; vol?: number; duckAt?: number; cutAt?: number };
export type SfxCue = { at: number; src: string; vol: number; dur?: number; from?: number; rate?: number };
export type TextCue = { text: string; a: number; b: number };
export type MusicClip = { at: number; fromBar: number; toBar: number };
export type EnvKey = [number, number]; // [sec, volume]

export type ChatPlan = {
  msgs: IMsg[];
  typing: TypingSpan[];
  unread: NumKey[];
  scroll: ScrollKey[];
  portraits: { at: number; who: CastId | null }[];
  side: { text: string; from: number; to: number }[];
  dms: StackItem[];
  dmsUntil: number;
  members: { at: number; members: string[] }[];
  /** frame the backdrop switches from H02 (party) to H10 (alone) */
  act3: number;
};

export type CutPlan = {
  id: CutId;
  total: number;
  shots: Record<ShotId, [number, number]>;
  /** clip in-points (source seconds) and per-shot details */
  act1: {
    freezeAt: number; // M1 source time of the F02 freeze
    m3In: number; m4aIn: number; m4bIn: number; m2In: number; m7In: number;
    plate: number; // seconds of POV plate before the macro scroll
    scroll: { t: number; row: string; anchor: number; s: number }[]; // t: seconds from shot start
    m5: number; // seconds of M5 before the reaction cuts
    cuts: { who: 'grandpa' | 'baby' | 'captain' | 'gym'; dur: number }[];
    tags: TagSpec[];
  };
  music: MusicClip[];
  vo: VoCue[];
  sfx: SfxCue[];
  bands: TextCue[];
  subs: TextCue[];
  /** X1 restaurant bed (normal / low-passed) volume envelopes */
  amb: { x1: EnvKey[]; lp: EnvKey[] };
  chat: ChatPlan;
  end: { tagline: number; lock: number };
  button: { banner: number; h12: number };
};

export type ShotId =
  | 'open' | 'freeze' | 'drop' | 'opens' | 'receipt' | 'tail' | 'waiter' | 'erupt' | 'tap' | 'nope'
  | 'chat1' | 'alone' | 'chat2' | 'exhale' | 'grow' | 'end' | 'button';

/** Lay shots end to end from durations. */
const lay = (start: number, list: [ShotId, number][]) => {
  const out = {} as Record<ShotId, [number, number]>;
  let t = start;
  for (const [id, d] of list) { out[id] = [t, t + d]; t += d; }
  return { shots: out, end: t };
};

// VO durations (gen2/AUDIO.md), seconds
export const VO_DUR: Record<string, number> = {
  N1: 2.59, N2: 1.85, N3: 4.49,
  K1: 3.24, K2: 3.19, 'K2-tight': 2.56, B1: 0.91,
  'E1-ensemble': 2.51, E2: 2.14, E3: 2.22, E4: 1.99, E5: 1.41, E6: 1.85,
  C1: 1.41, C2: 1.31, C3: 2.59, C4: 3.0, 'C4-tight': 2.59, 'C4-radio': 3.11, 'C4-tight-radio': 2.69,
  C5: 4.78, 'C5-tight': 3.68, C6: 2.04, C7: 1.67, C8: 1.46, O1: 1.33,
};
const vo = (id: string) => `gen2/audio/vo/${id}.mp3`;
const whole = (id: string): Seg[] => [[0, VO_DUR[id]]];
/** Seconds a cue plays for. */
export const cueLen = (c: VoCue) => c.segs.reduce((a, [x, y]) => a + (y - x), 0) / (c.rate ?? 1);

// Tight edits inside pauses (word times from scribe STT of the final files)
const K1_TIGHT: Seg[] = [[0, 1.5], [1.95, 3.24]]; // "can we split this… eleven ways?"
const C3_TIGHT: Seg[] = [[0, 1.3], [1.52, 2.59]]; // "can i pay in… exposure?"
const C4_TIGHT: Seg[] = [[0, 1.34], [1.62, 2.69]]; // C4-tight-radio, both sentences
const C4_SECOND: Seg[] = [[0, 0.15], [1.62, 2.69]]; // radio squelch + "i'll just text you later"
const C5_FULL: Seg[] = [[0, 2.62], [3.05, 3.68]]; // C5-tight "…the facebook, grandpa?"
const C5_FB: Seg[] = [[0, 2.6]]; // C5-tight up to "facebook"
const E3_TIGHT: Seg[] = [[0.24, 0.7], [1.4, 1.95]]; // "ba. VENMO!"
const N3_TIGHT: Seg[] = [[0, 1.5], [2.05, 4.49]]; // "tab grows with your group, so money never gets between friends"

const M2 = 'gen2/clips/M2.mp4';
const M5 = 'gen2/clips/M5.mp4';

// ── pops & taps derived from the chat ──
const popsFor = (msgs: IMsg[], from: number, to: number, hi: number, lo: number): SfxCue[] => {
  const xs = msgs.filter((x) => x.at >= f(from) && x.at < f(to));
  return xs.map((x, i) => {
    const t = x.at / FPS;
    const vol = hi + (lo - hi) * (xs.length > 1 ? i / (xs.length - 1) : 0);
    if (x.system) return { at: t, src: 'audio/sfx/switch-tap.mp3', vol: vol * 0.45 };
    if (x.from === ME) return { at: t, src: 'audio/sfx/swoosh-quick.mp3', vol: 0.14 };
    return { at: t, src: i % 2 ? 'audio/sfx/hit-weak.mp3' : 'audio/sfx/switch-tap.mp3', vol };
  });
};
const tapsFor = (times: number[], hi = 0.4, lo = 0.2): SfxCue[] =>
  times.map((t, i) => ({ at: t, src: i % 2 ? 'audio/sfx/hit-weak.mp3' : 'audio/sfx/switch-tap.mp3', vol: hi + (lo - hi) * (i / Math.max(1, times.length - 1)) }));

const tagsAt = (times: number[], accentAt: number): TagSpec[] => [
  ...M1_HEADS.map((h, i) => ({ ...h, at: f(times[i]) })),
  { ...M1_REAL, at: f(accentAt), accent: true },
];
/** n times accelerating from a to b */
const accel = (count: number, a: number, b: number, pow = 0.75) => Array.from({ length: count }, (_, i) => a + (b - a) * Math.pow(i / (count - 1), pow));

const stormPlan = (t0: number, offs: { id: CastId; s: number }[]) => {
  const at = new Map(offs.map((o) => [o.id, t0 + o.s]));
  return OWES.map((o) => ({
    name: o.name,
    cents: o.cents,
    at: f(at.get(o.id)!),
    owner: o.id === 'grandpa' ? `${CAST.grandpa.label}'s phone (text size: max)` : `${CAST[o.id].label}'s phone`,
    bodySize: o.id === 'grandpa' ? 64 : undefined,
  }));
};

// ══════════════════════════════ FULL (80.0 s) ══════════════════════════════
const fullPlan = (): CutPlan => {
  const DROP1 = 26.6;
  const A_END = DROP1 + 8 * BAR; // 41.369 hard stop
  const B = 45.97;
  const C = B + 12 * BAR; // 68.124
  const DROP2 = C + BAR; // 69.970
  const END_C = C + 5 * BAR; // 77.355
  const act1 = lay(0, [['open', 2.8], ['freeze', 2.0], ['drop', 2.8], ['opens', 1.8], ['receipt', 3.8], ['tail', 2.5], ['waiter', 3.5], ['erupt', 3.8], ['tap', 0.8], ['nope', 2.8]]);
  if (Math.abs(act1.end - DROP1) > 1e-6) throw new Error(`FULL act I ends at ${act1.end}, not ${DROP1}`);
  const shots: Record<ShotId, [number, number]> = {
    ...act1.shots,
    chat1: [DROP1, A_END], alone: [A_END, B - 1.4], chat2: [B - 1.4, 67.57],
    exhale: [67.57, DROP2], grow: [DROP2, 74.37], end: [74.37, END_C], button: [END_C, 80.0],
  };
  const S = shots;
  const d = (k: number) => DROP1 + k * BEAT;
  const bb = (k: number) => B + k * BEAT;

  // F11 the flood (re-timed so the voiced jokes never overlap; see report)
  const flood: IMsg[] = [
    photo(PHOTO_ID, d(0), ME),
    m('f02', d(1), ME, "it's $108 each 🙏"),
    m('f03', d(2), n('gainz'), 'thanks king 🙏'),
    m('f04', d(3), n('wizard'), 'how much do i owe again?'),
    m('f05', d(6), n('captain'), 'can i pay in doubloons'),
    m('f06', d(8.5), n('farmer'), 'can i pay in rice'),
    m('f07', d(11), n('fluencer'), 'can i pay in exposure'),
    m('f08', d(15.5), ME, 'no.'),
    m('f09', d(16.5), n('space'), "signal's bad up here"),
    m('f10', d(19), n('space'), "i'll just text you later"),
    m('f11', d(21), ME, 'you are texting me'),
    m('f12', d(22), n('gainz'), "gimme 3 secs i'll venmo u"),
    sys('f13', d(23), 'Mon 9:41 AM'),
    m('f14', d(24), n('gainz'), "bro venmo's being weird"),
    m('f15', d(25), ME, 'can you guys send the money'),
    sys('f16', d(25.5), `${n('captain')} left the conversation.`),
    m('f17', d(26), n('grandpa'), 'HOW DO I SEND MONEY ON THE FACEBOOK\n- GRANDPA'),
    sys('f18', d(26.5), `You added ${n('captain')} to the conversation.`),
    m('f19', d(27), n('ceo'), "i'll get you back in like a week 🤝"),
    m('f20', d(27.5), n('holmes'), 'who got the extra dumplings'),
    m('f21', d(28), n('holmes'), 'one of you is lying'),
    m('f22', d(28.5), n('baby'), "i'm literally a baby"),
    m('f23', d(29), n('wizard'), 'wait how much do i owe again'),
  ];

  // F13–F20a Tab joins → 👍 storm
  const T0s = bb(33); // 61.2
  const storm = [
    { id: 'baby' as CastId, s: 0 },
    { id: 'wizard' as CastId, s: 1.0 }, { id: 'farmer' as CastId, s: 1.3 }, { id: 'fluencer' as CastId, s: 1.55 }, { id: 'gainz' as CastId, s: 1.75 },
    { id: 'space' as CastId, s: 1.92 }, { id: 'holmes' as CastId, s: 2.06 }, { id: 'ceo' as CastId, s: 2.18 },
    { id: 'grandpa' as CastId, s: 3.7 }, { id: 'captain' as CastId, s: 4.7 },
  ];
  const join = tabJoinBeats({
    me: ME, label: LABEL, total: TOTAL, shares: SHARES, payers: stormPlan(T0s, storm),
    at: { added: f(44.9), intro: f(B), photo: f(bb(6.5)), like: f(bb(7.5)), proposal: f(bb(8.5)), settleUp: f(bb(13)), stamp: f(bb(14.5)), settle: f(bb(15)), square: f(bb(44.5)) },
    stamp: 'Today 10:52 PM',
    ask: { from: n('wizard'), text: 'how much do i owe again?', at: f(bb(23)), replyAt: f(bb(25.5)) },
    aside: { from: n('space'), text: 'anyone else think the waiter looked exactly like kien', at: f(bb(28.5)) },
    typedYes: { from: n('grandpa'), text: 'YES\n- GRANDPA', at: f(T0s + 2.4), replyAt: f(T0s + 3.1) },
    photoId: 'receipt-photo-2', settleId: SETTLE_ID,
  });
  const msgs = [...flood, ...join.msgs];
  const at = (id: string) => msgs.find((x) => x.id === id)!.at / FPS;

  const voCues: VoCue[] = [
    { id: 'K1', src: vo('K1'), at: S.tail[0] - 0.15, rate: 1.12, segs: K1_TIGHT },
    { id: 'W1', src: M2, at: S.waiter[0], segs: [[0.15, 3.62]], vol: 1.16 }, // M2 native (−17.3 → −16 LUFS)
    { id: 'M5', src: M5, at: S.erupt[0], segs: [[0, 3.22]], vol: 1.45 }, // M5 native crowd (−19.2 → −16 LUFS)
    { id: 'E2', src: vo('E2'), at: S.erupt[0] + 1.4, rate: 1.15, segs: whole('E2'), vol: 0.8, duckAt: S.erupt[0] + 2.0, cutAt: S.tap[0] + 0.3 },
    { id: 'E4', src: vo('E4'), at: S.erupt[0] + 2.0, rate: 1.15, segs: whole('E4'), vol: 0.8, duckAt: S.erupt[0] + 2.6, cutAt: S.tap[0] + 0.3 },
    { id: 'E5', src: vo('E5'), at: S.erupt[0] + 2.6, rate: 1.15, segs: whole('E5'), vol: 0.8, duckAt: S.erupt[0] + 3.2, cutAt: S.tap[0] + 0.3 },
    { id: 'E3', src: vo('E3'), at: S.erupt[0] + 3.2, rate: 1.15, segs: E3_TIGHT, vol: 0.9 },
    { id: 'N1', src: vo('N1'), at: S.nope[0] + 0.2, segs: whole('N1') },
    { id: 'C8', src: vo('C8'), at: at('f04') - 0.07, rate: 1.15, segs: whole('C8') },
    { id: 'C1', src: vo('C1'), at: at('f05') - 0.15, rate: 1.15, segs: whole('C1') },
    { id: 'C2', src: vo('C2'), at: at('f06') - 0.04, rate: 1.15, segs: whole('C2') },
    { id: 'C3', src: vo('C3'), at: at('f07') - 0.03, rate: 1.15, segs: C3_TIGHT },
    { id: 'C4', src: vo('C4-tight-radio'), at: at('f09') - 0.08, rate: 1.15, segs: C4_TIGHT },
    { id: 'C5', src: vo('C5-tight'), at: at('f17') - 0.07, rate: 1.15, segs: C5_FULL },
    { id: 'K2', src: vo('K2-tight'), at: S.alone[0] + 0.68, rate: 1.1, segs: whole('K2-tight') },
    { id: 'C8b', src: vo('C8'), at: at('ask') - 0.07, rate: 1.15, segs: whole('C8') },
    { id: 'N2', src: vo('N2'), at: S.exhale[0] + 0.28, segs: whole('N2') },
    { id: 'N3', src: vo('N3'), at: S.grow[0] + 0.13, segs: N3_TIGHT },
    { id: 'B1', src: vo('B1'), at: 79.05, segs: whole('B1') },
  ];

  const tagTimes = accel(10, S.freeze[0] + 0.15, S.freeze[0] + 0.95);
  const stormTimes = join.dms.map((x) => x.at / FPS);
  const sfx: SfxCue[] = [
    { at: 0.2, src: 'gen2/audio/sfx/X2.mp3', vol: 0.55 },
    { at: S.freeze[0], src: 'audio/sfx/click-camera.mp3', vol: 1.0 },
    ...tagTimes.map((t, i) => ({ at: t, src: i % 2 ? 'audio/sfx/clock-tick-single.mp3' : 'audio/sfx/switch-tap.mp3', vol: 0.4 - 0.2 * (i / 9) })),
    { at: S.freeze[0] + 1.3, src: 'audio/sfx/switch-tap.mp3', vol: 0.4 },
    { at: S.drop[1] - 0.6, src: 'audio/sfx/clock-tick-single.mp3', vol: 0.3 },
    { at: S.drop[1] - 0.1, src: 'audio/sfx/clock-tick-single.mp3', vol: 0.28 },
    { at: S.opens[0] + 0.25, src: 'gen2/audio/sfx/X3.mp3', vol: 0.4, from: 0.5, dur: 0.4 },
    { at: S.receipt[0] + 0.6, src: 'gen2/audio/sfx/X3.mp3', vol: 0.75, dur: 2.0 },
    { at: S.receipt[0] + 2.6, src: 'audio/sfx/bass-hit-short.mp3', vol: 0.35 }, // slam 1: TOTAL
    { at: S.tap[0] + 0.35, src: 'gen2/audio/sfx/X4.mp3', vol: 0.8 },
    { at: S.nope[0], src: 'audio/sfx/click-camera.mp3', vol: 1.0 }, // slam 2: freeze, room dies
    ...popsFor(msgs, DROP1, A_END, 0.3, 0.16),
    { at: S.alone[0], src: 'gen2/audio/sfx/X8.mp3', vol: 0.7, dur: S.alone[1] - S.alone[0] },
    { at: S.alone[0] + 0.18, src: 'audio/sfx/phone-buzz.mp3', vol: 0.16 },
    { at: S.alone[0] + 0.58, src: 'audio/sfx/phone-buzz.mp3', vol: 0.16 },
    ...popsFor(msgs, A_END, 67.57, 0.24, 0.2).filter((p) => !stormTimes.some((t) => Math.abs(t - p.at) < 0.05)),
    { at: bb(30), src: 'gen2/audio/sfx/X6.mp3', vol: 0.4 },
    ...tapsFor(stormTimes),
    { at: stormTimes[0] + 0.05, src: 'audio/sfx/phone-buzz.mp3', vol: 0.1 },
    { at: S.end[0] + 0.03, src: 'audio/sfx/impact-cine-big.mp3', vol: 0.4 }, // slam 3: tagline
    { at: 75.8, src: 'audio/sfx/sparkle-touch.mp3', vol: 0.5 },
    { at: S.button[0] + 0.05, src: 'audio/sfx/phone-buzz.mp3', vol: 0.18 },
  ];

  return {
    id: 'full', total: 80.0, shots,
    act1: {
      freezeAt: 2.8, m3In: 0.6, m4aIn: 0.1, m4bIn: 1.5, m2In: 0.15, m7In: 0.6,
      plate: 0.6,
      scroll: [
        { t: 0.6, row: 'name', anchor: 0.3, s: 1 },
        { t: 1.15, row: 'item-1', anchor: 0.42, s: 1 },
        { t: 2.35, row: 'subtotal', anchor: 0.45, s: 1 },
        { t: 2.6, row: 'total', anchor: 0.5, s: 1 },
        { t: 2.75, row: 'total', anchor: 0.42, s: 1.65 },
        { t: 3.8, row: 'total', anchor: 0.41, s: 1.68 },
      ],
      m5: 1.4,
      cuts: [{ who: 'grandpa', dur: 0.6 }, { who: 'captain', dur: 0.6 }, { who: 'gym', dur: 0.6 }, { who: 'baby', dur: 0.6 }],
      tags: tagsAt(tagTimes, S.freeze[0] + 1.3),
    },
    music: [
      { at: DROP1, fromBar: 16, toBar: 24 },
      { at: B, fromBar: 32, toBar: 44 },
      { at: C, fromBar: 47, toBar: 52 },
    ],
    vo: voCues,
    sfx,
    bands: [
      { text: 'friday night. dinner with the boys.', a: 0.3, b: 2.7 },
      { text: 'kien would not see this money again.', a: S.nope[0] + 0.25, b: S.nope[1] - 0.1 },
      { text: 'wow. way too much going on.', a: S.alone[0] + 1.23, b: S.alone[1] - 0.12 },
      { text: 'kien saw this money again.', a: S.exhale[0] + 0.28, b: S.exhale[1] - 0.22 },
      { text: 'tab grows with your group.', a: S.grow[0] + 0.13, b: S.grow[0] + 1.73 },
      { text: 'so money never gets between friends.', a: S.grow[0] + 1.73, b: S.grow[1] - 0.07 },
    ],
    subs: [
      { text: 'can we split this… eleven ways?', a: S.tail[0] + 0.05, b: S.tail[1] - 0.15 },
      { text: "sorry. group's too big. one card.", a: S.waiter[0] + 0.14, b: S.waiter[1] - 0.05 },
      { text: "just pay! i'll get you back!", a: S.erupt[0], b: S.erupt[0] + 1.4 },
      { text: "I'LL WRITE YOU A CHECK!", a: S.erupt[0] + 1.4, b: S.erupt[0] + 2.0 },
      { text: "ye'll get it back, matey!", a: S.erupt[0] + 2.0, b: S.erupt[0] + 2.6 },
      { text: 'three seconds, bro!', a: S.erupt[0] + 2.6, b: S.erupt[0] + 3.2 },
      { text: 'ba-ba-ba… venmo!', a: S.erupt[0] + 3.2, b: S.erupt[1] },
    ],
    amb: {
      x1: [[0, 0.9], [S.freeze[0], 0.9], [S.freeze[0], 0], [S.drop[0], 0], [S.drop[0], 0.9], [S.drop[0] + 1.0, 0.5], [S.drop[0] + 1.8, 0], [S.tail[0], 0], [S.tail[0], 0.55], [S.erupt[0], 0.55], [S.erupt[0], 0.7], [S.tap[0], 0.55], [S.nope[0], 0.55], [S.nope[0], 0]],
      lp: [[S.freeze[0], 0], [S.freeze[0], 0.75], [S.drop[0], 0.75], [S.drop[0], 0], [S.drop[0] + 1.0, 0.5], [S.drop[0] + 1.8, 0.35], [S.drop[1] - 0.2, 0.04], [S.receipt[0], 0]],
    },
    chat: {
      msgs,
      typing: [
        { from: n('wizard'), at: f(d(2.3)), until: f(d(3)) },
        { from: n('space'), at: f(d(15.7)), until: f(d(16.5)) },
        { from: n('captain'), at: f(d(29.5)), until: f(44.95) },
        { from: n('grandpa'), at: f(d(29.75)), until: f(45.15) },
        { from: n('gainz'), at: f(d(30)), until: f(45.35) },
        { from: n('ceo'), at: f(d(30.25)), until: f(45.55) },
        { from: 'Tab', at: f(45.55), until: f(B) },
      ],
      unread: [{ at: f(DROP1), v: 3 }, { at: f(d(29)), v: 12 }, { at: f(d(29.5)), v: 12 }, { at: f(A_END - 0.2), v: 140 }, { at: f(B - 0.1), v: 140 }, { at: f(B + 0.35), v: 0 }],
      scroll: [
        { at: f(bb(15)), anchor: SETTLE_ID, align: 'top', pad: 76, dur: 0 },
        { at: f(bb(15)) + 14, y: 0, dur: 30 },
        { at: f(T0s) - 10, anchor: SETTLE_ID, align: 'top', pad: 76, dur: 10 },
        { at: f(T0s + 2.4) - 2, y: 0, dur: 8 },
        { at: f(T0s + 3.7) - 10, anchor: SETTLE_ID, align: 'top', pad: 76, dur: 9 },
        { at: f(bb(44.5)) - 2, y: 0, dur: 10 },
      ],
      portraits: [
        { at: f(d(3)), who: 'wizard' }, { at: f(d(6)), who: 'captain' }, { at: f(d(8.5)), who: 'farmer' }, { at: f(d(11)), who: 'fluencer' },
        { at: f(d(15.5)), who: null }, { at: f(d(16.5)), who: 'space' }, { at: f(d(22)), who: 'gainz' }, { at: f(d(23)), who: null },
        { at: f(d(26)), who: 'grandpa' }, { at: f(d(28.5)), who: 'baby' }, { at: f(d(29)), who: 'wizard' }, { at: f(d(29.5)), who: 'captain' },
        { at: f(d(29.75)), who: 'grandpa' }, { at: f(d(30)), who: 'gainz' }, { at: f(d(30.25)), who: 'ceo' }, { at: f(d(31)), who: null },
        { at: f(bb(22.5)), who: 'wizard' }, { at: f(bb(28)), who: 'waiter' }, { at: f(T0s), who: null },
      ],
      side: [
        { text: '3 days later', from: f(d(23)), to: f(d(26)) },
        { text: 'meet tab. it lives in your group chat.', from: f(B), to: f(bb(6.5)) },
        { text: 'drop the receipt. tab does the math.', from: f(bb(6.5)), to: f(bb(14.75)) },
        { text: "tab asks for the money, so kien doesn't have to.", from: f(bb(14.75)), to: f(bb(22.5)) },
        { text: 'ask it anything.', from: f(bb(22.5)), to: f(bb(28)) },
        { text: 'not about money? tab never sees it.', from: f(bb(29.5)), to: f(T0s) },
        { text: 'one 👍 each. tab confirms in a dm.', from: f(T0s + 1.0), to: f(bb(44.5)) },
      ],
      dms: join.dms,
      dmsUntil: f(67.57),
      members: [{ at: 0, members: HEADER }, { at: f(44.9), members: HEADER_WITH_TAB }],
      act3: f(A_END),
    },
    end: { tagline: S.end[0] + 0.03, lock: 75.8 },
    button: { banner: S.button[0] + 0.05, h12: 78.9 },
  };
};

// ══════════════════════════════ SHORT (50.0 s) ══════════════════════════════
const shortPlan = (): CutPlan => {
  const DROP1 = 20.8;
  const A_END = DROP1 + 5 * BAR; // 30.031 hard stop
  const B = 33.431;
  const C = B + 4 * BAR; // 40.816
  const DROP2 = C + BAR; // 42.662
  const END_C = C + 4 * BAR; // 48.201
  const act1 = lay(0, [['open', 2.0], ['freeze', 1.4], ['drop', 2.2], ['opens', 1.2], ['receipt', 2.8], ['tail', 2.3], ['waiter', 3.1], ['erupt', 2.6], ['tap', 0.5], ['nope', 2.7]]);
  if (Math.abs(act1.end - DROP1) > 1e-6) throw new Error(`SHORT act I ends at ${act1.end}, not ${DROP1}`);
  const shots: Record<ShotId, [number, number]> = {
    ...act1.shots,
    chat1: [DROP1, A_END], alone: [A_END, B - 1.0], chat2: [B - 1.0, 40.66],
    exhale: [40.66, DROP2], grow: [DROP2, 45.06], end: [45.06, END_C], button: [END_C, 50.0],
  };
  const S = shots;
  const d = (k: number) => DROP1 + k * BEAT;
  const bb = (k: number) => B + k * BEAT;

  const flood: IMsg[] = [
    photo(PHOTO_ID, d(0), ME),
    m('s02', d(1), n('gainz'), 'thanks king 🙏'),
    m('s03', d(1.5), n('captain'), 'can i pay in doubloons'),
    m('s04', d(4.25), n('farmer'), 'can i pay in rice'),
    m('s05', d(6.75), n('fluencer'), 'can i pay in exposure'),
    m('s06', d(11), ME, 'no.'),
    m('s07', d(11.5), n('space'), "i'll just text you later"),
    m('s08', d(13.5), ME, 'you are texting me'),
    m('s09', d(14), n('gainz'), "gimme 3 secs i'll venmo u"),
    sys('s10', d(14.5), 'Mon 9:41 AM'),
    m('s11', d(14.75), n('gainz'), "bro venmo's being weird"),
    m('s12', d(15.125), ME, 'can you guys send the money'),
    m('s13', d(15.5), n('grandpa'), 'HOW DO I SEND MONEY ON THE FACEBOOK\n- GRANDPA'),
    sys('s14', d(16), `${n('captain')} left the conversation.`),
    sys('s15', d(16.5), `You added ${n('captain')} to the conversation.`),
  ];
  const T0s = bb(9.5); // 37.815
  const storm = [
    { id: 'baby' as CastId, s: 0 },
    { id: 'wizard' as CastId, s: 0.9 }, { id: 'farmer' as CastId, s: 1.08 }, { id: 'fluencer' as CastId, s: 1.24 }, { id: 'gainz' as CastId, s: 1.37 },
    { id: 'space' as CastId, s: 1.48 }, { id: 'holmes' as CastId, s: 1.57 }, { id: 'ceo' as CastId, s: 1.64 }, { id: 'captain' as CastId, s: 1.7 },
    { id: 'grandpa' as CastId, s: 1.9 },
  ];
  const join = tabJoinBeats({
    me: ME, label: LABEL, total: TOTAL, shares: SHARES, payers: stormPlan(T0s, storm),
    at: { added: f(B - 0.85), intro: f(B), photo: f(bb(2.5)), like: f(bb(3.25)), proposal: f(bb(4)), settleUp: f(bb(6.5)), settle: f(bb(7.5)) },
    photoId: 'receipt-photo-2', settleId: SETTLE_ID,
  });
  const msgs = [...flood, ...join.msgs];
  const at = (id: string) => msgs.find((x) => x.id === id)!.at / FPS;

  const voCues: VoCue[] = [
    { id: 'K1', src: vo('K1'), at: S.tail[0] - 0.2, rate: 1.15, segs: K1_TIGHT },
    { id: 'W1', src: M2, at: S.waiter[0], segs: [[0.2, 3.45]], vol: 1.16 },
    { id: 'M5', src: M5, at: S.erupt[0], segs: [[0, 3.22]], vol: 1.45, cutAt: S.nope[0] },
    { id: 'E2', src: vo('E2'), at: S.erupt[0] + 1.4, rate: 1.15, segs: whole('E2'), vol: 0.8, duckAt: S.erupt[0] + 2.0, cutAt: S.nope[0] },
    { id: 'E3', src: vo('E3'), at: S.erupt[0] + 2.0, rate: 1.15, segs: E3_TIGHT, vol: 0.9 },
    { id: 'N1', src: vo('N1'), at: S.nope[0] + 0.1, segs: whole('N1') },
    { id: 'C1', src: vo('C1'), at: at('s03') - 0.06, rate: 1.15, segs: whole('C1') },
    { id: 'C2', src: vo('C2'), at: at('s04') - 0.07, rate: 1.15, segs: whole('C2') },
    { id: 'C3', src: vo('C3'), at: at('s05') - 0.055, rate: 1.15, segs: C3_TIGHT },
    { id: 'C4', src: vo('C4-tight-radio'), at: at('s07') - 0.16, rate: 1.15, segs: C4_SECOND },
    { id: 'C5', src: vo('C5-tight'), at: at('s13') - 0.21, rate: 1.15, segs: C5_FB },
    { id: 'K2', src: vo('K2-tight'), at: S.alone[0] + 0.12, rate: 1.15, segs: whole('K2-tight') },
    { id: 'N2', src: vo('N2'), at: S.exhale[0] + 0.09, segs: whole('N2') },
    { id: 'B1', src: vo('B1'), at: 49.05, segs: whole('B1') },
  ];

  const tagTimes = accel(10, S.freeze[0] + 0.03, S.freeze[0] + 0.52);
  const stormTimes = join.dms.map((x) => x.at / FPS);
  const sfx: SfxCue[] = [
    { at: 0.15, src: 'gen2/audio/sfx/X2.mp3', vol: 0.55 },
    { at: S.freeze[0], src: 'audio/sfx/click-camera.mp3', vol: 1.0 },
    ...tagTimes.map((t, i) => ({ at: t, src: i % 2 ? 'audio/sfx/clock-tick-single.mp3' : 'audio/sfx/switch-tap.mp3', vol: 0.4 - 0.2 * (i / 9) })),
    { at: S.freeze[0] + 0.55, src: 'audio/sfx/switch-tap.mp3', vol: 0.4 },
    { at: S.drop[1] - 0.6, src: 'audio/sfx/clock-tick-single.mp3', vol: 0.3 },
    { at: S.drop[1] - 0.1, src: 'audio/sfx/clock-tick-single.mp3', vol: 0.28 },
    { at: S.opens[0] + 0.1, src: 'gen2/audio/sfx/X3.mp3', vol: 0.4, from: 0.5, dur: 0.4 },
    { at: S.receipt[0] + 0.5, src: 'gen2/audio/sfx/X3.mp3', vol: 0.75, dur: 1.3 },
    { at: S.receipt[0] + 1.8, src: 'audio/sfx/bass-hit-short.mp3', vol: 0.35 },
    { at: S.tap[0] + 0.35, src: 'gen2/audio/sfx/X4.mp3', vol: 0.8 },
    { at: S.nope[0], src: 'audio/sfx/click-camera.mp3', vol: 1.0 },
    ...popsFor(msgs, DROP1, A_END, 0.3, 0.16),
    { at: S.alone[0], src: 'gen2/audio/sfx/X8.mp3', vol: 0.7, dur: S.alone[1] - S.alone[0] },
    { at: S.alone[0] + 0.03, src: 'audio/sfx/phone-buzz.mp3', vol: 0.16 },
    ...popsFor(msgs, A_END, 40.66, 0.24, 0.2).filter((p) => !stormTimes.some((t) => Math.abs(t - p.at) < 0.05)),
    ...tapsFor(stormTimes),
    { at: stormTimes[0] + 0.05, src: 'audio/sfx/phone-buzz.mp3', vol: 0.1 },
    { at: S.end[0] + 0.04, src: 'audio/sfx/impact-cine-big.mp3', vol: 0.4 },
    { at: 46.3, src: 'audio/sfx/sparkle-touch.mp3', vol: 0.5 },
    { at: S.button[0] + 0.05, src: 'audio/sfx/phone-buzz.mp3', vol: 0.18 },
  ];

  return {
    id: 'short', total: 50.0, shots,
    act1: {
      freezeAt: 2.0, m3In: 1.0, m4aIn: 0.4, m4bIn: 1.7, m2In: 0.2, m7In: 1.0,
      plate: 0.5,
      scroll: [
        { t: 0.5, row: 'name', anchor: 0.3, s: 1 },
        { t: 0.95, row: 'item-1', anchor: 0.42, s: 1 },
        { t: 1.6, row: 'subtotal', anchor: 0.45, s: 1 },
        { t: 1.8, row: 'total', anchor: 0.5, s: 1 },
        { t: 1.95, row: 'total', anchor: 0.42, s: 1.65 },
        { t: 2.8, row: 'total', anchor: 0.41, s: 1.68 },
      ],
      m5: 1.4,
      cuts: [{ who: 'grandpa', dur: 0.6 }, { who: 'baby', dur: 0.6 }],
      tags: tagsAt(tagTimes, S.freeze[0] + 0.55),
    },
    music: [
      { at: DROP1, fromBar: 16, toBar: 21 },
      { at: B, fromBar: 32, toBar: 36 },
      { at: C, fromBar: 47, toBar: 51 },
    ],
    vo: voCues,
    sfx,
    bands: [
      { text: 'friday night. dinner with the boys.', a: 0.2, b: 2.6 },
      { text: 'kien would not see this money again.', a: S.nope[0] + 0.12, b: S.nope[1] - 0.05 },
      { text: 'wow. way too much going on.', a: S.alone[0] + 0.62, b: S.alone[1] - 0.03 },
      { text: 'kien saw this money again.', a: S.exhale[0] + 0.09, b: S.exhale[1] - 0.06 },
      { text: 'tab grows with your group.', a: S.grow[0] + 0.09, b: S.grow[1] - 0.06 },
    ],
    subs: [
      { text: 'can we split this… eleven ways?', a: S.tail[0] + 0.05, b: S.tail[1] - 0.05 },
      { text: "sorry. group's too big. one card.", a: S.waiter[0] + 0.09, b: S.waiter[1] },
      { text: "just pay! i'll get you back!", a: S.erupt[0], b: S.erupt[0] + 1.4 },
      { text: "I'LL WRITE YOU A CHECK!", a: S.erupt[0] + 1.4, b: S.erupt[0] + 2.0 },
      { text: 'ba-ba-ba… venmo!', a: S.erupt[0] + 2.0, b: S.erupt[1] },
    ],
    amb: {
      x1: [[0, 0.9], [S.freeze[0], 0.9], [S.freeze[0], 0], [S.drop[0], 0], [S.drop[0], 0.9], [S.drop[0] + 0.8, 0.5], [S.drop[0] + 1.4, 0], [S.tail[0], 0], [S.tail[0], 0.55], [S.erupt[0], 0.55], [S.erupt[0], 0.7], [S.tap[0], 0.55], [S.nope[0], 0.55], [S.nope[0], 0]],
      lp: [[S.freeze[0], 0], [S.freeze[0], 0.75], [S.drop[0], 0.75], [S.drop[0], 0], [S.drop[0] + 0.8, 0.5], [S.drop[0] + 1.4, 0.35], [S.drop[1] - 0.2, 0.04], [S.receipt[0], 0]],
    },
    chat: {
      msgs,
      typing: [
        { from: n('captain'), at: f(d(17)), until: f(B - 0.73) },
        { from: n('grandpa'), at: f(d(17.25)), until: f(B - 0.58) },
        { from: n('gainz'), at: f(d(17.5)), until: f(B - 0.43) },
        { from: n('ceo'), at: f(d(17.75)), until: f(B - 0.28) },
        { from: 'Tab', at: f(B - 0.28), until: f(B) },
      ],
      unread: [{ at: f(DROP1), v: 3 }, { at: f(d(16.5)), v: 12 }, { at: f(d(17.25)), v: 12 }, { at: f(A_END - 0.15), v: 140 }, { at: f(B - 0.1), v: 140 }, { at: f(B + 0.35), v: 0 }],
      scroll: [
        { at: f(bb(7.5)), anchor: SETTLE_ID, align: 'top', pad: 76, dur: 0 },
        { at: f(bb(7.5)) + 4, y: 0, dur: 14 },
        { at: f(T0s) - 7, anchor: SETTLE_ID, align: 'top', pad: 76, dur: 6 },
      ],
      portraits: [
        { at: f(d(1.5)), who: 'captain' }, { at: f(d(4.25)), who: 'farmer' }, { at: f(d(6.75)), who: 'fluencer' }, { at: f(d(11)), who: null },
        { at: f(d(11.5)), who: 'space' }, { at: f(d(14)), who: 'gainz' }, { at: f(d(14.5)), who: null }, { at: f(d(15.5)), who: 'grandpa' },
        { at: f(d(17.5)), who: 'gainz' }, { at: f(d(17.75)), who: 'ceo' }, { at: f(d(18.25)), who: 'captain' }, { at: f(d(19)), who: null },
      ],
      side: [
        { text: '3 days later', from: f(d(14.5)), to: f(d(16.5)) },
        { text: 'drop the receipt. tab does the math.', from: f(B), to: f(bb(6.5)) },
        { text: 'one 👍 each. tab confirms in a dm.', from: f(bb(6.5)), to: f(40.66) },
      ],
      dms: join.dms,
      dmsUntil: f(40.66),
      members: [{ at: 0, members: HEADER }, { at: f(B - 0.85), members: HEADER_WITH_TAB }],
      act3: f(A_END),
    },
    end: { tagline: S.end[0] + 0.04, lock: 46.3 },
    button: { banner: S.button[0] + 0.05, h12: 49.3 },
  };
};

export const CUTS: Record<CutId, CutPlan> = { full: fullPlan(), short: shortPlan() };
export { GROUP };
