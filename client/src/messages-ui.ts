// Shared AppleScript plumbing for actions that drive Messages' UI (tapbacks and
// inline replies). Messages has no scripting API for either, so the bridge opens
// the target's chat, waits until Messages shows exactly that chat (its window
// title is the chat's name), picks an Edit menu item, and presses keys.
//
// Errors raised before the final keystroke start with NOT_SENT, so the caller
// knows nothing reached the chat and can fall back safely. Cleanup after the
// final keystroke never throws.

/** Thrown when the UI action certainly didn't send anything. */
export class NotSentError extends Error {}

/**
 * Builds a script that: saves the clipboard (when `paste` is set), opens the
 * chat for argv[1] (a message guid), waits for the window title to equal
 * argv[2] (the chat name) and for an enabled Edit menu item starting with
 * `menuPrefix`, clicks it, then runs `finalKeys`. argv[3] is the text to paste.
 */
export function uiScript(menuPrefix: string, finalKeys: string[], paste: boolean): string[] {
  return `
on run argv
  set targetGuid to item 1 of argv
  set chatTitle to item 2 of argv
  set savedClipboard to missing value
  tell application "System Events" to set previousApp to name of first application process whose frontmost is true
  try
    ${paste ? `try
      set savedClipboard to the clipboard
    end try
    set the clipboard to (item 3 of argv)` : ""}
    open location "sms://open?message-guid=" & targetGuid
    tell application "Messages" to activate
    tell application "System Events" to tell process "Messages"
      set ready to false
      repeat 40 times
        if frontmost and (count of windows) > 0 then
          if name of window 1 is chatTitle then
            set menuItems to (menu items of menu 1 of menu bar item "Edit" of menu bar 1 whose name starts with "${menuPrefix}" and enabled is true)
            if (count of menuItems) > 0 then
              set ready to true
              exit repeat
            end if
          end if
        end if
        delay 0.1
      end repeat
      if not ready then error "NOT_SENT: Messages didn't show " & chatTitle & " with ${menuPrefix} available"
      click item 1 of menuItems
      delay 0.4
      if not frontmost or name of window 1 is not chatTitle then error "NOT_SENT: Messages lost focus or switched chats"
      ${finalKeys.join("\n      ")}
    end tell
  on error errMsg
    if savedClipboard is not missing value then set the clipboard to savedClipboard
    error errMsg
  end try
  delay 0.4
  try
    if savedClipboard is not missing value then set the clipboard to savedClipboard
  end try
  try
    if previousApp is not "Messages" then tell application "System Events" to set frontmost of process previousApp to true
  end try
end run`.trim().split("\n").flatMap((line) => ["-e", line]);
}

/** Runs a UI script. Throws NotSentError when nothing was sent, Error when unsure. */
export async function runUiScript(lines: string[], args: string[], timeoutMs: number): Promise<void> {
  const proc = Bun.spawn(["osascript", ...lines, ...args], { stdout: "ignore", stderr: "pipe" });
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    proc.kill();
  }, timeoutMs);
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code === 0) return;
  if (!killed && stderr.includes("NOT_SENT")) throw new NotSentError(stderr.trim());
  throw new Error(killed ? `UI script timed out after ${timeoutMs} ms` : `UI script exited ${code}: ${stderr.trim()}`);
}
