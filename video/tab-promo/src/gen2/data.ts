// Gen 2 script data that doesn't depend on the cut (gen2/SCRIPT.md): the
// receipt and its split, message helpers, freeze-tag head positions. Per-cut
// timing lives in ./timeline.ts.
import type { IMsg } from '../imessage';
import { receiptTotals, type ReceiptData } from './receipt';
import { CLONES, CastId, n } from './cast';
import { splitEven } from './tabJoins';

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);
export const shift = <T extends { at: number }>(xs: T[], by: number): T[] => xs.map((x) => ({ ...x, at: x.at + by }));

// ── the receipt (SCRIPT §4) ──
export const RECEIPT: ReceiptData = {
  name: 'BIG HAPPY FAMILY SEAFOOD PALACE',
  cjk: '大家庭海鮮酒家',
  address: '2026 WASHTENAW AVE · ANN ARBOR, MI',
  phone: '(734) 555-0188',
  meta: [
    ['TABLE 11', 'GUESTS 11', 'SERVER: KEVIN'],
    ['CHK #4471', '', '10/02/26   9:47 PM'],
  ],
  items: [
    { qty: 1, name: 'PEKING DUCK (WHOLE)', cents: 6800 },
    { qty: 1, name: 'PEKING DUCK #2 (FOR TABLE)', cents: 6800 },
    { qty: 2, name: 'LIVE LOBSTER (MKT)', cents: 10800 },
    { qty: 1, name: 'WHOLE STEAMED FISH (MKT)', cents: 4041 },
    { qty: 3, name: 'XIAO LONG BAO (8PC)', cents: 4185 },
    { qty: 1, name: 'XIAO LONG BAO - EXTRA??', cents: 1395 },
    { qty: 2, name: 'PORK & CHIVE DUMPLING', cents: 2390 },
    { qty: 47, name: 'STEAMED RICE', cents: 11750 },
    { qty: 1, name: 'YANG CHOW FRIED RICE', cents: 1695 },
    { qty: 1, name: 'HONEY WALNUT SHRIMP', cents: 2495 },
    { qty: 1, name: 'SALT & PEPPER SQUID', cents: 1995 },
    { qty: 1, name: 'SIZZLING PEPPER BEEF', cents: 2695 },
    { qty: 1, name: 'A5 WAGYU ADD-ON (4OZ)', cents: 8900 },
    { qty: 1, name: "GENERAL TSO'S CHICKEN", cents: 1795 },
    { qty: 1, name: 'MAPO TOFU', cents: 1595 },
    { qty: 1, name: 'BEEF CHOW FUN', cents: 1795 },
    { qty: 1, name: 'GAI LAN W/ OYSTER SAUCE', cents: 1495 },
    { qty: 1, name: 'CRAB RANGOON (24PC)', cents: 2195 },
    { qty: 11, name: 'TARO MILK TEA', cents: 7150 },
    { qty: 4, name: 'MANGO PUDDING', cents: 2780 },
    { qty: 1, name: 'SESAME BALLS', cents: 995 },
    { qty: 1, name: 'CHEF\'S SPECIAL "DON\'T ASK"', cents: 3800 },
    { qty: 1, name: 'CORKAGE: OWN SHAKER', cents: 1500 },
    { qty: 1, name: 'KIDS NUGGETS', cents: 895 },
    { qty: 1, name: 'APPLE JUICE (SIPPY CUP)', cents: 350 },
    { qty: 1, name: 'HOT WATER + STRAW', cents: 0 },
    { qty: 1, name: 'FORK', cents: 0 },
    { qty: 1, name: 'BIRTHDAY SONG (NO BDAY)', cents: 0 },
    { qty: 1, name: 'PLATE (BROKEN)', cents: 1200 },
    { qty: 1, name: 'BIRD SEED (OWL)', cents: 300 },
    { qty: 1, name: 'OUTLET FEE (RING LIGHT)', cents: 500 },
    { qty: 11, name: 'FORTUNE COOKIES', cents: 0 },
  ],
  tax: { label: 'SALES TAX 6%', rate: 0.06 },
  gratuity: { label: 'AUTO-GRATUITY 20% (PARTY 8+)', rate: 0.2 },
  footer: [
    'SORRY! NO SPLIT CHECKS, PARTIES 8+',
    'ONE CARD PER TABLE · THANK YOU!',
    '',
    'YOUR FORTUNE: A FRIEND WILL SAY',
    '"I\'LL GET YOU BACK." HE WILL NOT.',
    'COME AGAIN (SMALLER)',
  ],
};

/** What Tab calls the expense (compose() lowercases everything). */
export const LABEL = RECEIPT.name.toLowerCase();

// ── the split: 11 people, real Kien paid; each clone owes him their share ──
export const TOTAL = receiptTotals(RECEIPT).total; // 118800
const PEOPLE: CastId[] = ['real', ...CLONES];
export const SHARES = splitEven(TOTAL, PEOPLE.length); // 11 × 10800
export const OWES = CLONES.map((id) => ({ id, name: n(id), cents: SHARES[PEOPLE.indexOf(id)] }));

// ── message helpers (times in seconds; converted to frames) ──
export const PHOTO_ID = 'receipt-photo';
export const SETTLE_ID = 'settle';
export const m = (id: string, s: number, from: string, text: string, extra: Partial<IMsg> = {}): IMsg => ({ id, at: sec(s), from, text, ...extra });
export const sys = (id: string, s: number, text: string): IMsg => ({ id, at: sec(s), from: '', text, system: true });
export const photo = (id: string, s: number, from: string, extra: Partial<IMsg> = {}): IMsg => ({ id, at: sec(s), from, ...extra });

/** Freeze-frame tag spec, in 1920×1080 frame coords of the frozen M1 frame. */
export type TagSpec = { text: string; x: number; y: number; at: number; accent?: boolean; dir?: 'up' | 'down' | 'left' | 'right' };

/** Head positions on M1 at ~2.8 s (measured on the 1080p cover-scaled frame). */
export const M1_HEADS: { text: string; x: number; y: number; dir?: TagSpec['dir'] }[] = [
  { text: 'kien', x: 368, y: 300 }, // detective
  { text: 'kien', x: 668, y: 236 }, // ceo (sits low so it clears the credit-card tag)
  { text: 'kien', x: 142, y: 470 }, // influencer
  { text: 'kien, 81', x: 1425, y: 302, dir: 'right' }, // grandpa
  { text: 'kien', x: 518, y: 688 }, // wizard
  { text: 'kien', x: 1072, y: 696 }, // captain
  { text: 'kien', x: 1612, y: 640 }, // farmer
  { text: 'kien', x: 1770, y: 414 }, // gym bro
  { text: 'kien', x: 1582, y: 270 }, // astronaut
  { text: 'kien, 1', x: 1250, y: 172, dir: 'right' }, // baby
];
export const M1_REAL = { text: 'kien (has a credit card)', x: 918, y: 150 };
