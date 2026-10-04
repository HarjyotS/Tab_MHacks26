// The short-lived raw transcript the gate sees (§6.5, §19): the last few
// messages per chat, including off-topic ones the module clears, so Jev can
// tell what "update it" refers to. In memory only, never persisted, and
// never sent to Grok: only gateInput (inputs.ts) reads it.
import type { PhotoNote } from "@tab/gate";

export const TRANSCRIPT_LINES = 12;
// Wall-clock, not scaled by DEMO_MODE: people type at the same speed in a demo.
export const TRANSCRIPT_TTL_MS = 15 * 60_000;

export type TranscriptEntry = {
  message_id: string;
  sender_phone: string;
  text?: string;
  photo?: PhotoNote;
  at: Date;
};

export class Transcript {
  private chats = new Map<string, TranscriptEntry[]>();

  constructor(
    private max = TRANSCRIPT_LINES,
    private ttlMs = TRANSCRIPT_TTL_MS,
  ) {}

  add(chat: string, entry: TranscriptEntry, now: Date) {
    const kept = this.fresh(chat, now).filter((e) => e.message_id !== entry.message_id);
    this.chats.set(chat, [...kept, entry].slice(-this.max));
  }

  // Lines before `before`, oldest first, none older than the TTL.
  recent(chat: string, now: Date, before: Date = now): TranscriptEntry[] {
    return this.fresh(chat, now).filter((e) => e.at < before);
  }

  // Fills in a photo described after its line was added.
  describe(chat: string, message_id: string, photo: PhotoNote) {
    for (const e of this.chats.get(chat) ?? []) if (e.message_id === message_id) e.photo = photo;
  }

  private fresh(chat: string, now: Date): TranscriptEntry[] {
    const list = (this.chats.get(chat) ?? []).filter((e) => now.getTime() - e.at.getTime() <= this.ttlMs);
    if (list.length > 0) this.chats.set(chat, list);
    else this.chats.delete(chat);
    return list;
  }
}
