import type { Reaction } from "./types.ts";

/** Sends a tapback on a message, identified by its chat.db guid. */
export interface Tapbacker {
  react(targetGuid: string, reaction: Reaction): Promise<void>;
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

const SCRIPT = `
on run argv
  set targetGuid to item 1 of argv
  set pickerKey to item 2 of argv
  tell application "System Events" to set previousApp to name of first application process whose frontmost is true
  open location "sms://open?message-guid=" & targetGuid
  tell application "Messages" to activate
  tell application "System Events" to tell process "Messages"
    set ready to false
    repeat 30 times
      set tapbackItems to (menu items of menu 1 of menu bar item "Edit" of menu bar 1 whose name starts with "Tapback" and enabled is true)
      if frontmost and (count of tapbackItems) > 0 then
        set tapbackItem to item 1 of tapbackItems
        set ready to true
        exit repeat
      end if
      delay 0.1
    end repeat
    if not ready then error "Messages has no enabled Tapback menu item for this message"
    click tapbackItem
    delay 0.4
    if not frontmost then error "Messages lost focus before the tapback was chosen"
    keystroke pickerKey
  end tell
  delay 0.2
  if previousApp is not "Messages" then
    tell application "System Events" to set frontmost of process previousApp to true
  end if
end run`;

/**
 * Messages has no scripting API for tapbacks, so this drives its UI: open the
 * message's chat by guid, choose Edit → Tapback Last Message… (or Tapback
 * Message… if one is selected), press the picker key, then hand focus back to
 * whatever app was in front. Messages reacts to the chat's newest message, so
 * callers must check the target is still the newest. Needs Accessibility permission
 * for the app running the bridge. The bridge confirms the result in chat.db.
 */
export function uiTapbacker(): Tapbacker {
  const lines = SCRIPT.trim().split("\n").flatMap((line) => ["-e", line]);
  return {
    async react(targetGuid, reaction) {
      const proc = Bun.spawn(["osascript", ...lines, targetGuid, PICKER_KEY[reaction]], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill(), 15_000);
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      clearTimeout(timer);
      if (code !== 0) throw new Error(`tapback script exited ${code}: ${stderr.trim()}`);
    },
  };
}
