import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Backdrop } from './components';
import { Brand, Cold, Freeze, Mess } from './scenes1';
import { Drinks, Receipt, Remembers, TextIt } from './scenes2';
import { Ask, Hood, Ledger, Settle } from './scenes3';
import { EndCard, Grows, Outro, Payoff } from './scenes4';
import { useFonts } from './fonts';
import { Audit } from './audit';
import { Grain } from './grain';
import { beats, f, MUSIC, SHOTS, voFor } from './timeline';

const S = SHOTS;
const OUT = 1; // AAC priming ≈1.28f: pull every SFX one frame early (rule S5)

// SFX table: every `from` is relative to a shot (rule S3), peaks pinned to the action.
type Sfx = { from: number; src: string; volume: number; dur?: number; note: string };
const SFX: Sfx[] = [
  { from: S.freeze.from, src: 'vinyl-scratch-small', volume: 0.45, note: 'freeze frame' },
  { from: S.freeze.from + 6, src: 'marker-pen-line', volume: 0.5, dur: 14, note: 'circle the tacos' },
  { from: S.mess.from + 2, src: 'switch-tap', volume: 0.3, note: 'bar 1: two friends' },
  { from: S.mess.from + 58, src: 'switch-tap', volume: 0.3, note: 'bar 2: four' },
  { from: S.mess.from + 116, src: 'switch-tap', volume: 0.32, note: 'bar 3: eight' },
  { from: S.mess.from + 174, src: 'switch-tap', volume: 0.34, note: 'bar 4: twelve' },
  { from: S.brand.from - 31, src: 'riser-cine', volume: 0.5, dur: 40, note: 'swell into drop 1' },
  { from: S.brand.from - 65, src: 'impact-cine-big', volume: 0.6, dur: 160, note: 'DROP 1: brand (slam 1 of 2)' },
  { from: S.brand.from + 70 - 44, src: 'sparkle', volume: 1.0, note: 'sheen on the mark (file peaks at +44f)' },
  { from: S.textIt.from + 12, src: 'switch-tap', volume: 0.3, note: 'Sam message lands' },
  { from: S.textIt.from + 30, src: 'switch-tap', volume: 0.26, note: 'Tab 👍 tapback' },
  { from: S.textIt.from + 40, src: 'swoosh-quick', volume: 0.25, note: 'Tab reply' },
  { from: S.textIt.from + 62, src: 'glass-plate-slide', volume: 0.3, dur: 30, note: 'share chips embed' },
  { from: S.receipt.from - 1, src: 'click-camera', volume: 1.4, note: 'receipt snapped (flash peaks at +3)' },
  ...[0, 1, 2, 3, 4].map((i) => ({ from: S.receipt.from + 46 + i * 9, src: i % 2 ? 'hit-weak' : 'switch-tap', volume: i % 2 ? 0.2 - i * 0.015 : 0.3 - i * 0.03, note: `item ${i + 1} lands` })),
  { from: S.receipt.from + 118, src: 'switch-tap', volume: 0.26, note: "Tab: what'd you tip?" },
  { from: S.receipt.from + 140, src: 'switch-tap', volume: 0.24, note: 'Priya: 5 bucks' },
  { from: S.receipt.from + 172, src: 'hit-weak', volume: 0.35, note: 'total $47.07' },
  { from: S.drinks.from + 8, src: 'keyboard', volume: 0.28, dur: 38, note: 'Priya types' },
  { from: S.drinks.from + 78, src: 'whoosh-fast', volume: 0.35, note: 'drinks fly to Alex' },
  { from: S.drinks.from + 104, src: 'hit-weak', volume: 0.35, note: 'drinks land' },
  { from: S.drinks.from + 128, src: 'switch-tap', volume: 0.26, note: 'Tab: fixed it' },
  { from: S.remembers.from, src: 'glass-plate-slide', volume: 0.3, dur: 30, note: 'glass card' },
  { from: S.remembers.from + 34, src: 'sparkle-touch', volume: 0.6, note: 'underline' },
  { from: S.ask.from + 8, src: 'swoosh-quick', volume: 0.22, note: 'question' },
  ...[0, 1, 2].map((i) => ({ from: S.ask.from + 59 + i * 12, src: 'switch-tap', volume: 0.28 - i * 0.04, note: `check ${i + 1}` })),
  { from: S.ask.from + 116, src: 'sparkle-touch', volume: 0.6, note: 'all checked' },
  { from: S.settle.from, src: 'glass-plate-slide', volume: 0.28, dur: 30, note: 'settle request' },
  ...[0, 1, 2].map((i) => ({ from: S.settle.from + 55 + i * 14, src: 'switch-tap', volume: 0.36 - i * 0.04, note: `👍 ${i + 1}` })),
  { from: S.settle.from + 112, src: 'switch-tap', volume: 0.3, note: 'payment DM lands' },
  { from: S.ledger.from + 18, src: 'air-woosh-quick', volume: 0.3, note: 'crane rises' },
  { from: S.grows.from + 60, src: 'hit-weak', volume: 0.3, note: '66 → 0 awkward texts' },
  { from: S.outro.from - 31, src: 'riser-cine', volume: 0.5, dur: 40, note: 'swell into drop 2' },
  { from: S.outro.from - 28, src: 'impact-epic-trailer', volume: 0.55, note: 'DROP 2: outro (slam 2 of 2, film peak)' },
  { from: S.outro.from + 6 - 29, src: 'shimmer-sparkle-sweep', volume: 0.28, dur: 70, note: 'light sweep (peaks at +29f)' },
  { from: S.outro.from + 50 - 44, src: 'sparkle', volume: 1.0, note: 'wordmark sparkle (peaks at +44f)' },
  { from: S.payoff.from, src: 'bass-hit-short', volume: 0.3, note: 'music stops: the button' },
  { from: S.payoff.from + 18, src: 'phone-buzz', volume: 0.16, note: 'his phone buzzes' },
  { from: S.payoff.from + 30, src: 'sparkle-touch', volume: 0.6, note: 'banner lands' },
  { from: S.endcard.from + 4 - 44, src: 'sparkle', volume: 1.0, note: 'end card (peaks at +44f)' },
];

