import { runUiScript, uiScript } from "./messages-ui.ts";
import type { Reaction } from "./types.ts";

/** Sends a tapback on a message, identified by its chat.db guid, in the chat named chatTitle. */
export interface Tapbacker {
  react(targetGuid: string, reaction: Reaction, chatTitle: string): Promise<void>;
}

// Keys 1-6 in Messages' tapback picker, in its left-to-right order.
const PICKER_KEY: Record<Reaction, string> = {
  love: "1",
  like: "2",
  dislike: "3",
  laugh: "4",
  emphasize: "5",
  question: "6",
};

/**
 * Drives Messages' UI: open the message's chat, wait until Messages shows that
 * exact chat, choose Edit → Tapback Last Message… (or Tapback Message…), and
 * press the picker key. Messages reacts to the chat's newest message, so callers
 * must check the target is still the newest. Needs Accessibility permission.
 */
export function uiTapbacker(): Tapbacker {
  const scripts = new Map<Reaction, string[]>();
  return {
    async react(targetGuid, reaction, chatTitle) {
      let lines = scripts.get(reaction);
      if (!lines) {
        lines = uiScript("Tapback", [`keystroke "${PICKER_KEY[reaction]}"`], false);
        scripts.set(reaction, lines);
      }
      await runUiScript(lines, [targetGuid, chatTitle], 15_000);
    },
  };
}
