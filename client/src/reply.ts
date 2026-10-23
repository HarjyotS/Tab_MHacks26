import { runUiScript, uiScript, withChatTitle } from "./messages-ui.ts";

/** Sends text as an inline (threaded) reply to a message. `fits` checks Messages' window title (titleFits). */
export interface Replier {
  reply(targetGuid: string, text: string, fits: (title: string) => boolean): Promise<void>;
}

// Select-all before pasting: anything stray in the field is replaced, not sent along.
const LINES = uiScript(
  "Reply to",
  ['keystroke "a" using command down', 'keystroke "v" using command down', "delay 0.3", "if not frontmost then error \"NOT_SENT: Messages lost focus before sending\"", "keystroke return"],
  true,
  0.6,
);

/**
 * Drives Messages' UI: open the message's chat, check its window title is
 * that chat, then (still on that exact title) choose Edit → Reply to Last
 * Message…, paste the text (restoring the clipboard afterwards, on every
 * path), and press Return. Like tapbacks, Messages replies to the chat's
 * newest message, so the bridge only uses this while the target is still the
 * newest. Needs Accessibility permission.
 */
export function uiReplier(): Replier {
  return {
    async reply(targetGuid, text, fits) {
      await withChatTitle(targetGuid, fits, (title) => runUiScript(LINES, [targetGuid, title, text], 12_000));
    },
  };
}