// v3 (gen 1 final): the text ledger ticks in on the beat instead of the crane over the
// screenshot, and each beat of the Grows peak lands a soft tap as a batch of friends joins.
const SFX_V3: Sfx[] = [
  ...[0, 1, 2, 3].map((i) => ({ from: S.ledger.from + beats(2 + i), src: 'switch-tap', volume: 0.28 - i * 0.02, note: `balance ${i + 1} ticks in` })),
  { from: S.ledger.from + beats(6), src: 'hit-weak', volume: 0.3, note: "y'all spent $158.07" },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ from: S.grows.from + beats(8 + i), src: 'switch-tap', volume: 0.18 + i * 0.015, note: `friends batch ${i + 1} joins` })),
];
const sfxFor = (v: number) => (v === 3 ? [...SFX.filter((s) => s.note !== 'crane rises'), ...SFX_V3] : SFX);

const Music: React.FC<{ bgm: boolean; vo: ReturnType<typeof voFor> }> = ({ bgm, vo }) => {
  if (!bgm) return null;
  return (
    <>
      {MUSIC.map((m, i) => (
        <Sequence key={i} from={m.from} durationInFrames={m.trimAfter - m.trimBefore}>
          <DuckedMusic offset={m.from} trimBefore={m.trimBefore} trimAfter={m.trimAfter} vo={vo} />
        </Sequence>
      ))}
    </>
  );
};

// Music sits at 0.30 and ducks to 0.13 (~8–9 dB under the −16 LUFS narration).
const DuckedMusic: React.FC<{ offset: number; trimBefore: number; trimAfter: number; vo: ReturnType<typeof voFor> }> = ({ offset, trimBefore, trimAfter, vo }) => (
  <Audio
    src={staticFile('audio/bgm/bgm-tech-house.mp3')}
    trimBefore={trimBefore}
    trimAfter={trimAfter}
    volume={(fr) => {
      const g = fr + offset;
      // Duck with an 8f attack and 15f release; gaps under a second stay ducked.
      let d = 0;
      for (const v of vo) {
        const a = f(v.at) - 8;
        const b = f(v.at + v.dur) + 15;
        const up = Math.min(1, Math.max(0, (g - a) / 8));
        const down = Math.min(1, Math.max(0, (b + 15 - g) / 15));
        d = Math.max(d, Math.min(up, down));
      }
      const fadeIn = Math.min(1, fr / 3);
      const fadeOut = Math.min(1, (trimAfter - trimBefore - fr) / 3);
      return (0.3 - 0.19 * d) * fadeIn * Math.max(0, fadeOut);
    }}
  />
);

