// TabTableFull (80.0 s) and TabTableShort (50.0 s): one film component driven
// by the cut plans in ./timeline.ts (SCRIPT.md §5a/§5b/§5c). Shots are local-
// time Sequences; overlays (bands, subtitles, the chat) run on film frames.
import React from 'react';
import { AbsoluteFill, Freeze, Sequence, useCurrentFrame } from 'remotion';
import { Audit } from '../audit';
import { Caption } from '../components';
import { useFonts } from '../fonts';
import { Grain } from '../grain';
import { IBanner } from '../imessage';
import { E, lerp, seg } from '../theme';
import { CAST, GROUP, ME } from './cast';
import { ChatBackdrop, ChatScene } from './chatChaos';
import { RECEIPT } from './data';
import { BlurKey, CamKey, CountChip, Flash, FreezeFrame, GridCell, Media, PunchIn, QuickCuts, Subtitles, Tag, TaglineCard, Window } from './kit';
import { ReceiptPhoto, ReceiptPlate, ReceiptScroll, useReceiptFont } from './receipt';
import { Soundtrack } from './sound';
import { tabCopy, withPhotos } from './tabJoins';
import { CUTS, CutId, f, ShotId } from './timeline';

const CLIP = (id: string) => `gen2/clips/${id}.mp4`;
const STILL = (id: string) => `gen2/stills/${id}.png`;
const PHOTO_W = 340;
const push = (len: number, to: number, x = 0.5, y = 0.5, from = 1): CamKey[] => [{ at: 0, s: from, x, y }, { at: len, s: to, x, y, ease: E.linear }];

// Feathered blur patches over AI gibberish text, keyed in CLIP seconds (frame coords).
type ClipBlur = { c: number; x: number; y: number; w: number; h: number }[];
const M4_EMBLEM: ClipBlur = [
  { c: 1.2, x: 1010, y: 610, w: 290, h: 160 }, { c: 2.0, x: 1040, y: 640, w: 280, h: 160 }, { c: 2.6, x: 1030, y: 650, w: 270, h: 150 },
  { c: 3.2, x: 1020, y: 630, w: 280, h: 160 }, { c: 3.9, x: 1050, y: 650, w: 280, h: 160 },
];
const M2_TERMINAL: ClipBlur = [
  { c: 0, x: 870, y: 860, w: 190, h: 220 }, { c: 2.5, x: 870, y: 860, w: 190, h: 220 }, { c: 2.8, x: 700, y: 840, w: 230, h: 240 },
  { c: 3.1, x: 560, y: 850, w: 250, h: 230 }, { c: 3.4, x: 430, y: 850, w: 290, h: 230 }, { c: 3.7, x: 400, y: 850, w: 300, h: 230 },
];
/** clip-second keys → local-frame keys for a shot that starts at clip time `inSec` */
const blurKeys = (keys: ClipBlur, inSec: number): BlurKey[] => keys.map((k) => ({ t: Math.round((k.c - inSec) * 30), x: k.x, y: k.y, w: k.w, h: k.h }));

