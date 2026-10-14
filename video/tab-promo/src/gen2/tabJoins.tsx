// Tab joins the group: "You added Tab to the conversation.", Tab's intro, the
// receipt → even split, "settle up" → settle request, then the 👍 storm (one
// gray tapback badge whose count climbs, stacked like iOS) and every payer's
// own DM confirmation (a queued banner stack, one per person, never overlapping).
// Copy is Tab's real template text (backend/src/copy/templates.ts), lowercased
// like compose().
import React from 'react';
import type { IMsg } from '../imessage';
import { money } from '../theme';
import type { StackItem } from './chatChaos';

// ── money ──
/** Even split to the cent; leftover pennies go to the first `r` people. */
export const splitEven = (totalCents: number, people: number): number[] => {
  const base = Math.floor(totalCents / people);
  const r = totalCents - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < r ? 1 : 0));
};

// ── copy ──
const compose = (s: string) => s.toLowerCase();
export const tabCopy = {
  intro: () => compose("hey i'm tab 👋\ni keep the group's tab so nobody has to do the math\njust talk like normal (\"got groceries 40\") or drop a receipt pic. you can kick me out whenever"),
  /** splitProposal. Uneven pennies get a short note (that note is not a verbatim template). */
  splitProposal: (label: string, total: number, shares: number[]) => {
    const hi = Math.max(...shares), lo = Math.min(...shares);
    const each = hi === lo ? `so ${money(hi)} each` : `so ${money(hi)} each (a few of you ${money(lo)})`;
    return compose(`${label} ${money(total)} split ${shares.length} ways, ${each}\nlmk if it wasn't even or someone skipped`);
  },
  settleRequest: (payee: string, label: string, owes: { name: string; cents: number }[]) =>
    compose(`cool, here's what's owed to ${payee} for ${label}:\n${owes.map((o) => `${o.name} ${money(o.cents)}`).join(', ')}\ntap 👍 on this to pay your part, or reply if something's off`),
  personalBalanceReply: (payee: string, cents: number) => compose(`you owe ${payee} ${money(cents)}`),
  tapToPay: () => compose('just tap 👍 on the settle msg to pay your part'),
  paymentConfirmation: (payee: string, cents: number, label: string) =>
    compose(`done, you paid ${payee} ${money(cents)} for ${label} through capital one nessie\nyou're all square`),
  allSquare: (label: string) => compose(`everyone's square on ${label} 🎉`),
  approvalFollowup: (you: string, payee: string, cents: number) =>
    compose(`hey ${you}, you owe ${payee} ${money(cents)}\nno rush, just tap 👍 on the settle msg when you can`),
};

export const TAB_ADDED = 'You added Tab to the conversation.';

export type Payer = {
  /** chat display name */ name: string;
  cents: number;
  /** frame their 👍 lands on the settle request */ at: number;
  /** label above their DM banner, e.g. "baby kien's phone" */ owner?: string;
  /** e.g. 64 for a max-text-size phone */ bodySize?: number;
};

export type TabJoinOpts = {
  me: string; // payer of the bill and phone owner (blue)
  label: string; // the expense, as Tab names it
  total: number;
  shares: number[]; // everyone's share, payer included
  payers: Payer[]; // everyone who owes `me`, in settle-request order
  at: {
    added: number;
    intro: number;
    photo?: number; // `me` re-sends the receipt photo
    like?: number; // Tab's 👍 on it
    proposal: number;
    settleUp: number;
    stamp?: number;
    settle: number;
    square?: number; // "everyone's square" (omit to leave it out)
  };
  stamp?: string; // e.g. 'Today 10:52 PM'
  /** "how much do i owe again?" → balance reply */
  ask?: { from: string; text: string; at: number; replyAt: number };
  /** a non-money line Tab ignores (privacy gate) */
  aside?: { from: string; text: string; at: number };
  /** a typed "yes" (never pays) → Tab points to 👍 */
  typedYes?: { from: string; text: string; at: number; replyAt: number };
  photoId?: string;
  settleId?: string;
  addedText?: string;
};

/** Build the messages and the per-payer DM stack for the Tab beat. Order of
 *  the payers' `at` decides the storm; the badge count climbs 1 → payers.length. */
export const tabJoinBeats = (o: TabJoinOpts): { msgs: IMsg[]; dms: StackItem[]; settleId: string } => {
  const settleId = o.settleId ?? 'settle';
  const storm = [...o.payers].sort((a, b) => a.at - b.at);
  const msgs: IMsg[] = [
    { id: 'tab-added', at: o.at.added, from: '', text: o.addedText ?? TAB_ADDED, system: true },
    { id: 'tab-intro', at: o.at.intro, from: 'Tab', text: tabCopy.intro() },
  ];
  if (o.at.photo !== undefined) {
    msgs.push({ id: o.photoId ?? 'receipt-photo-2', at: o.at.photo, from: o.me, ...(o.at.like !== undefined ? { tapback: { glyph: '👍', at: o.at.like } } : {}) });
  }
  msgs.push(
    { id: 'tab-proposal', at: o.at.proposal, from: 'Tab', text: tabCopy.splitProposal(o.label, o.total, o.shares) },
    { id: 'settle-up', at: o.at.settleUp, from: o.me, text: 'settle up' },
  );
  if (o.stamp && o.at.stamp !== undefined) msgs.push({ id: 'stamp', at: o.at.stamp, from: '', text: o.stamp, system: true });
  msgs.push({
    id: settleId, at: o.at.settle, from: 'Tab',
    text: tabCopy.settleRequest(o.me, o.label, o.payers),
    ...(storm.length ? { tapback: { glyph: '👍', at: storm[0].at, also: storm.slice(1).map((p) => p.at) } } : {}),
  });
  if (o.ask) {
    const who = o.payers.find((p) => p.name === o.ask!.from);
    msgs.push(
      { id: 'ask', at: o.ask.at, from: o.ask.from, text: o.ask.text },
      { id: 'ask-reply', at: o.ask.replyAt, from: 'Tab', text: tabCopy.personalBalanceReply(o.me, who?.cents ?? o.shares[0]) },
    );
  }
  if (o.aside) msgs.push({ id: 'aside', at: o.aside.at, from: o.aside.from, text: o.aside.text });
  if (o.typedYes) {
    msgs.push(
      { id: 'typed-yes', at: o.typedYes.at, from: o.typedYes.from, text: o.typedYes.text },
      { id: 'tap-to-pay', at: o.typedYes.replyAt, from: 'Tab', text: tabCopy.tapToPay() },
    );
  }
  if (o.at.square !== undefined) msgs.push({ id: 'all-square', at: o.at.square, from: 'Tab', text: tabCopy.allSquare(o.label) });
  msgs.sort((a, b) => a.at - b.at);
  const dms: StackItem[] = storm.map((p) => ({
    at: p.at,
    owner: p.owner,
    title: 'Tab',
    body: tabCopy.paymentConfirmation(o.me, p.cents, o.label),
    app: 'Messages',
    bodySize: p.bodySize,
  }));
  return { msgs, dms, settleId };
};

/** Attach a live-rendered photo (e.g. <ReceiptPhoto/>) to photo messages by id prefix. */
export const withPhotos = (msgs: IMsg[], prefix: string, photo: React.ReactNode, width: number): IMsg[] =>
  msgs.map((m) => (m.id.startsWith(prefix) ? { ...m, photo, imgW: width } : m));
