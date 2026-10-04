import { runUiScript, uiScript } from "./messages-ui.ts";

/** Sends text as an inline (threaded) reply to a message, in the chat named chatTitle. */
export interface Replier {
  reply(targetGuid: string, text: string, chatTitle: string): Promise<void>;
}

const LINES = uiScript("Reply to", ['keystroke "v" using command down', "delay 0.3", "if not frontmost then error \"NOT_SENT: Messages lost focus before sending\"", "keystroke return"], true);

/**
 * Drives Messages' UI: open the message's chat, wait until Messages shows that
 * exact chat, choose Edit → Reply to Last Message…, paste the text (restoring the
 * clipboard afterwards, on every path), and press Return. Like tapbacks, Messages
 * replies to the chat's newest message, so the bridge only uses this while the
 * target is still the newest. Needs Accessibility permission.
 */
export function uiReplier(): Replier {
  return {
    async reply(targetGuid, text, chatTitle) {
      await runUiScript(LINES, [targetGuid, chatTitle, text], 20_000);
    },
  };
}