export const Gen2Film: React.FC<{ cut: CutId; audit?: boolean; bgm?: boolean }> = ({ cut, audit = false, bgm = true }) => {
  useFonts();
  useReceiptFont();
  const P = CUTS[cut];
  const S = P.shots;
  const A = P.act1;
  const from = (id: ShotId) => f(S[id][0]);
  const len = (id: ShotId) => f(S[id][1]) - f(S[id][0]);
  const shot = (id: ShotId, node: React.ReactNode) => (
    <Sequence key={id} from={from(id)} durationInFrames={len(id)} name={id}>{node}</Sequence>
  );
  const msgs = withPhotos(P.chat.msgs, 'receipt-photo', <ReceiptPhoto data={RECEIPT} width={PHOTO_W} />, PHOTO_W);

  // ── reaction cuts (frames add up exactly to the shot) ──
  const m5 = f(A.m5);
  const cutFrames = A.cuts.map((c) => f(c.dur));
  cutFrames[cutFrames.length - 1] = len('erupt') - m5 - cutFrames.slice(0, -1).reduce((a, b) => a + b, 0);

  const chat = (
    <ChatScene
      msgs={msgs} me={ME} title={GROUP}
      members={P.chat.members} typing={P.chat.typing} scroll={P.chat.scroll} unread={P.chat.unread}
      portraits={P.chat.portraits} dms={P.chat.dms} dmsUntil={P.chat.dmsUntil} side={P.chat.side}
      backdrop={<Backdrop act3={P.chat.act3} />}
    />
  );

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* ── ACT I: dinner ── */}
      {shot('open', <Media id="M1" label="overhead: eleven kiens" clip={CLIP('M1')} in={0} still={STILL('H02')} cam={push(len('open'), 1.04)} />)}
      {shot('freeze', <FreezeTags cutFrame={from('freeze')} len={len('freeze')} tags={A.tags} freezeAt={A.freezeAt} />)}
      {shot('drop', <Media id="M3" label="bill drop" clip={CLIP('M3')} in={A.m3In} still={STILL('H03')} clipCam={push(len('drop'), 1.07, 0.48, 0.42)} cam={push(len('drop'), 1.12, 0.48, 0.3)} />)}
      {shot('opens', <Media id="M4" label="kien opens the folder" clip={CLIP('M4')} in={A.m4aIn} still={STILL('H04')} blur={blurKeys(M4_EMBLEM, A.m4aIn)} cam={push(len('opens'), 1.04)} />)}
      {shot('receipt', <ReceiptShot plate={f(A.plate)} keys={A.scroll.map((k) => ({ at: f(k.t), row: k.row, anchor: k.anchor, s: k.s }))} />)}
      {shot('tail', <Media id="M4" label="kien looks up, hopeful" clip={CLIP('M4')} in={A.m4bIn} still={STILL('H04')} blur={blurKeys(M4_EMBLEM, A.m4bIn)} cam={push(len('tail'), 1.08, 0.5, 0.35, 1.04)} />)}
      {shot('waiter', (
        <>
          <Media id="M2" label="kevin the waiter (also kien)" clip={CLIP('M2')} in={A.m2In} still={STILL('H06')} blur={blurKeys(M2_TERMINAL, A.m2In)} cam={push(len('waiter'), 1.04)} />
          <Tag text={CAST.waiter.label} x={1150} y={232} at={12} dir="right" accent size={40} />
        </>
      ))}
      {shot('erupt', (
        <>
          <Sequence from={0} durationInFrames={m5} layout="none">
            <Media id="M5" label="eruption: JUST PAY!" clip={CLIP('M5')} in={0} still={STILL('H07')} clipCam={push(m5, 1.03)} cam={push(m5, 1.04)} />
          </Sequence>
          <Sequence from={m5} layout="none">
            <QuickCuts cuts={A.cuts.map((c, i) => ({ dur: cutFrames[i], node: <GridCell cell={c.who} />, focus: [0.5, 0.45] as [number, number] }))} />
          </Sequence>
        </>
      ))}
      {shot('tap', <Media id="H09" label="the tap" still={STILL('H09')} cam={push(len('tap'), 1.03)} />)}
      {shot('nope', (
        <FreezeFrame at={0} bw push={[1.03, 1.09]} pushDur={len('nope')}>
          <Media id="H09" label="the tap" still={STILL('H09')} />
        </FreezeFrame>
      ))}

      {/* ── ACT II–III: the group chat (film-frame data) ── */}
      <Window from={from('chat1')} to={from('alone')}>{chat}</Window>
      {shot('alone', <Media id="H10" label="alone at the wreckage" still={STILL('H10')} cam={push(len('alone'), 1.06)} />)}
      <Window from={from('chat2')} to={from('exhale')}>{chat}</Window>

      {/* ── ACT IV ── */}
      {shot('exhale', <Media id="M7" label="exhale" clip={CLIP('M7')} in={A.m7In} still={STILL('H10')} cam={push(len('exhale'), 1.04)} />)}
      {shot('grow', (
        <>
          <PunchIn keys={[{ at: 0, s: 2.4, x: 0.5, y: 0.765 }, { at: len('grow'), s: 1, x: 0.5, y: 0.765, ease: E.inOutCubic }]}>
            <Media id="H11" label="banquet hall of ~100 kiens" still={STILL('H11')} />
          </PunchIn>
          <CountChip from={11} to={100} at={12} label="friends" />
        </>
      ))}
      {shot('end', (
        <>
          <AbsoluteFill style={{ filter: 'blur(22px) brightness(0.42)', transform: 'scale(1.1)' }}>
            <Media id="H11" label="" still={STILL('H11')} />
          </AbsoluteFill>
          <TaglineCard tagline="friendships compound. debts shouldn't." at={f(P.end.tagline) - from('end')} lockAt={f(P.end.lock) - from('end')} />
        </>
      ))}
      {shot('button', <Button len={len('button')} h12={f(P.button.h12) - from('button')} banner={f(P.button.banner) - from('button')} />)}

      {/* ── text on film frames ── */}
      {P.bands.map((b) => <Caption key={b.text} text={b.text} start={f(b.a)} end={f(b.b)} />)}
      <Subtitles lines={P.subs.map((s) => ({ text: s.text, from: f(s.a), to: f(s.b) }))} />

      <Grain />
      {audit && <Audit every={10} safe={48} />}
      <Soundtrack plan={P} bgm={bgm} />
    </AbsoluteFill>
  );
};

