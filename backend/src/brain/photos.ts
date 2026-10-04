// What Grok vision saw in each photo (§7.4), kept in process memory by
// message_id; nothing goes to SpacetimeDB. Lost on restart, and recomputed
// from the message's image_url when it's needed again (inputs.ts).
import type { PhotoNote } from "@tab/gate";

const MAX_NOTES = 500;

export class PhotoNotes {
  // null: the image couldn't be fetched or read; don't try again.
  private notes = new Map<string, PhotoNote | null>();

  get(message_id: string): PhotoNote | undefined {
    return this.notes.get(message_id) ?? undefined;
  }

  has(message_id: string): boolean {
    return this.notes.has(message_id);
  }

  set(message_id: string, note: PhotoNote | null) {
    this.notes.delete(message_id);
    this.notes.set(message_id, note);
    // Oldest first out, so a long-running backend stays small.
    while (this.notes.size > MAX_NOTES) this.notes.delete(this.notes.keys().next().value!);
  }
}
