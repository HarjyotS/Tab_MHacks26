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
  set opened to false
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
      set opened to true
      delay 0.4
      if not frontmost or name of window 1 is not chatTitle then error "NOT_SENT: Messages lost focus or switched chats"
      ${finalKeys.join("\n      ")}
    end tell
  on error errMsg
    -- The tapback picker (or reply field) is still open: close it, or it
    -- blocks every later tapback and reply (live run).
    if opened then
      try
        tell application "System Events" to key code 53
      end try
    end if
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

/**
 * Opens the message's chat and returns Messages' window title once it has
 * held still for 0.3s. Sends nothing. The title isn't always the chat's name:
 * on Tab's own Mac, with no contacts saved, a group shows its members
 * ("Maybe: Harjyot Sahni, +1 (408) 310-3927 & …"), so callers check it with
 * titleFits.
 */
const PEEK = `
on run argv
  open location "sms://open?message-guid=" & (item 1 of argv)
  tell application "Messages" to activate
  tell application "System Events" to tell process "Messages"
    set lastTitle to ""
    set steady to 0
    repeat 40 times
      if frontmost and (count of windows) > 0 then
        set t to name of window 1
        if t is lastTitle then
          set steady to steady + 1
          if steady is 3 then return t
        else
          set lastTitle to t
          set steady to 0
        end if
      end if
      delay 0.1
    end repeat
  end tell
  error "NOT_SENT: Messages didn't open the chat"
end run`.trim().split("\n").flatMap((line) => ["-e", line]);

export async function peekTitle(targetGuid: string, timeoutMs = 6_000): Promise<string> {
  const proc = Bun.spawn(["osascript", ...PEEK, targetGuid], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new NotSentError(err.trim() || `NOT_SENT: couldn't read Messages' window (exit ${code})`);
  return out.trim();
}

const digits = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};

/**
 * Whether Messages' window title shows this chat: its name, or its members
 * the way Messages lists them when it has no name for the chat (comma and
 * "&" separated, numbers formatted, contacts it knows as names). Every
 * number shown must be a member's, and there must be one entry per member.
 */
export function titleFits(title: string, chat: { name: string | null; handles: string[] }): boolean {
  if (chat.name && title === chat.name) return true;
  const guessed = /^Maybe:\s*/i.test(title);
  const entries = title
    .replace(/^Maybe:\s*/i, "")
    .split(/,\s*|\s+&\s+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0 || entries.length !== chat.handles.length) return false;
  const numbers = new Set(chat.handles.map(digits).filter(Boolean));
  const emails = new Set(chat.handles.filter((h) => h.includes("@")).map((h) => h.toLowerCase()));
  let checked = 0;
  for (const e of entries) {
    if (e.includes("@")) {
      if (!emails.delete(e.toLowerCase())) return false;
      checked++;
    } else if (digits(e)) {
      if (!numbers.delete(digits(e))) return false;
      checked++;
    }
    // Anything else is a name Messages has for one of the others.
  }
  // Names alone prove nothing ("the house" is another chat's name): at least
  // one number or email has to match, or Messages has to be guessing names
  // for unknown numbers ("Maybe: Sam Lee"), which a named chat never shows.
  return checked > 0 || guessed;
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
