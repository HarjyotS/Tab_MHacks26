import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Avatar, Caption, Chip, DigitRoll, Headline, TabMark } from './components';
import { IBanner, ICard, IMsg, IPhone, IThread, Typing } from './imessage';
import { C, E, FONT_B, FONT_T, glass, lerp, rand, seg } from './theme';
import { beats } from './timeline';
import { LiveDot } from './scenes4';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ── S9 ask anything: Jordan asks in the chat, Tab answers from the ledger; evidence rows check off ──
const CheckIcon: React.FC<{ progress: number }> = ({ progress }) => {
  const ring = interpolate(progress, [0, 0.45, 0.75], [0.36, 1, 0], clamp);
  const check = interpolate(progress, [0.62, 1], [0, 1], clamp);
  return (
    <div style={{ position: 'relative', width: 44, height: 44, flex: 'none' }}>
      <div style={{ position: 'absolute', inset: 3, borderRadius: 99, border: '3px solid rgba(255,255,255,0.4)', borderTopColor: C.mintBright, opacity: ring, transform: `rotate(${progress * 100}deg)` }} />
      <div style={{ position: 'absolute', inset: 1, borderRadius: 99, background: C.mintBright, opacity: check, transform: `scale(${lerp(check, 0.72, 1)})`, display: 'grid', placeItems: 'center' }}>
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M3.4 8.3 6.6 11l6-6" stroke="#0f2a1c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </div>
  );
};
export const Ask: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const ease = Easing.bezier(0.2, 0.75, 0.25, 1);
  const enter = seg(frame, 0, 18, E.outCubic);
  const msgs: IMsg[] = [
    { id: 'c1', from: 'Priya', text: 'this trip is going too fast 😭', at: -40 },
    { id: 'c2', from: 'Sam', text: 'fr', at: -30 },
    { id: 'q', from: 'Jordan', text: 'how much did we spend on food?', at: 10 },
    { id: 'a1', from: 'Tab', text: "y'all spent $158.07 on food so far", at: 44 },
    { id: 'a2', from: 'Tab', text: 'groceries $63.00\npizza $48.00\nthe bistro $47.07', at: 58 },
  ];
  const ROWS: [string, string, number][] = [['groceries', '$63.00', 70], ['pizza', '$48.00', 82], ['the bistro', '$47.07', 94]];
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 230, width: 820 }}>
        <div data-box="headline:ask"><Headline text="ask it anything." start={6} size={130} /></div>
        <div data-box="sub:ask" style={{ marginTop: 20, font: `500 42px ${FONT_B}`, color: 'rgba(255,255,255,0.88)', opacity: seg(frame, 20, 34, E.soft) }}>every number checked against the ledger</div>
        <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {ROWS.map(([t, v, cue]) => {
            const body = interpolate(frame, [cue, cue + 12], [0, 1], { ...clamp, easing: ease });
            const st = interpolate(frame, [cue + 3, cue + 14], [0, 1], { ...clamp, easing: ease });
            return (
              <div key={t} data-box={`evidence:${t}`} style={{ height: 86, borderRadius: 22, ...glass({ tint: 'rgba(255,255,255,0.12)', radius: 22, blur: 22 }), display: 'flex', alignItems: 'center', gap: 22, padding: '0 28px', opacity: body, transform: `translateY(${18 * (1 - body)}px)`, filter: `blur(${6 * (1 - body)}px)` }}>
                <CheckIcon progress={st} />
                <span style={{ flex: 1, font: `600 40px ${FONT_B}`, color: C.white }}>{t}</span>
                <span style={{ font: `800 42px ${FONT_T}`, color: st > 0.78 ? C.mintBright : 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, perspective: 1800 }}>
        <IPhone title="taco crew 🌮" members={['Alex', 'Sam', 'Priya', 'Jordan', 'Tab']} style={{ left: 1170, top: 40, transform: `translateX(${(1 - enter) * 120}px) rotateY(${lerp(enter, -14, -6)}deg)`, opacity: enter }}>
          <Typing from="Tab" at={24} until={44} />
          <IThread msgs={msgs} me="Jordan" maxW={430} />
        </IPhone>
      </div>
    </AbsoluteFill>
  );
};

// ── S10 settle with a 👍: Tab's settle request, three 👍 tapbacks pop on, the payment DM banner drops ──
export const Settle: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const who = ['Alex', 'Priya', 'Jordan'];
  const POPS = [52, 66, 80];
  const toast = seg(frame, 110, 126, E.land);
  const req: IMsg = { id: 'req', from: 'Tab', text: "cool, here's what's owed to Sam for pizza: Alex $12.00, Priya $12.00, Jordan $12.00\ntap 👍 on this to pay your part, or reply if something's off", at: 0 };
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 170, top: 410, width: 1040 }}>
        <div style={{ position: 'relative' }}>
          <ICard name="settle"><IThread msgs={[req]} me="Jordan" maxW={900} size={44} /></ICard>
          <div data-box="tapbacks:settle" style={{ position: 'absolute', right: 40, top: -74, display: 'flex' }}>
            {POPS.map((at, i) => {
              const f = frame - at;
              // Pops from 0.94 (fading in over 2f) so the glyph never drops below the 30px floor.
              const scale = f < 0 ? 0 : f < 3 ? 0.94 : f < 9 ? lerp(E.outCubic((f - 3) / 6), 0.94, 1.35) : lerp(E.outBack(Math.min(1, (f - 9) / 11), 2), 1.35, 1);
              const fadeIn = f < 0 ? 0 : Math.min(1, (f + 1) / 2);
              const rt = seg(frame, at + 3, at + 23);
              return (
                <div key={i} style={{ position: 'relative', marginLeft: i ? -18 : 0 }}>
                  {rt > 0 && rt < 1 && (
                    <svg width={240} height={240} style={{ position: 'absolute', left: -88, top: -88, pointerEvents: 'none' }}>
                      <circle cx={120} cy={120} r={34 + 80 * E.outCubic(rt)} fill="none" stroke={C.white} strokeWidth={6 - 4 * rt} opacity={0.8 * (1 - rt)} />
                    </svg>
                  )}
                  <div style={{ width: 66, height: 58, borderRadius: 29, background: '#e5e5ea', border: '3px solid #ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', display: 'grid', placeItems: 'center', fontSize: 32, transform: `scale(${scale})`, opacity: fadeIn }}>👍</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 30, marginTop: 44, marginLeft: 64 }}>
          {who.map((n, i) => {
            const paid = seg(frame, POPS[i] + 6, POPS[i] + 16, E.land);
            return (
              <div key={n} data-box={`paid:${n}`} style={{ display: 'flex', alignItems: 'center', gap: 14, ...glass({ tint: 'rgba(255,255,255,0.14)', radius: 999, blur: 22 }), padding: '10px 28px 10px 12px' }}>
                <Avatar name={n} size={56} />
                <span style={{ font: `700 36px ${FONT_B}`, color: C.white }}>{n}</span>
                <span style={{ font: `800 32px ${FONT_T}`, color: C.mintBright, opacity: Math.min(1, paid * 1.5), transform: `scale(${lerp(paid, 0.94, 1)})`, whiteSpace: 'nowrap', display: 'inline-block' }}>paid ✓</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', right: 60, top: 40, opacity: toast, transform: `translateY(${(1 - toast) * -60}px)` }}>
        <IBanner app="Messages" title="Tab" style={{ width: 760 }} body="done, you paid Sam $12.00 for pizza through capital one nessie. you're all square" />
      </div>
      <Caption text="settle with a 👍" start={12} end={dur - 4} />
    </AbsoluteFill>
  );
};

// ── S11 live ledger: crane rise on the real 2x screenshot (PageCam idea, CSS-size zoom for crisp raster) ──
const PAGE_W = 1440;
const PAGE_H = 1250;
export const Ledger: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  if (v === 3) return <LedgerText dur={dur} />;
  return <LedgerShot dur={dur} />;
};
const LedgerShot: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const p = seg(frame, 18, 150, E.outQuad);
  const s = lerp(p, 2.3, 1.36);
  const fx = lerp(p, 470, 720);
  const fy = lerp(p, 640, 397);
  const left = 960 - fx * s;
  const top = 540 - fy * s;
  const dot = 0.6 + 0.4 * Math.sin(frame / 4);
  const fade = seg(frame, 0, 8) * (1 - seg(frame, dur - 8, dur));
  return (
    <AbsoluteFill style={{ background: '#eef2ef', overflow: 'hidden', opacity: fade }}>
      <div data-texture="1"><Img src={staticFile('img/ledger@2x.png')} style={{ position: 'absolute', left, top, width: PAGE_W * s, height: PAGE_H * s }} /></div>
      <AbsoluteFill style={{ background: 'radial-gradient(1400px 900px at 50% 45%, rgba(0,0,0,0), rgba(10,30,20,0.28))', pointerEvents: 'none' }} />
      <div data-box="chip:url" style={{ position: 'absolute', left: 56, bottom: 84, display: 'flex', alignItems: 'center', gap: 14, ...glass({ tint: 'rgba(12,30,22,0.62)', radius: 999, blur: 24 }), padding: '12px 28px', opacity: seg(frame, 6, 20) }}>
        <span style={{ width: 16, height: 16, borderRadius: 99, background: C.mintBright, opacity: dot, boxShadow: `0 0 14px ${C.mintBright}` }} />
        <span style={{ font: `700 32px ${FONT_B}`, color: C.white }}>tab-ledger.vercel.app · live</span>
      </div>
      <Caption text="every balance, live." start={14} end={dur - 4} />
    </AbsoluteFill>
  );
};

// ── S11 (v3, gen 1 final) the ledger as text: the group's live balances tick in, one per beat ──
// Numbers match the rest of the film: Sam paid the bistro ($47.07: Alex $27.15), Priya paid
// groceries ($63 → $21 each for Priya, Jordan, Alex), and pizza was settled with 👍s (S10).
const BALANCES: { from: string; to: string; what: string; amt?: string }[] = [
  { from: 'Alex', to: 'Sam', what: 'the bistro', amt: '$27.15' },
  { from: 'Jordan', to: 'Priya', what: 'groceries', amt: '$21.00' },
  { from: 'Alex', to: 'Priya', what: 'groceries', amt: '$21.00' },
  { from: 'Priya', to: 'Sam', what: 'pizza' }, // paid back in the settle shot → square
];
export const LedgerText: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const fade = seg(frame, 0, 8) * (1 - seg(frame, dur - 8, dur));
  const panel = seg(frame, 0, 16, E.land);
  const rowAt = (i: number) => beats(2 + i); // 29, 44, 58, 73: one balance per beat
  const totalAt = beats(6); // 87
  const enter = (at: number) => interpolate(frame, [at, at + 12], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.75, 0.25, 1) });
  const muted = 'rgba(255,255,255,0.62)';
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill style={{ background: 'rgba(6,16,11,0.42)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, display: 'flex', justifyContent: 'center' }}>
        <div data-box="ledger:panel" style={{ ...glass({ tint: 'rgba(255,255,255,0.12)', radius: 44, blur: 34 }), width: 1180, padding: '34px 46px 34px', opacity: Math.min(1, panel * 1.4), transform: `translateY(${(1 - panel) * 30}px) scale(${lerp(panel, 0.95, 1)})` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <TabMark size={60} />
            <div style={{ flex: 1, font: `800 46px ${FONT_T}`, letterSpacing: '-0.035em', color: C.white }}>taco crew 🌮</div>
            <div data-box="ledger:live" style={{ display: 'flex', alignItems: 'center', gap: 14, ...glass({ tint: 'rgba(12,30,22,0.5)', radius: 999, blur: 18 }), padding: '10px 26px' }}>
              <LiveDot size={16} />
              <span style={{ font: `700 32px ${FONT_B}`, color: C.white }}>live</span>
            </div>
          </div>
          <div style={{ height: 1.5, background: 'rgba(255,255,255,0.2)', margin: '26px 0 22px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {BALANCES.map((b, i) => {
              const at = rowAt(i);
              const p = enter(at);
              const ok = seg(frame, at + 6, at + 16, E.land);
              return (
                <div key={i} data-box={`balance:${i}`} style={{ height: 96, ...glass({ tint: 'rgba(255,255,255,0.10)', radius: 26, blur: 20, shadow: false }), display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px', opacity: p, transform: `translateY(${18 * (1 - p)}px)`, filter: `blur(${6 * (1 - p)}px)` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                    <Avatar name={b.from} size={58} />
                    <span style={{ font: `700 32px ${FONT_B}`, color: muted }}>{b.amt ? '→' : '&'}</span>
                    <Avatar name={b.to} size={58} />
                  </div>
                  <span style={{ flex: 1, font: `600 44px ${FONT_B}`, color: C.white, whiteSpace: 'nowrap' }}>
                    {b.from} <span style={{ color: muted }}>{b.amt ? 'owes' : 'and'}</span> {b.to}
                  </span>
                  <span style={{ font: `500 32px ${FONT_B}`, color: muted, whiteSpace: 'nowrap' }}>{b.what}</span>
                  <span style={{ width: 220, display: 'flex', justifyContent: 'flex-end', flex: 'none' }}>
                    {b.amt ? (
                      <DigitRoll value={b.amt} delay={at + 3} size={52} color={C.white} />
                    ) : (
                      <span style={{ display: 'inline-block', font: `800 44px ${FONT_T}`, color: C.mintBright, whiteSpace: 'nowrap', opacity: ok, transform: `scale(${lerp(ok, 0.6, 1)})` }}>✓ square</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div data-box="ledger:total" style={{ marginTop: 22, padding: '18px 30px 0', borderTop: '1.5px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: enter(totalAt), transform: `translateY(${14 * (1 - enter(totalAt))}px)` }}>
            <span style={{ font: `700 40px ${FONT_B}`, color: 'rgba(255,255,255,0.8)' }}>y'all spent</span>
            <DigitRoll value="$158.07" delay={totalAt + 2} size={64} color={C.white} />
          </div>
        </div>
      </div>
      <Caption text="every balance, live." start={14} end={dur - 4} />
    </AbsoluteFill>
  );
};

// ── S12 under the hood: chatter bounces off the Jev gate, money talk flows through ──
const STREAM: { text: string; money: boolean }[] = [
  { text: 'lol', money: false },
  { text: 'got pizza, $48', money: true },
  { text: "who's driving?", money: false },
  { text: '📸 receipt', money: true },
  { text: 'omw', money: false },
  { text: 'that movie was so good', money: false },
  { text: 'venmo’d you', money: true },
  { text: 'send me that pic', money: false },
  { text: 'what do i owe?', money: true },
  { text: 'hahaha', money: false },
  { text: 'uber was $30, i paid', money: true },
  { text: "who's up?", money: false },
  { text: 'split the airbnb?', money: true },
];
export const Hood: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const GATE_X = 820;
  const nodeIn = (d: number) => seg(frame, d, d + 14, E.land);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'rgba(6,16,11,0.5)' }} />
      {/* gate */}
      <div data-box="gate" style={{ position: 'absolute', left: GATE_X - 70, top: 220, width: 140, height: 560, ...glass({ tint: 'rgba(255,255,255,0.12)', radius: 70, blur: 30 }), opacity: nodeIn(0), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ fontSize: 60 }}>🛡️</span>
      </div>
      <div data-box="gate-label" style={{ position: 'absolute', left: GATE_X - 160, width: 320, top: 112, textAlign: 'center', opacity: nodeIn(0) }}>
        <div style={{ font: `800 40px ${FONT_T}`, color: C.white }}>jev</div>
        <div style={{ font: `600 30px ${FONT_B}`, color: 'rgba(255,255,255,0.8)' }}>privacy gate</div>
      </div>
      {/* destinations */}
      {[
        { x: 1230, y: 330, icon: '🧠', t: 'grok', s: 'understands it', d: 6 },
        { x: 1230, y: 560, icon: '🧮', t: 'spacetimedb', s: 'does the math', d: 10 },
      ].map((n) => (
        <div key={n.t} data-box={`node:${n.t}`} style={{ position: 'absolute', left: n.x - 170, top: n.y - 70, width: 340, ...glass({ tint: 'rgba(255,255,255,0.14)', radius: 30, blur: 26 }), padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, opacity: nodeIn(n.d), transform: `scale(${lerp(nodeIn(n.d), 0.9, 1)})` }}>
          <span style={{ fontSize: 50 }}>{n.icon}</span>
          <div>
            <div style={{ font: `800 34px ${FONT_T}`, color: C.white }}>{n.t}</div>
            <div style={{ font: `600 30px ${FONT_B}`, color: 'rgba(255,255,255,0.75)' }}>{n.s}</div>
          </div>
        </div>
      ))}
      {/* flowing messages */}
      {STREAM.map((m, i) => {
        const start = 8 + i * 12;
        const t = frame - start;
        if (t < 0) return null;
        const y0 = 250 + ((i * 173) % 480);
        const toGate = seg(t, 0, 30, E.inOutCubic);
        let x = lerp(toGate, 60, GATE_X - 260);
        let y = y0;
        let o = seg(t, 0, 8);
        let blur = 0;
        let scale = 1;
        if (!m.money) {
          const bounce = seg(t, 30, 48, E.outCubic);
          x -= bounce * 60;
          y += bounce * 30;
          o *= 1 - bounce;
          blur = bounce * 8;
          scale = 1 - bounce * 0.2;
        } else {
          const pass = seg(t, 30, 60, E.inOutCubic);
          const ty = i % 4 === 1 || i % 4 === 3 ? 330 : 560;
          x = lerp(pass, x, 930);
          y = lerp(pass, y, ty);
          o *= 1 - seg(t, 40, 52);
          scale = 1 - seg(t, 46, 58) * 0.6;
        }
        const glow = m.money ? seg(t, 26, 34) : 0;
        return (
          <div key={i} data-overlay="1" style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale})`, opacity: o, filter: `blur(${blur}px)` }}>
            <div style={{ ...glass({ tint: m.money ? `rgba(238,93,63,${0.25 + 0.55 * glow})` : 'rgba(255,255,255,0.14)', radius: 999, blur: 18 }), padding: '14px 30px', font: `600 36px ${FONT_B}`, color: m.money ? C.white : 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', boxShadow: m.money ? `0 0 ${30 * glow}px rgba(238,93,63,0.55)` : undefined }}>
              {m.text}
            </div>
          </div>
        );
      })}
      <Caption text="only money talk ever reaches the ai." start={10} end={dur - 4} />
    </AbsoluteFill>
  );
};
