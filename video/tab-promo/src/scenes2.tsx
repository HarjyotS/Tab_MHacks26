import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { Avatar, Caption, Chip, DigitRoll, Headline, MoneySwap } from './components';
import { ICard, IMsg, IPhone, IThread, Typing } from './imessage';
import { C, E, FONT_B, FONT_T, glass, lerp, seg } from './theme';

const MEMBERS = ['Alex', 'Sam', 'Priya', 'Jordan', 'Tab'];

// ── S5 just text it: Sam texts, Tab 👍s it, Tab replies with the split; shares embed as chips ──
export const TextIt: React.FC<{ dur: number; v?: number }> = ({ dur, v = 1 }) => {
  const frame = useCurrentFrame();
  const enter = seg(frame, 0, 18, E.outCubic);
  const msgs: IMsg[] = [
    { id: 'm0', from: 'Alex', text: "who's hungry", at: -30 },
    { id: 'm00', from: 'Jordan', text: 'omw 🍕', at: -20 },
    { id: 'm1', from: 'Sam', text: 'got pizza for everyone, $48', at: 12, tapback: { glyph: '👍', at: 30 } },
    { id: 'm2', from: 'Tab', text: "pizza $48.00 split 4 ways, so $12.00 each\nlmk if it wasn't even or someone skipped", at: 46 },
  ];
  const people = ['Alex', 'Sam', 'Priya', 'Jordan'];
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, perspective: 1800 }}>
        <IPhone title="taco crew 🌮" members={MEMBERS} style={{ left: 190, top: 40, transform: `translateX(${(1 - enter) * -120}px) rotateY(${lerp(enter, 14, 6)}deg)`, opacity: enter }}>
          <Typing from="Tab" at={34} until={46} />
          <IThread msgs={msgs} me="Jordan" maxW={420} />
        </IPhone>
      </div>
      <div style={{ position: 'absolute', left: 900, top: 230, width: 900 }}>
        <div data-box="headline:textit"><Headline text="just text it." start={8} size={140} /></div>
        <div data-box="sub:textit" style={{ marginTop: 22, font: `500 44px ${FONT_B}`, color: 'rgba(255,255,255,0.88)', opacity: seg(frame, 22, 36, E.soft) }}>
          {v >= 2 ? 'tab does the asking, so you never have to' : 'tab splits it the second you send it'}
        </div>
        <div style={{ marginTop: 56, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, perspective: 1200, width: 860 }}>
          {people.map((n, i) => {
            const p = seg(frame, 66 + i * 5, 84 + i * 5, E.land);
            const seam = seg(frame, 80 + i * 5, 86 + i * 5) * (1 - seg(frame, 90 + i * 5, 104 + i * 5));
            return (
              <div key={n} style={{ position: 'relative', opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * -60}px) rotateX(${(1 - p) * 55}deg)`, transformOrigin: '50% 100%' }}>
                <Chip label={<span style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Avatar name={n} size={48} />{n}</span>} value="$12.00" size={36} />
                <div data-overlay="1" style={{ position: 'absolute', left: 24, right: 24, bottom: -2, height: 3, borderRadius: 2, background: C.orange, opacity: seam, boxShadow: `0 0 14px ${C.orange}` }} />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── S6 snap the receipt: shutter, scan brackets sweep the real receipt, items stream out ──
const ITEMS: [string, string][] = [
  ['burger deluxe', '$14.99'],
  ['caesar salad', '$9.99'],
  ['2 × soft drink', '$5.98'],
  ['cheesecake', '$7.99'],
  ['tax', '$3.12'],
];
export const Receipt: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const DW = 400;
  const DH = Math.round((1124 / 560) * DW);
  const dp = seg(frame, 4, 20, E.outCubic);
  const flash = seg(frame, 2, 4) * (1 - seg(frame, 4, 10));
  const PASSES = 3;
  const sp = seg(frame, 26, 110);
  const raw = sp * PASSES;
  const pi = Math.min(PASSES - 1, Math.floor(raw));
  const local = Math.min(1, (raw - pi) / 0.88);
  const dir = pi % 2 === 0 ? 1 : -1;
  const prog = E.inOutSine(local);
  const y = dir > 0 ? prog * DH : DH - prog * DH;
  const scanO = seg(frame, 24, 30) * (1 - seg(frame, 106, 114));
  const corners = [
    { left: -14, top: -14, bl: 1, bt: 1, dx: 1, dy: 1 },
    { right: -14, top: -14, br: 1, bt: 1, dx: -1, dy: 1 },
    { right: -14, bottom: -14, br: 1, bb: 1, dx: -1, dy: -1 },
    { left: -14, bottom: -14, bl: 1, bb: 1, dx: 1, dy: -1 },
  ];
  const tip: IMsg[] = [
    { id: 't1', from: 'Tab', text: "what'd you tip?", at: 118 },
    { id: 't2', from: 'Priya', text: '5 bucks', at: 140 },
  ];
  return (
    <AbsoluteFill>
      <div data-box="receipt" style={{ position: 'absolute', left: 170, top: 56, width: DW, height: DH }}>
        <div data-texture="1" style={{ position: 'absolute', inset: 0, borderRadius: 22, overflow: 'hidden', transform: `scale(${lerp(dp, 0.86, 1)}) rotate(${lerp(dp, -4, -1.5)}deg)`, opacity: Math.min(1, dp * 3), boxShadow: '0 40px 90px rgba(0,0,0,0.45)', border: '1.5px solid rgba(255,255,255,0.5)' }}>
          <Img src={staticFile('img/bistro-receipt.png')} style={{ width: DW, height: DH, display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, opacity: scanO }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, transform: `translateY(${y}px)` }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 120, top: dir > 0 ? -120 : 3, background: dir > 0 ? 'linear-gradient(180deg, rgba(238,93,63,0), rgba(238,93,63,0.35))' : 'linear-gradient(180deg, rgba(238,93,63,0.35), rgba(238,93,63,0))' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: C.orange, boxShadow: `0 0 18px ${C.orange}` }} />
            </div>
          </div>
        </div>
        {corners.map((c, i) => {
          const p = seg(frame, 14 + i * 3, 22 + i * 3, E.outCubic);
          const b = '4px solid rgba(255,255,255,0.95)';
          return (
            <div key={i} data-overlay="1" style={{
              position: 'absolute', width: 70, height: 70, opacity: p, left: c.left, top: c.top, right: c.right, bottom: c.bottom,
              borderLeft: c.bl ? b : undefined, borderTop: c.bt ? b : undefined, borderRight: c.br ? b : undefined, borderBottom: c.bb ? b : undefined,
              borderRadius: 10, transform: `translate(${(1 - p) * 16 * c.dx}px, ${(1 - p) * 16 * c.dy}px)`,
            }} />
          );
        })}
      </div>
      <AbsoluteFill style={{ background: '#fff', opacity: flash * 0.8 }} />
      <div style={{ position: 'absolute', left: 660, top: 140, width: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ITEMS.map(([l, v], i) => {
          const p = seg(frame, 44 + i * 9, 58 + i * 9, E.land);
          return (
            <div key={l} style={{ opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * -80}px)` }}>
              <Chip label={l} value={v} size={38} />
            </div>
          );
        })}
        <div style={{ opacity: seg(frame, 156, 168, E.land), transform: `translateX(${(1 - seg(frame, 156, 168, E.land)) * -80}px)` }}>
          <Chip label="+ tip" value="$5.00" size={38} style={{ background: 'rgba(238,93,63,0.32)' }} />
        </div>
        <div data-box="total" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', opacity: seg(frame, 170, 180) }}>
          <span style={{ font: `700 40px ${FONT_B}`, color: 'rgba(255,255,255,0.85)' }}>total</span>
          <DigitRoll value="$47.07" delay={172} size={84} color={C.white} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1350, top: 140, width: 520, opacity: seg(frame, 112, 120) }}>
        <ICard name="tip"><IThread msgs={tip} me="Jordan" maxW={360} /></ICard>
      </div>
      <Caption text="snap the receipt. tab reads every line." start={10} end={dur - 4} />
    </AbsoluteFill>
  );
};

