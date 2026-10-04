/** Sends text as an inline (threaded) reply to a message, identified by its chat.db guid. */
export interface Replier {
  reply(targetGuid: string, text: string): Promise<void>;
}

const SCRIPT = `
on run argv
  set targetGuid to item 1 of argv
  set body to item 2 of argv
  tell application "System Events" to set previousApp to name of first application process whose frontmost is true
  set savedClipboard to missing value
  try
    set savedClipboard to the clipboard
  end try
  set the clipboard to body
  open location "sms://open?message-guid=" & targetGuid
  tell application "Messages" to activate
  tell application "System Events" to tell process "Messages"
    set ready to false
    repeat 30 times
      set replyItems to (menu items of menu 1 of menu bar item "Edit" of menu bar 1 whose name starts with "Reply to" and enabled is true)
      if frontmost and (count of replyItems) > 0 then
        set replyItem to item 1 of replyItems
        set ready to true
        exit repeat
      end if
      delay 0.1
    end repeat
    if not ready then
      if savedClipboard is not missing value then set the clipboard to savedClipboard
      error "Messages has no enabled Reply menu item for this message"
    end if
    click replyItem
    delay 0.5
    if not frontmost then error "Messages lost focus before the reply was sent"
    keystroke "v" using command down
    delay 0.3
    keystroke return
  end tell
  delay 0.5
  if savedClipboard is not missing value then set the clipboard to savedClipboard
  if previousApp is not "Messages" then
    tell application "System Events" to set frontmost of process previousApp to true
  end if
end run`;

/**
 * Messages has no scripting API for inline replies, so this drives its UI: open
 * the message's chat by guid, choose Edit → Reply to Last Message…, paste the
 * text (restoring the clipboard afterwards), and press Return. Like tapbacks,
 * Messages replies to the chat's newest message, so the bridge only uses this
 * while the target is still the newest. Needs Accessibility permission.
 */
export function uiReplier(): Replier {
  const lines = SCRIPT.trim().split("\n").flatMap((line) => ["-e", line]);
  return {
    async reply(targetGuid, text) {
      const proc = Bun.spawn(["osascript", ...lines, targetGuid, text], { stdout: "ignore", stderr: "pipe" });
      const timer = setTimeout(() => proc.kill(), 20_000);
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      clearTimeout(timer);
      if (code !== 0) throw new Error(`reply script exited ${code}: ${stderr.trim()}`);
    },
  };
}
