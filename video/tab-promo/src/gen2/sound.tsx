// Gen 2 mix, same approach as gen 1 (src/Main.tsx): VO at −16 LUFS on top,
// music ducked under every voice with an attack/release envelope, the
// restaurant bed through Act I (normal + low-passed copies crossfaded),
// SFX pinned to the frame. Splices and playbackRate come from timeline.ts.
import React from 'react';
import { Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { clamp01 } from '../theme';
import { BAR, CutPlan, cueLen, EnvKey, f, FPS, srcBar, VoCue } from './timeline';

/** Output intervals (frames) of every voice, for ducking. */
export const voiceSpans = (cues: VoCue[]): [number, number][] =>
  cues.map((c) => {
    const a = f(c.at);
    const b = Math.min(f(c.at + cueLen(c)), c.cutAt !== undefined ? f(c.cutAt) : Infinity);
    return [a, b];
  });

/** 0..1 duck amount: 4-frame attack before a voice, 8-frame release after. */
export const duckAt = (g: number, spans: [number, number][], attack = 4, release = 8) => {
  let d = 0;
  for (const [a, b] of spans) {
    if (g >= a && g <= b) return 1;
    if (g < a && g >= a - attack) d = Math.max(d, 1 - (a - g) / attack);
    if (g > b && g <= b + release) d = Math.max(d, 1 - (g - b) / release);
  }
  return d;
};

const env = (keys: EnvKey[], t: number) => {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [ta, va] = keys[i - 1];
    const [tb, vb] = keys[i];
    if (t < tb) return tb === ta ? vb : va + (vb - va) * ((t - ta) / (tb - ta));
  }
  return keys[keys.length - 1][1];
};

// ── one spliced segment of a voice ──
const Seg: React.FC<{ src: string; trimBefore: number; rate: number; vol: number; from: number; dur: number; fadeIn: boolean; fadeOut: boolean; duckFrom?: number }> = ({
  src, trimBefore, rate, vol, from, dur, fadeIn, fadeOut, duckFrom,
}) => {
  const lf = useCurrentFrame();
  const g = from + lf;
  let v = vol;
  if (fadeIn) v *= clamp01((lf + 1) / 2);
  if (fadeOut) v *= clamp01((dur - lf) / 2);
  if (duckFrom !== undefined && g >= duckFrom) v *= 1 - 0.65 * clamp01((g - duckFrom + 1) / 3);
  return <Audio src={staticFile(src)} trimBefore={trimBefore} playbackRate={rate} volume={v} />;
};

export const VoTrack: React.FC<{ cue: VoCue }> = ({ cue }) => {
  const rate = cue.rate ?? 1;
  let t = cue.at;
  const cut = cue.cutAt !== undefined ? f(cue.cutAt) : Infinity;
  return (
    <>
      {cue.segs.map(([a, b], i) => {
        const from = f(t);
        t += (b - a) / rate;
        const end = Math.min(f(t), cut);
        const dur = end - from;
        if (dur <= 0) return null;
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none" name={`${cue.id}#${i}`}>
            <Seg src={cue.src} trimBefore={Math.round(a * FPS)} rate={rate} vol={cue.vol ?? 1} from={from} dur={dur}
              fadeIn={i > 0} fadeOut={i < cue.segs.length - 1 || end === cut} duckFrom={cue.duckAt !== undefined ? f(cue.duckAt) : undefined} />
          </Sequence>
        );
      })}
    </>
  );
};

// ── music: hard-cut clips on the bar grid, ducked under voices ──
const MusicSeg: React.FC<{ trimBefore: number; offset: number; dur: number; spans: [number, number][]; base: number; ducked: number }> = ({ trimBefore, offset, dur, spans, base, ducked }) => {
  const lf = useCurrentFrame();
  const d = duckAt(offset + lf, spans);
  const tail = clamp01((dur - lf) / 2); // no click on the hard stop
  return <Audio src={staticFile('gen2/audio/bgm/cat-walk.mp3')} trimBefore={trimBefore} volume={(base - (base - ducked) * d) * tail} />;
};

// ── restaurant bed ──
const Bed: React.FC<{ src: string; keys: EnvKey[] }> = ({ src, keys }) => {
  const frame = useCurrentFrame();
  return <Audio src={staticFile(src)} loop volume={env(keys, frame / FPS)} />;
};

const Sfx: React.FC<{ src: string; vol: number; dur?: number; from?: number; rate?: number }> = ({ src, vol, dur, from, rate }) => {
  const lf = useCurrentFrame();
  const fade = dur ? clamp01((f(dur) - lf) / 4) : 1;
  return <Audio src={staticFile(src)} trimBefore={from ? Math.round(from * FPS) : undefined} playbackRate={rate} volume={vol * fade} />;
};

export const Soundtrack: React.FC<{ plan: CutPlan; bgm?: boolean }> = ({ plan, bgm = true }) => {
  const spans = voiceSpans(plan.vo);
  const bedEnd = f(plan.shots.nope[0]) + 1;
  return (
    <>
      {bgm && plan.music.map((c, i) => {
        const from = f(c.at);
        const dur = f(c.at + (c.toBar - c.fromBar) * BAR) - from;
        return (
          <Sequence key={`m${i}`} from={from} durationInFrames={dur} layout="none" name={`music ${c.fromBar}→${c.toBar}`}>
            <MusicSeg trimBefore={Math.round(srcBar(c.fromBar) * FPS)} offset={from} dur={dur} spans={spans} base={0.34} ducked={0.14} />
          </Sequence>
        );
      })}
      <Sequence from={0} durationInFrames={bedEnd} layout="none" name="X1 bed">
        <Bed src="gen2/audio/sfx/X1.mp3" keys={plan.amb.x1} />
      </Sequence>
      <Sequence from={0} durationInFrames={bedEnd} layout="none" name="X1 bed (low-passed)">
        <Bed src="gen2/audio/sfx/X1-lp.mp3" keys={plan.amb.lp} />
      </Sequence>
      {plan.vo.map((c) => <VoTrack key={c.id} cue={c} />)}
      {plan.sfx.map((s, i) => (
        <Sequence key={`s${i}`} from={Math.max(0, f(s.at) - 1)} durationInFrames={s.dur ? f(s.dur) : undefined} layout="none">
          <Sfx src={s.src} vol={s.vol} dur={s.dur} from={s.from} rate={s.rate} />
        </Sequence>
      ))}
    </>
  );
};
