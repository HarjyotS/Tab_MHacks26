// Looping explainer clips for the demo screen (one idea each, 8 s):
// the gate, payment safety, the bank connection, and "you never leave iMessage".
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop, Caption, DigitRoll } from './components';
import { useFonts } from './fonts';
import { Grain } from './grain';
import { ICard, IOS, IPhone, IThread, type IMsg } from './imessage';
import { C, E, FONT_B, FONT_T, glass, lerp, seg } from './theme';

export const EXPLAIN_FRAMES = 240;

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useFonts();
  const frame = useCurrentFrame();
  // Fade at both ends so the loop point isn't a hard cut.
  const o = seg(frame, 0, 8) * (1 - seg(frame, EXPLAIN_FRAMES - 8, EXPLAIN_FRAMES));
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Backdrop />
      <AbsoluteFill style={{ background: 'rgba(6,16,11,0.45)' }} />
      <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

const Kicker: React.FC<{ text: string }> = ({ text }) => (
  <div data-box="kicker" style={{ position: 'absolute', left: 110, top: 64, font: `800 34px ${FONT_T}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.orangeSoft }}>{text}</div>
);

// ── 1. The gate: every message is classified before any AI sees it ─────────────
const GATE_ROWS: { text: string; intent: string; conf: string; pass: boolean }[] = [
  { text: 'omw', intent: 'chatter', conf: '0.99', pass: false },
  { text: 'got pizza for everyone, $48', intent: 'expense', conf: '0.98', pass: true },
  { text: 'that movie was so good', intent: 'chatter', conf: '0.99', pass: false },
  { text: "lol who's driving", intent: 'chatter', conf: '0.97', pass: false },
  { text: 'ubers were 36, i paid', intent: 'expense', conf: '0.98', pass: true },
  { text: 'happy bday!! 🎂', intent: 'chatter', conf: '0.99', pass: false },
];

export const ExplainGate: React.FC = () => {
  const frame = useCurrentFrame();
  const at = (i: number) => 14 + i * 24;
  const passed = GATE_ROWS.filter((r, i) => r.pass && frame >= at(i) + 16).length;
  const dropped = GATE_ROWS.filter((r, i) => !r.pass && frame >= at(i) + 16).length;
  return (
    <Shell>
      <Kicker text="the gate · jev by typesafe" />
      {GATE_ROWS.map((r, i) => {
        const p = seg(frame, at(i), at(i) + 12, E.land);
        const v = seg(frame, at(i) + 10, at(i) + 20, E.soft);
        return (
          <div key={i} data-box={`row:${i}`} style={{ position: 'absolute', left: 110, top: 142 + i * 118, width: 1150, height: 96, display: 'flex', alignItems: 'center', gap: 22, opacity: p, transform: `translateX(${(1 - p) * -40}px)` }}>
            <div style={{ background: IOS.gray, color: '#000', borderRadius: 34, padding: '14px 26px', font: `400 36px ${IOS.font}`, whiteSpace: 'nowrap', opacity: r.pass ? 1 : lerp(v, 1, 0.55) }}>{r.text}</div>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: r.pass ? C.orange : 'rgba(255,255,255,0.25)', opacity: v, transformOrigin: 'left', transform: `scaleX(${v})` }} />
            <div style={{ ...glass({ tint: r.pass ? 'rgba(238,93,63,0.55)' : 'rgba(255,255,255,0.12)', radius: 999, blur: 18 }), padding: '10px 24px', font: `700 32px ${FONT_B}`, color: C.white, whiteSpace: 'nowrap', opacity: v }}>
              {r.intent} · {r.conf}
            </div>
            <div style={{ width: 210, font: `800 32px ${FONT_T}`, color: r.pass ? C.mintBright : 'rgba(255,255,255,0.6)', opacity: v, whiteSpace: 'nowrap' }}>{r.pass ? '→ to the ai' : '✕ dropped'}</div>
          </div>
        );
      })}
      <div data-box="counts" style={{ position: 'absolute', left: 1340, top: 190, width: 470, ...glass({ tint: 'rgba(12,30,22,0.55)', radius: 36, blur: 28 }), padding: '34px 40px', opacity: seg(frame, 6, 20) }}>
        <div style={{ font: `700 32px ${FONT_B}`, color: 'rgba(255,255,255,0.8)' }}>reached the ai</div>
        <div style={{ font: `800 150px/1 ${FONT_T}`, color: C.mintBright, letterSpacing: '-0.04em' }}>{passed}</div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.18)', margin: '22px 0' }} />
        <div style={{ font: `700 32px ${FONT_B}`, color: 'rgba(255,255,255,0.8)' }}>never left the chat</div>
        <div style={{ font: `800 150px/1 ${FONT_T}`, color: C.white, letterSpacing: '-0.04em' }}>{dropped}</div>
      </div>
      <Caption text="classified first. only money talk reaches the ai." start={10} end={EXPLAIN_FRAMES - 6} size={58} />
    </Shell>
  );
};

// ── 2. Payment safety: the AI reads, code does the math, only your 👍 pays ─────
const SafetyCard: React.FC<{ x: number; d: number; who: string; role: string; lines: string[]; tag: string; warm?: boolean }> = ({ x, d, who, role, lines, tag, warm }) => {
  const frame = useCurrentFrame();
  const p = seg(frame, d, d + 14, E.land);
  return (
    <div data-box={`safety:${who}`} style={{ position: 'absolute', left: x, top: 150, width: 540, height: 400, ...glass({ tint: warm ? 'rgba(238,93,63,0.3)' : 'rgba(255,255,255,0.13)', radius: 36, blur: 28 }), padding: '30px 34px', opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ font: `800 54px ${FONT_T}`, color: C.white, letterSpacing: '-0.03em' }}>{who}</div>
      <div style={{ font: `600 32px ${FONT_B}`, color: 'rgba(255,255,255,0.78)', marginBottom: 20 }}>{role}</div>
      {lines.map((l, i) => (
        <div key={l} style={{ font: `600 34px ${FONT_B}`, color: C.white, marginTop: 8, opacity: seg(frame, d + 16 + i * 8, d + 26 + i * 8) }}>{l}</div>
      ))}
      <div style={{ position: 'absolute', left: 34, bottom: 28, font: `800 30px ${FONT_T}`, color: warm ? C.white : C.mintBright, opacity: seg(frame, d + 44, d + 56) }}>{tag}</div>
    </div>
  );
};

export const ExplainSafety: React.FC = () => {
  const frame = useCurrentFrame();
  const no = seg(frame, 118, 132, E.land);
  const yes = seg(frame, 158, 172, E.land);
  const badge = seg(frame, 150, 160, E.land);
  return (
    <Shell>
      <Kicker text="payment safety" />
      <SafetyCard x={110} d={10} who="the ai" role="grok reads the message" lines={['amount  $36.00', 'payer   joe', 'split   everyone']} tag="no math. no money." />
      <SafetyCard x={690} d={36} who="the code" role="does every calculation" lines={['$36.00 ÷ 3', '= $12.00 each', 'checked in the database']} tag="every number is a database row." />
      <SafetyCard x={1270} d={62} who="you" role="approve it yourself" lines={['tap 👍 on the settle msg', 'pays only your own share']} tag="nothing moves without it." warm />
      <div data-box="typed" style={{ position: 'absolute', left: 110, top: 610, width: 820, height: 250, opacity: no, transform: `translateY(${(1 - no) * 24}px)` }}>
        <div style={{ display: 'inline-block', background: IOS.blue, color: '#fff', borderRadius: 34, padding: '14px 26px', font: `400 38px ${IOS.font}` }}>yes send it</div>
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ font: `800 60px ${FONT_T}`, color: C.orangeSoft }}>✕</span>
          <span style={{ font: `700 40px ${FONT_B}`, color: C.white }}>a typed “yes” never pays</span>
        </div>
      </div>
      <div data-box="tapped" style={{ position: 'absolute', left: 1010, top: 610, width: 800, height: 250, opacity: seg(frame, 138, 150), transform: `translateY(${(1 - seg(frame, 138, 150, E.land)) * 24}px)` }}>
        <div style={{ position: 'relative', display: 'inline-block', background: IOS.gray, color: '#000', borderRadius: 34, padding: '14px 26px', font: `400 38px ${IOS.font}` }}>
          tap 👍 to pay your part
          <div style={{ position: 'absolute', right: -26, top: -40, width: 74, height: 62, borderRadius: 31, background: IOS.blue, border: '4px solid #fff', display: 'grid', placeItems: 'center', fontSize: 34, transform: `scale(${badge})` }}>👍</div>
        </div>
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 18, opacity: yes }}>
          <span style={{ font: `800 60px ${FONT_T}`, color: C.mintBright }}>✓</span>
          <span style={{ font: `700 40px ${FONT_B}`, color: C.white }}>your 👍 creates the transfer</span>
        </div>
      </div>
      <Caption text="the ai never moves money. only your 👍 does." start={10} end={EXPLAIN_FRAMES - 6} size={58} />
    </Shell>
  );
};

// ── 3. The bank: a 👍 becomes a transfer between bank accounts ─────────────────
export const ExplainBank: React.FC = () => {
  const frame = useCurrentFrame();
  const badge = seg(frame, 40, 52, E.land);
  const flow = seg(frame, 58, 96, E.inOutCubic);
  const bank = seg(frame, 14, 30, E.land);
  const dm = seg(frame, 150, 166, E.land);
  return (
    <Shell>
      <Kicker text="connected to your bank" />
      <ICard name="settle" style={{ position: 'absolute', left: 110, top: 180, width: 640 }}>
        <div style={{ font: `400 30px ${IOS.font}`, color: IOS.name, marginLeft: 20, marginBottom: 6 }}>Tab</div>
        <div style={{ position: 'relative', background: IOS.gray, borderRadius: 34, padding: '16px 24px', font: `400 34px/1.28 ${IOS.font}`, color: '#000' }}>
          cool, here’s what’s owed to Sam for ubers:
          <br />Joe $12.00
          <br />tap 👍 to pay your part
          <div style={{ position: 'absolute', right: -18, top: -44, width: 74, height: 62, borderRadius: 31, background: IOS.blue, border: '4px solid #fff', display: 'grid', placeItems: 'center', fontSize: 34, transform: `scale(${badge})` }}>👍</div>
        </div>
      </ICard>
      <div data-box="flow" style={{ position: 'absolute', left: 780, top: 310, width: 300, height: 90 }}>
        <div style={{ position: 'absolute', left: 0, top: 44, height: 4, borderRadius: 2, width: 300 * flow, background: C.orange, boxShadow: `0 0 18px ${C.orange}` }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, textAlign: 'center', font: `800 32px ${FONT_T}`, color: C.white, opacity: seg(frame, 62, 76) }}>transfer $12.00</div>
      </div>
      <div data-box="bank" style={{ position: 'absolute', left: 1110, top: 150, width: 700, background: '#fff', borderRadius: 40, padding: '34px 40px 38px', boxShadow: '0 30px 80px rgba(0,0,0,0.4)', opacity: bank, transform: `translateY(${(1 - bank) * 30}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Img src={staticFile('img/capital-one.svg')} style={{ height: 92 }} />
          <span style={{ font: `700 30px ${FONT_B}`, color: '#5a6672' }}>nessie sandbox api</span>
        </div>
        <div style={{ height: 2, background: '#e6e9ed', margin: '22px 0 8px' }} />
        {[
          { who: 'Joe', acct: 'checking ···4821', from: '$500.00', to: '$488.00', delta: '− $12.00', color: '#c8321e' },
          { who: 'Sam', acct: 'checking ···9034', from: '$500.00', to: '$512.00', delta: '+ $12.00', color: '#19805d' },
        ].map((a, i) => (
          <div key={a.who} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0', borderBottom: i === 0 ? '2px solid #eef0f3' : undefined }}>
            <div>
              <div style={{ font: `800 40px ${FONT_T}`, color: '#10202b' }}>{a.who}</div>
              <div style={{ font: `600 30px ${FONT_B}`, color: '#6b7783' }}>{a.acct}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {frame < 100 ? <div style={{ font: `800 60px ${FONT_T}`, color: '#10202b' }}>{a.from}</div> : <DigitRoll value={a.to} from={a.from} delay={100} size={60} color="#10202b" />}
              <div style={{ font: `800 30px ${FONT_B}`, color: a.color, opacity: seg(frame, 108, 120) }}>{a.delta}</div>
            </div>
          </div>
        ))}
      </div>
      <div data-box="dm" style={{ position: 'absolute', left: 110, top: 640, width: 1100, ...glass({ tint: 'rgba(255,255,255,0.92)', radius: 34, blur: 20 }), padding: '22px 30px', opacity: dm, transform: `translateY(${(1 - dm) * -24}px)` }}>
        <div style={{ font: `700 30px ${IOS.font}`, color: '#000' }}>Tab · iMessage</div>
        <div style={{ font: `400 34px/1.3 ${IOS.font}`, color: '#000' }}>done, you paid Sam $12.00 for ubers through capital one nessie</div>
      </div>
      <Caption text="one 👍. the money moves between bank accounts." start={10} end={EXPLAIN_FRAMES - 6} size={58} />
    </Shell>
  );
};

// ── 4. You never leave iMessage ───────────────────────────────────────────────
const NEVER: IMsg[] = [
  { id: 'n1', from: 'Sam', text: 'ubers were 36, i paid', at: 12, tapback: { glyph: '👍', at: 28 } },
  { id: 'n2', from: 'Tab', text: 'ubers $36.00 split 3 ways, so $12.00 each', at: 40 },
  { id: 'n3', from: 'Joe', text: 'how much do i owe?', at: 78 },
  { id: 'n4', from: 'Tab', text: 'you owe Sam $12.00', at: 100 },
  { id: 'n5', from: 'Sam', text: 'settle up', at: 132 },
  { id: 'n6', from: 'Tab', text: 'tap 👍 on this to pay your part', at: 150, tapback: { glyph: '👍', at: 178 } },
];
const NOPE = ['no app to download', 'no sign-up', 'no spreadsheet', 'no payment requests to chase'];

export const ExplainNeverLeave: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = seg(frame, 0, 18, E.land);
  return (
    <Shell>
      <Kicker text="where it lives" />
      <div data-box="headline" style={{ position: 'absolute', left: 110, top: 150, width: 980, font: `800 112px/1.02 ${FONT_T}`, letterSpacing: '-0.045em', color: C.white, opacity: seg(frame, 6, 22, E.soft) }}>
        you never leave <span style={{ color: C.orangeSoft }}>imessage.</span>
      </div>
      <div data-box="sub" style={{ position: 'absolute', left: 110, top: 410, width: 940, font: `500 44px/1.25 ${FONT_B}`, color: 'rgba(255,255,255,0.88)', opacity: seg(frame, 20, 36, E.soft) }}>
        log it, ask about it and pay it, all in the group chat you already have.
      </div>
      {NOPE.map((t, i) => {
        const p = seg(frame, 60 + i * 26, 74 + i * 26, E.land);
        return (
          <div key={t} data-box={`nope:${i}`} style={{ position: 'absolute', left: 110 + (i % 2) * 490, top: 590 + Math.floor(i / 2) * 110, ...glass({ tint: 'rgba(255,255,255,0.13)', radius: 999, blur: 20 }), padding: '16px 30px', display: 'flex', alignItems: 'center', gap: 16, opacity: p, transform: `scale(${lerp(p, 0.9, 1)})` }}>
            <span style={{ font: `800 36px ${FONT_T}`, color: C.orangeSoft }}>✕</span>
            <span style={{ font: `700 34px ${FONT_B}`, color: C.white, whiteSpace: 'nowrap' }}>{t}</span>
          </div>
        );
      })}
      <IPhone title="vegas trip 🎰" members={['Sam', 'Joe', 'Tab']} style={{ left: 1250, top: 40, transform: `translateX(${(1 - enter) * 120}px)`, opacity: enter }}>
        <IThread msgs={NEVER} me="Joe" maxW={340} size={28} />
      </IPhone>
    </Shell>
  );
};