/** F02: freeze on M1, desaturate, slow push; tags pop on every head (they ride the push). */
const FreezeTags: React.FC<{ cutFrame: number; len: number; tags: typeof CUTS.full.act1.tags; freezeAt: number }> = ({ cutFrame, len, tags, freezeAt }) => {
  const frame = useCurrentFrame();
  const k = seg(frame, 0, 6, E.outCubic);
  const s = lerp(seg(frame, 0, len, E.inOutSine), 1, 1.03);
  return (
    <AbsoluteFill data-bleed="1" style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${s})` }}>
        <AbsoluteFill style={{ filter: `saturate(${(1 - 0.4 * k).toFixed(3)}) contrast(${1 + 0.05 * k})` }}>
          <Freeze frame={0}><Media id="M1" label="overhead (freeze)" clip={CLIP('M1')} in={freezeAt} still={STILL('H02')} /></Freeze>
        </AbsoluteFill>
        {tags.map((t, i) => (
          <Tag key={i} id={`${t.text}-${i}`} text={t.text} x={t.x} y={t.y} at={t.at - cutFrame} until={len + 1} accent={t.accent} dir={t.dir} size={t.accent ? 40 : 36} />
        ))}
      </AbsoluteFill>
      <Flash at={0} peak={0.45} />
    </AbsoluteFill>
  );
};

/** F05: POV plate (snap toward the receipt), then the head-on macro scroll and the TOTAL punch-in. */
const ReceiptShot: React.FC<{ plate: number; keys: { at: number; row: string; anchor: number; s: number }[] }> = ({ plate, keys }) => {
  const frame = useCurrentFrame();
  if (frame < plate) {
    return (
      <PunchIn keys={[{ at: 0, s: 1, x: 0.514, y: 0.2 }, { at: plate, s: 1.35, x: 0.514, y: 0.2, ease: E.inQuad }]}>
        <ReceiptPlate data={RECEIPT} />
      </PunchIn>
    );
  }
  return <ReceiptScroll data={RECEIPT} keys={keys.map((k, i) => ({ ...k, ease: i === 2 ? E.inOutQuad : i >= 3 ? E.outCubic : E.inOutSine }))} />;
};

/** Chat backdrop: the party (H02) in Act II, the empty room (H10) once he's alone. */
const Backdrop: React.FC<{ act3: number }> = ({ act3 }) => {
  const frame = useCurrentFrame();
  return frame >= act3 ? <ChatBackdrop still={STILL('H10')} hue={220} /> : <ChatBackdrop still={STILL('H02')} hue={12} />;
};

/** F23 / S18: M7's last frame, the taco crew banner drops, then H12 (busted). */
const Button: React.FC<{ len: number; h12: number; banner: number }> = ({ len, h12, banner }) => {
  const frame = useCurrentFrame();
  // the banner drops on M7's last frame and leaves as we cut to his face
  const p = seg(frame, banner, banner + 12, E.land) * (1 - seg(frame, h12 - 5, h12 + 1, E.inCubic));
  if (frame >= len - 1) return <AbsoluteFill style={{ background: '#000' }} />;
  return (
    <AbsoluteFill>
      {frame < h12 ? (
        <Freeze frame={0}><Media id="M7" label="exhale (last frame)" clip={CLIP('M7')} in={3.0} still={STILL('H10')} /></Freeze>
      ) : (
        <Media id="H12" label="busted" still={STILL('H12')} cam={[{ at: h12, s: 1, x: 0.45, y: 0.4 }, { at: len, s: 1.04, x: 0.45, y: 0.4, ease: E.linear }]} />
      )}
      {frame >= banner && frame < h12 + 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 56, display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - p) * -300}px)` }}>
          <IBanner app="Messages" title="taco crew 🌮" body={`Tab: ${tabCopy.approvalFollowup(CAST.real.name, 'sam', 650)}`} />
        </div>
      )}
    </AbsoluteFill>
  );
};

export const TabTableFull: React.FC<{ audit?: boolean; bgm?: boolean }> = (p) => <Gen2Film cut="full" {...p} />;
export const TabTableShort: React.FC<{ audit?: boolean; bgm?: boolean }> = (p) => <Gen2Film cut="short" {...p} />;
export const FULL_FRAMES = f(CUTS.full.total);
export const SHORT_FRAMES = f(CUTS.short.total);
