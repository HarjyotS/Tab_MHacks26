import type { Reaction } from "./types.ts";

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

/** message.date is nanoseconds since 2001-01-01 (seconds on very old rows). */
export function appleDate(value: number | null): Date {
  const n = value ?? 0;
  return new Date(APPLE_EPOCH_MS + (n > 1e12 ? n / 1e6 : n * 1000));
}

const NSSTRING = Buffer.from("NSString");
// typedstream type tag for raw bytes ("+"), which precedes the string's length.
const BYTES_TAG = Buffer.from([0x84, 0x01, 0x2b]);

/**
 * On recent macOS, message.text is often null and the body lives in
 * attributedBody: an NSAttributedString archived as a typedstream. The text is
 * the first NSString payload: a length (one byte, or 0x81 + uint16, or
 * 0x82 + uint32, little-endian) followed by UTF-8 bytes.
 */
export function decodeAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  const cls = buf.indexOf(NSSTRING);
  if (cls < 0) return null;
  const tag = buf.indexOf(BYTES_TAG, cls + NSSTRING.length);
  if (tag < 0 || tag - cls > 32) return null;

  let i = tag + BYTES_TAG.length;
  if (i >= buf.length) return null;
  let len = buf[i]!;
  i += 1;
  if (len === 0x81) {
    if (i + 2 > buf.length) return null;
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    if (i + 4 > buf.length) return null;
    len = buf.readUInt32LE(i);
    i += 4;
  } else if (len > 0x7f) {
    return null;
  }
  if (i + len > buf.length) return null;
  return buf.toString("utf8", i, i + len);
}

/** U+FFFC marks where an attachment sits inside a message's text. */
export function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/￼/g, "").replace(/\r\n?/g, "\n").trim();
}

export function messageText(row: { text: string | null; attributedBody: Uint8Array | null }): string {
  return cleanText(row.text || decodeAttributedBody(row.attributedBody));
}

const TAPBACKS: Record<number, Reaction> = {
  2000: "love",
  2001: "like",
  2002: "dislike",
  2003: "laugh",
  2004: "emphasize",
  2005: "question",
};

/**
 * associated_message_type: 2000-2005 add a classic tapback, 3000-3005 remove
 * one, and 1000, 2006, 2007, 4000 are stickers, emoji tapbacks and poll votes.
 * Returns the tapback for an add, or null for everything else.
 */
export function tapback(associatedType: number | null): Reaction | null {
  return associatedType == null ? null : (TAPBACKS[associatedType] ?? null);
}

/** True for any row that annotates another message rather than being one. */
export function isAssociated(associatedType: number | null): boolean {
  return associatedType != null && associatedType >= 1000;
}

/** associated_message_guid looks like "p:0/<guid>" or "bp:<guid>". */
export function reactionTarget(associatedGuid: string | null): string | null {
  if (!associatedGuid) return null;
  const slash = associatedGuid.indexOf("/");
  if (slash >= 0) return associatedGuid.slice(slash + 1);
  return associatedGuid.startsWith("bp:") ? associatedGuid.slice(3) : associatedGuid;
}

/** Handles are usually E.164 already; this catches the US-format stragglers. */
export function normalizeHandle(id: string): string {
  const trimmed = id.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}
