import { dismissPicker, finishScript, NotSentError, openScript, twoStep, withChatTitle } from "./messages-ui.ts";
import { actionFor, attempts, classicFor, reactionForAction } from "./reactions.ts";
import type { ClassicReaction, Reaction } from "./types.ts";

/** How Messages shows the target: its text (U+FFFC per attachment), when it was sent, and whose side. */
export interface Bubble {
  text: string;
  sentAt: Date;
  fromMe: boolean;
}

/**
 * Sends a tapback on a message, identified by its chat.db guid. `fits` says
 * whether a Messages window title is that message's chat (titleFits).
 */
export interface Tapbacker {
  /** True when it can react to any message by guid (imsg, tab-ax), not just the chat's newest (the picker). */
  anyMessage?: boolean;
  react(
    targetGuid: string,
    reaction: Reaction,
    fits: (title: string) => boolean,
    chatGuid?: string,
    newest?: () => boolean,
    bubble?: Bubble,
  ): Promise<void>;
  /** The reactions it may put on when asked for this one (stand-ins it falls back to); default just that one. */
  attempts?(reaction: Reaction): Reaction[];
  /** Closes the tapback picker if a tapback didn't land, so it can't block what comes next. */
  dismiss?(): Promise<void>;
}

// Keys 1-6 in Messages' tapback picker, in its left-to-right order.
const PICKER_KEY: Record<ClassicReaction, string> = {
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
  const finish = new Map<ClassicReaction, string[]>();
  return {
    // The picker's keys only reach the classic six: an emoji goes out as its classic stand-in.
    attempts: (reaction) => {
      const classic = classicFor(reaction);
      return classic ? [classic] : [];
    },
    async react(targetGuid, reaction, fits, _chatGuid, newest) {
      const classic = classicFor(reaction);
      if (!classic) throw new NotSentError(`NOT_SENT: unsupported: the tapback picker can't send ${reaction}`);
      let keys = finish.get(classic);
      if (!keys) {
        keys = finishScript([`keystroke "${PICKER_KEY[classic]}"`], false);
        finish.set(classic, keys);
      }
      const steps = { open, finish: keys };
      await withChatTitle(targetGuid, fits, (title) => twoStep(steps, { guid: targetGuid, title }, newest));
    },
    dismiss: dismissPicker,
  };
}

export type RunAx = (args: string[], timeoutMs: number) => Promise<string>;

/** Runs tab-ax. Exit 2 is NOT_SENT: it says nothing happened. */
export function runTabAx(bin: string): RunAx {
  return async (args, timeoutMs) => {
    const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
    }, timeoutMs);
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timer);
    if (code === 0) return out.trim();
    if (!killed && code === 2) throw new NotSentError(err.trim() || "NOT_SENT: tab-ax did nothing");
    throw new Error(killed ? `tab-ax timed out after ${timeoutMs} ms` : `tab-ax exited ${code}: ${err.trim()}`);
  };
}

/**
 * Tapbacks through Messages' accessibility actions (client/native/tab-ax):
 * open the chat at the message, find its bubble by text, time, and side,
 * and run the tapback's action on it. Works on any message on screen, so no
 * newest check, and emoji work: an emoji Messages doesn't offer on that
 * message falls back to its stand-ins (reactions.ts).
 */
export function axTapbacker(run: RunAx, peek?: (guid: string) => Promise<string>): Tapbacker {
  return {
    anyMessage: true,
    attempts,
    async react(targetGuid, reaction, fits, _chatGuid, _newest, bubble) {
      if (!bubble) throw new NotSentError("NOT_SENT: tab-ax needs the message's text and time");
      const tries = attempts(reaction).map(actionFor);
      const epoch = String(Math.round(bubble.sentAt.getTime() / 1000));
      await withChatTitle(
        targetGuid,
        fits,
        async (title) => {
          const used = await run(["react", targetGuid, title, bubble.text, epoch, bubble.fromMe ? "1" : "0", ...tries], 10_000);
          if (!reactionForAction(used)) throw new Error(`tab-ax used an unknown action: ${used}`);
        },
        peek,
      );
    },
  };
}
