import { cleanText } from "./decode.ts";

interface Expected {
  key: string;
  text: string;
  isFile: boolean;
  resolve: (guid: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * AppleScript sends don't return a message id, but every send lands in chat.db
 * as a from-me row within a second or so. The matcher pairs those rows with
 * the sends that produced them, which gives us `sent_photon_id`: the id that
 * tapbacks and replies on Tab's messages point at.
 *
 * Keys are the chat guid for groups and the recipient handle for DMs.
 */
export class SentMatcher {
  private expected: Expected[] = [];

  /**
   * Call before sending; pass null as the body for a file. `landed` resolves
   * with the row's guid, or null on timeout. Cancel if the send fails, so a
   * retry's row isn't claimed by the dead expectation.
   */
  expect(key: string, body: string | null, timeoutMs: number): { landed: Promise<string | null>; cancel: () => void } {
    let entry!: Expected;
    const remove = () => {
      clearTimeout(entry.timer);
      this.expected = this.expected.filter((e) => e !== entry);
    };
    const landed = new Promise<string | null>((resolve) => {
      entry = {
        key,
        text: cleanText(body),
        isFile: body == null,
        resolve,
        timer: setTimeout(() => {
          remove();
          resolve(null);
        }, timeoutMs),
      };
      this.expected.push(entry);
    });
    return { landed, cancel: () => (remove(), entry.resolve(null)) };
  }

  /** Whether any send to this chat (group guid or DM handle) is waiting to be matched. */
  expecting(key: string): boolean {
    return this.expected.some((e) => e.key === key);
  }

  /** Offer a from-me row. Returns true if it was one of our sends. */
  match(key: string, text: string, hasAttachment: boolean, guid: string): boolean {
    const body = cleanText(text);
    const index = this.expected.findIndex(
      (e) => e.key === key && (e.isFile ? hasAttachment && body === "" : e.text === body),
    );
    if (index < 0) return false;
    const [entry] = this.expected.splice(index, 1);
    clearTimeout(entry!.timer);
    entry!.resolve(guid);
    return true;
  }
}