export const Main: React.FC<{ bgm: boolean; variant?: number; audit?: boolean }> = ({ bgm, variant = 1, audit = false }) => {
  useFonts();
  const v = variant;
  const VO = voFor(v);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* the blurred real footage under every glass scene */}
      <Sequence from={S.brand.from} durationInFrames={S.outro.from + S.outro.dur - S.brand.from}>
        <Backdrop />
      </Sequence>
      <Sequence from={S.cold.from} durationInFrames={S.cold.dur}><Cold /></Sequence>
      <Sequence from={S.freeze.from} durationInFrames={S.freeze.dur}><Freeze /></Sequence>
      <Sequence from={S.mess.from} durationInFrames={S.mess.dur}><Mess dur={S.mess.dur} v={v} /></Sequence>
      <Sequence from={S.brand.from} durationInFrames={S.brand.dur}><Brand dur={S.brand.dur} v={v} /></Sequence>
      <Sequence from={S.textIt.from} durationInFrames={S.textIt.dur}><TextIt dur={S.textIt.dur} v={v} /></Sequence>
      <Sequence from={S.receipt.from} durationInFrames={S.receipt.dur}><Receipt dur={S.receipt.dur} /></Sequence>
      <Sequence from={S.drinks.from} durationInFrames={S.drinks.dur}><Drinks dur={S.drinks.dur} /></Sequence>
      <Sequence from={S.remembers.from} durationInFrames={S.remembers.dur}><Remembers dur={S.remembers.dur} /></Sequence>
      <Sequence from={S.ask.from} durationInFrames={S.ask.dur}><Ask dur={S.ask.dur} /></Sequence>
      <Sequence from={S.settle.from} durationInFrames={S.settle.dur}><Settle dur={S.settle.dur} /></Sequence>
      <Sequence from={S.ledger.from} durationInFrames={S.ledger.dur}><Ledger dur={S.ledger.dur} v={v} /></Sequence>
      <Sequence from={S.hood.from} durationInFrames={S.hood.dur}><Hood dur={S.hood.dur} /></Sequence>
      <Sequence from={S.grows.from} durationInFrames={S.grows.dur}><Grows dur={S.grows.dur} v={v} /></Sequence>
      <Sequence from={S.outro.from} durationInFrames={S.outro.dur}><Outro dur={S.outro.dur} v={v} /></Sequence>
      <Sequence from={S.payoff.from} durationInFrames={S.payoff.dur}><Payoff /></Sequence>
      <Sequence from={S.endcard.from} durationInFrames={S.endcard.dur}><EndCard dur={S.endcard.dur} /></Sequence>

      <Grain />
      {audit && <Audit every={10} />}
      {/* audio */}
      <Music bgm={bgm} vo={VO} />
      {VO.map((v) => (
        <Sequence key={v.file} from={f(v.at)}>
          <Audio src={staticFile(`audio/vo/${v.file}.mp3`)} volume={1} />
        </Sequence>
      ))}
      {sfxFor(v).map((s, i) => (
        <Sequence key={i} from={Math.max(0, s.from - OUT)} durationInFrames={s.dur}>
          <Audio src={staticFile(`audio/sfx/${s.src}.mp3`)} volume={s.volume} />
        </Sequence>
      ))}
      {/* the original laugh under the payoff */}
      <Sequence from={S.payoff.from + 47} durationInFrames={f(2.7)}>
        <Audio src={staticFile('footage/tacos.mp4')} trimAfter={f(2.7)} volume={(fr) => 0.9 * Math.min(1, (f(2.7) - fr) / 12)} />
      </Sequence>
    </AbsoluteFill>
  );
};

