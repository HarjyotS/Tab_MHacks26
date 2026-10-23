import { dismissPicker, runUiScript, uiScript, withChatTitle } from "./messages-ui.ts";
import type { Reaction } from "./types.ts";

/**
 * Sends a tapback on a message, identified by its chat.db guid. `fits` says
 * whether a Messages window title is that message's chat (titleFits).
 */
export interface Tapbacker {
  /** True when it can react to any message by guid (imsg), not just the chat's newest (the UI). */
  anyMessage?: boolean;
  react(targetGuid: string, reaction: Reaction, fits: (title: string) => boolean, chatGuid?: string): Promise<void>;
  /** Closes the tapback picker if a tapback didn't land, so it can't block what comes next. */
  dismiss?(): Promise<void>;
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
 * Drives Messages' UI: open the message's chat, check its window title is
 * that chat, then (still on that exact title) choose Edit → Tapback Last
 * Message… and press the picker key. Messages reacts to the chat's newest
 * message, so callers must check the target is still the newest. Needs
 * Accessibility permission. Gives up within seconds: a tapback that can't
 * go out quickly isn't worth holding up the reply behind it.
 */
export function uiTapbacker(): Tapbacker {
  const scripts = new Map<Reaction, string[]>();
  return {
    async react(targetGuid, reaction, fits) {
      let lines = scripts.get(reaction);
      if (!lines) {
        lines = uiScript("Tapback", [`keystroke "${PICKER_KEY[reaction]}"`], false, 0.9);
        scripts.set(reaction, lines);
      }
      const script = lines;
      await withChatTitle(targetGuid, fits, (title) => runUiScript(script, [targetGuid, title], 8_000));
    },
    dismiss: dismissPicker,
  };
}