// ── S7 say it like you would: one sentence re-splits the bill ──
const SENT = 'it was just me and alex, and alex had both drinks';
export const Drinks: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const out = seg(frame, 58, 76, E.outCubic);
  const fly = seg(frame, 78, 104, E.inOutCubic);
  const rows = [
    { n: 'Alex', from: '$11.77', to: '$27.15' },
    { n: 'Sam', from: '$11.77', to: '$19.92' },
    { n: 'Priya', from: '$11.77', to: '' },
    { n: 'Jordan', from: '$11.76', to: '' },
  ];
  const thread: IMsg[] = [
    { id: 'd1', from: 'Sam', text: SENT, at: 2 },
    { id: 'd2', from: 'Tab', text: 'fixed it: the bistro $47.07: Alex $27.15, Sam $19.92', at: 128 },
  ];
  const p0 = { x: 640, y: 470 };
  const p1 = { x: 1270, y: 300 };
  const fx = lerp(fly, p0.x, p1.x);
  const fyy = lerp(fly, p0.y, p1.y) - Math.sin(fly * Math.PI) * 140;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 80, top: 230, width: 860 }}>
        <ICard name="drinks"><IThread msgs={thread} me="Jordan" maxW={680} size={44} gap={28} /></ICard>
      </div>
      <div style={{ position: 'absolute', left: 1110, top: 190, width: 620, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {rows.map((r, i) => {
          const leaving = !r.to;
          const o = leaving ? 1 - out * 0.8 : 1;
          const x = leaving ? out * 50 : 0;
          return (
            <div key={r.n} data-box={`row:${r.n}`} style={{ opacity: o * seg(frame, 2 + i * 3, 14 + i * 3, E.outCubic), transform: `translateX(${x}px)` }}>
              <div style={{ ...glass({ tint: 'rgba(255,255,255,0.15)', radius: 30, blur: 24 }), display: 'flex', alignItems: 'center', gap: 22, padding: '20px 30px' }}>
                <Avatar name={r.n} size={66} />
                <span style={{ flex: 1, font: `700 42px ${FONT_B}`, color: C.white, textDecoration: leaving && out > 0.5 ? 'line-through' : 'none' }}>
                  {r.n}{leaving && out > 0.5 ? <span style={{ font: `600 30px ${FONT_B}`, color: 'rgba(255,255,255,0.75)', marginLeft: 14 }}>wasn't there</span> : null}
                </span>
                {r.to ? <MoneySwap from={r.from} to={r.to} at={108 + i * 5} size={56} color={C.white} /> : <span style={{ font: `800 56px ${FONT_T}`, color: C.white }}>{out > 0.5 ? '$0.00' : r.from}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {fly > 0 && fly < 1 && (
        <div data-overlay="1" style={{ position: 'absolute', left: fx - 150, top: fyy - 40, transform: `scale(${lerp(Math.sin(fly * Math.PI), 1, 1.12)})` }}>
          <Chip label="2 × soft drink" value="$5.98" size={34} style={{ background: 'rgba(238,93,63,0.55)' }} />
        </div>
      )}
      <Caption text="say it like you would. tab gets it." start={10} end={dur - 4} />
    </AbsoluteFill>
  );
};

// ── S8 breathing card ──
export const Remembers: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const card = seg(frame, 0, 16, E.land);
  const words = ['it', 'remembers', 'everything.'];
  const mark = seg(frame, 34, 46, E.outCubic);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ background: 'rgba(6,16,11,0.45)' }} />
      <div data-box="card:remembers" style={{ ...glass({ tint: 'rgba(255,255,255,0.12)', radius: 48, blur: 34 }), padding: '60px 80px', transform: `scale(${lerp(card, 0.92, 1)})`, opacity: card }}>
        <div style={{ font: `800 128px/1 ${FONT_T}`, letterSpacing: '-0.05em', color: C.white, display: 'flex', gap: 30 }}>
          {words.map((w, i) => {
            const p = seg(frame, 6 + i * 7, 18 + i * 7, E.land);
            const isAccent = i === 2;
            return (
              <span key={w} style={{ position: 'relative', display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 34}px) rotate(${(1 - p) * -3}deg)`, color: isAccent ? C.orange : C.white }}>
                {w}
                {isAccent && <span style={{ position: 'absolute', left: 0, bottom: -10, height: 12, width: `${mark * 100}%`, borderRadius: 6, background: C.orange, opacity: 0.85 }} />}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 34, textAlign: 'center', font: `600 44px ${FONT_B}`, color: 'rgba(255,255,255,0.88)', opacity: seg(frame, 40, 54, E.soft) }}>
          every expense, receipt and payment, one text away
        </div>
      </div>
    </AbsoluteFill>
  );
};
