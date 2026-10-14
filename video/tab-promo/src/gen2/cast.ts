// Gen 2 cast ("the Kiens"), per gen2/SCRIPT.md §2. Chat names are what real Kien
// saved in his contacts; Tab lowercases them. Photos land at
// public/gen2/cast/<id>-avatar.jpg; until then ContactPhoto falls back to
// iOS-style initials on a tinted monogram.
import React from 'react';
import { getStaticFiles } from 'remotion';
import { ContactBook, ContactInfo } from '../imessage';

export type CastId =
  | 'real' | 'wizard' | 'captain' | 'farmer' | 'fluencer' | 'gainz'
  | 'grandpa' | 'space' | 'holmes' | 'ceo' | 'baby' | 'waiter';

export type CastMember = {
  id: CastId;
  /** chat display name, exactly as saved in Kien's phone */
  name: string;
  /** short label for tags / portrait cards */
  label: string;
  initials: string;
  tint: string;
};

export const CAST: Record<CastId, CastMember> = {
  real: { id: 'real', name: 'kien', label: 'kien', initials: 'K', tint: '#6aa5e8' },
  wizard: { id: 'wizard', name: 'wizard kien 🧙', label: 'wizard kien', initials: 'WK', tint: '#7d6bb8' },
  captain: { id: 'captain', name: "cap'n kien 🏴‍☠️", label: "cap'n kien", initials: 'CK', tint: '#b5564a' },
  farmer: { id: 'farmer', name: 'farmer kien 🌾', label: 'farmer kien', initials: 'FK', tint: '#b8973c' },
  fluencer: { id: 'fluencer', name: 'kienfluencer 📸', label: 'kienfluencer', initials: 'K', tint: '#d27fa6' },
  gainz: { id: 'gainz', name: 'kien gainz 💪', label: 'kien gainz', initials: 'KG', tint: '#4fae6a' },
  grandpa: { id: 'grandpa', name: 'GRANDPA KIEN 👴', label: 'grandpa kien', initials: 'GK', tint: '#8f8a80' },
  space: { id: 'space', name: 'space kien 🚀', label: 'space kien', initials: 'SK', tint: '#4f97c4' },
  holmes: { id: 'holmes', name: 'kienlock holmes 🔍', label: 'kienlock holmes', initials: 'KH', tint: '#9a7b55' },
  ceo: { id: 'ceo', name: 'kien ceo 💼', label: 'kien ceo', initials: 'KC', tint: '#3f5f9e' },
  baby: { id: 'baby', name: 'baby kien 🍼', label: 'baby kien', initials: 'BK', tint: '#e59aae' },
  waiter: { id: 'waiter', name: 'kevin', label: 'kevin (also kien)', initials: 'K', tint: '#555b66' },
};

/** The ten who owe Kien, in the order Tab lists them (SCRIPT §5d). */
export const CLONES: CastId[] = ['wizard', 'captain', 'farmer', 'fluencer', 'gainz', 'grandpa', 'space', 'holmes', 'ceo', 'baby'];
/** Phone owner (blue bubbles) and the group. */
export const ME = CAST.real.name;
export const GROUP = 'the kiens 🥟';
/** Header avatars (first 5); after Tab joins, Tab goes first. */
export const HEADER = [CAST.wizard.name, CAST.captain.name, CAST.farmer.name, CAST.grandpa.name, CAST.baby.name];
export const HEADER_WITH_TAB = ['Tab', ...HEADER.slice(0, 4)];

export const n = (id: CastId) => CAST[id].name;
const BY_NAME: Record<string, CastMember> = Object.fromEntries(Object.values(CAST).map((c) => [c.name, c]));
export const memberByName = (name: string): CastMember | undefined => BY_NAME[name];

// ── public/ lookups (works in Studio and in CLI renders: the bundle ships the file list) ──
let cacheSrc: unknown = null;
let cache = new Set<string>();
const publicFiles = (): Set<string> => {
  try {
    const list = getStaticFiles();
    if (list !== cacheSrc) {
      cacheSrc = list;
      cache = new Set(list.map((f) => f.name));
    }
  } catch {
    // Player / server: no list, so everything falls back.
  }
  return cache;
};
/** First candidate path that exists under public/, else undefined. */
export const firstExisting = (...paths: string[]): string | undefined => {
  const files = publicFiles();
  return paths.find((p) => files.has(p));
};

export const avatarFor = (id: CastId): string | undefined =>
  firstExisting(`gen2/cast/${id}-avatar.jpg`, `gen2/cast/${id}-avatar.png`, `gen2/avatars/${id}.png`, `gen2/avatars/${id}.jpg`);

/** Larger portrait for R-top cards; falls back to the avatar crop. */
export const portraitFor = (id: CastId): string | undefined =>
  firstExisting(`gen2/cast/${id}.jpg`, `gen2/cast/${id}.png`, `gen2/cast/${id}-portrait.jpg`, `gen2/cast/${id}-portrait.png`) ?? avatarFor(id);

const shade = (hex: string, d: number) => {
  const v = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, ((v >> s) & 255) + d));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};
export const monogram = (tint: string) => `linear-gradient(180deg, ${shade(tint, 18)}, ${shade(tint, -34)})`;

export const contactFor = (name: string): ContactInfo | undefined => {
  const m = memberByName(name);
  if (!m) return undefined;
  return { img: avatarFor(m.id), initials: m.initials, background: monogram(m.tint) };
};

/** Wrap any gen-2 scene so every ContactPhoto resolves cast photos / initials. */
export const Contacts: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(ContactBook.Provider, { value: contactFor }, children);
