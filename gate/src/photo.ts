import type { PhotoNote } from './types.js';

// A dollar amount or a total: text that reads like a receipt or bill.
const RECEIPT_TEXT = /\$\s?\d|\btotal\b/i;

/**
 * Whether Grok vision clearly saw something that isn't a receipt: a meme or
 * an ordinary photo, not money-related, with no dollar amount or "total" in
 * what it saw. Everything else, including a photo it couldn't describe,
 * still counts as a possible receipt, so a misdescribed receipt is read
 * rather than dropped (Joe's review on #41). Payment screenshots are
 * handled on their own (payment_reported).
 */
export function clearlyNotReceipt(photo: PhotoNote | undefined): boolean {
  if (!photo) return false;
  if (photo.kind !== 'meme' && photo.kind !== 'photo') return false;
  if (photo.money_related) return false;
  return !RECEIPT_TEXT.test(photo.transcription) && !RECEIPT_TEXT.test(photo.description);
}

/** A bare photo goes straight to the receipt read unless it clearly isn't one, or is a payment screenshot. */
export function receiptShortcut(photo: PhotoNote | undefined): boolean {
  if (photo?.kind === 'payment_screenshot') return false;
  return !clearlyNotReceipt(photo);
}
