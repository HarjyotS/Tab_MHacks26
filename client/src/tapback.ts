import { dismissPicker, finishScript, openScript, twoStep, withChatTitle } from "./messages-ui.ts";
import type { Reaction } from "./types.ts";

/**
 * Sends a tapback on a message, identified by its chat.db guid. `fits` says
 * whether a Messages window title is that message's chat (titleFits).
 */
export interface Tapbacker {
  /** True when it can react to any message by guid (imsg), not just the chat's newest (the UI). */
  anyMessage?: boolean;
  react(targetGuid: string, reaction: Reaction, fits: (title: string) => boolean, chatGuid?: string, newest?: () => boolean): Promise<void>;
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
  const open = openScript("Tapback", 0.9);
  const finish = new Map<Reaction, string[]>();
  return {
    async react(targetGuid, reaction, fits, _chatGuid, newest) {
      let keys = finish.get(reaction);
      if (!keys) {
        keys = finishScript([`keystroke "${PICKER_KEY[reaction]}"`], false);
        finish.set(reaction, keys);
      }
      const steps = { open, finish: keys };
      await withChatTitle(targetGuid, fits, (title) => twoStep(steps, { guid: targetGuid, title }, newest));
    },
    dismiss: dismissPicker,
  };
}
