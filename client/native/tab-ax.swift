// tab-ax: tapbacks on any message through Messages' accessibility actions.
//
// Each message bubble in Messages (macOS 26) carries accessibility actions:
// the six classic tapbacks ("Heart", "Thumbs up", …), the five most recent
// emoji ("👀", "💸", …), "Reply…" and more. tab-ax opens the message's chat,
// finds that one bubble by its text and time, and runs an action on it: no
// tapback picker, and it works on any message on screen, not just the newest.
//
//   tab-ax react <guid> <window title> <text> <epoch s> <mine 0|1> <action> [fallback action…]
//   (action "?" only finds the bubble and prints it)
//   tab-ax list [window title]
//
// Exit 0: done, prints the action used. Exit 2: nothing happened (stderr says
// why: wrong chat, no such bubble, no such action). Exit 1: anything else.
// Built by ops/install.sh and ops/update.sh with swiftc; needs the
// Accessibility permission of the process that runs it (the bridge's bun).

import AppKit
import ApplicationServices

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
func str(_ e: AXUIElement, _ name: String) -> String? { attr(e, name) as? String }
func kids(_ e: AXUIElement) -> [AXUIElement] { attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func actionNames(_ e: AXUIElement) -> [String] {
  var names: CFArray?
  return AXUIElementCopyActionNames(e, &names) == .success ? (names as? [String] ?? []) : []
}
// Custom actions are named "Name:Thumbs up\nTarget:0x0\nSelector:(null)".
func label(_ action: String) -> String? {
  guard action.hasPrefix("Name:") else { return nil }
  return action.dropFirst(5).split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init)
}
// Attachments stay as U+FFFC, the same mark chat.db and the labels use.
func norm(_ s: String) -> String {
  s.replacingOccurrences(of: "\u{2019}", with: "'").replacingOccurrences(of: "\u{2018}", with: "'")
    .replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
    .lowercased().components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
}
func fail(_ code: Int32, _ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(code)
}

func find(_ e: AXUIElement, id: String, depth: Int = 0) -> AXUIElement? {
  if str(e, kAXIdentifierAttribute) == id { return e }
  if depth > 12 { return nil }
  for k in kids(e) { if let f = find(k, id: id, depth: depth + 1) { return f } }
  return nil
}
// A bubble is the element with a description like "Maybe: Dhanush Ekollu,
// ok bet, 2:00 PM" ("Your iMessage, …" for Tab's own, "…, ￼, …" for a photo)
// that carries the tapback actions. A reply's quote of its parent ("…, Reply
// Preview, <parent text>, …") is one too, and is never the message itself.
func bubbles(_ e: AXUIElement, depth: Int = 0, into out: inout [(AXUIElement, String)]) {
  if let d = str(e, kAXDescriptionAttribute), actionNames(e).contains(where: { label($0) == "Thumbs up" }) {
    if !norm(d).contains(", reply preview, ") { out.append((e, d)) }
    return
  }
  if depth > 4 { return }
  for k in kids(e) { bubbles(k, depth: depth + 1, into: &out) }
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail(1, "usage: tab-ax react|list …") }
guard AXIsProcessTrusted() else { fail(2, "NOT_SENT: tab-ax has no Accessibility permission") }
guard let messages = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.MobileSMS").first else {
  fail(2, "NOT_SENT: Messages isn't running")
}
let app = AXUIElementCreateApplication(messages.processIdentifier)
AXUIElementSetMessagingTimeout(app, 3)
// Messages only builds its full tree (the transcript's bubbles) for assistive apps that ask.
AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

func window(titled title: String?) -> AXUIElement? {
  let wins = attr(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
  guard let title else { return wins.first }
  return wins.first { str($0, kAXTitleAttribute) == title }
}
func bubblesIn(_ win: AXUIElement) -> [(AXUIElement, String)] {
  guard let transcript = find(win, id: "TranscriptCollectionView") else { return [] }
  var all: [(AXUIElement, String)] = []
  bubbles(transcript, into: &all)
  return all
}

if args[1] == "list" {
  guard let win = window(titled: args.count > 2 ? args[2] : nil) else { fail(2, "NOT_SENT: no such window") }
  print("window:", str(win, kAXTitleAttribute) ?? "")
  for (e, d) in bubblesIn(win) {
    print(d.replacingOccurrences(of: "\n", with: " / "), "|", actionNames(e).compactMap(label).joined(separator: ","))
  }
  exit(0)
}

guard args[1] == "react", args.count >= 8 else { fail(1, "usage: tab-ax react <guid> <title> <text> <epoch> <mine> <action> [fallback…]") }
let guid = args[2], title = args[3], text = norm(args[4]), mine = args[6] == "1"
let wanted = Array(args[7...])
let fmt = DateFormatter()
fmt.locale = Locale.current
fmt.dateFormat = DateFormatter.dateFormat(fromTemplate: "jmm", options: 0, locale: Locale.current)
let time = norm(fmt.string(from: Date(timeIntervalSince1970: Double(args[5]) ?? 0)))

// The bubbles whose description is "<sender>, <text>, …" with this text,
// from the right side. A photo alone is "￼", so photos match by side and time.
func matching(_ all: [(AXUIElement, String)]) -> [(AXUIElement, String)] {
  guard !text.isEmpty else { return [] }
  return all.filter { (_, d) in
    let n = norm(d)
    guard n.hasPrefix("your imessage, ") == mine else { return false }
    return n.contains(", " + text + ",") || n.hasSuffix(", " + text)
  }
}

// Open the chat at that message, then wait for its window and bubble.
guard let url = URL(string: "sms://open?message-guid=\(guid)") else { fail(1, "bad guid") }
NSWorkspace.shared.open(url)
messages.activate()
var pick: (AXUIElement, String)?
var seen = "nothing"
let deadline = Date().addingTimeInterval(5)
while Date() < deadline {
  if let win = window(titled: title) {
    let found = matching(bubblesIn(win))
    // Two bubbles with the same text from the same side: the time decides, or nothing does.
    let timed = found.filter { norm($0.1).contains(time) }
    if found.count == 1 { pick = found[0]; break }
    if timed.count == 1 { pick = timed[0]; break }
    seen = "\(found.count) bubbles with that text (\(timed.count) at \(time))"
  } else {
    seen = "no window titled \(title)"
  }
  usleep(150_000)
}
guard let (bubble, desc) = pick else { fail(2, "NOT_SENT: \(seen)") }
let available = actionNames(bubble)
// "?" finds the bubble and stops: a dry run.
if wanted == ["?"] {
  print(desc.replacingOccurrences(of: "\n", with: " / "), "|", available.compactMap(label).joined(separator: ","))
  exit(0)
}
for w in wanted {
  guard let action = available.first(where: { label($0) == w }) else { continue }
  let r = AXUIElementPerformAction(bubble, action as CFString)
  if r != .success { fail(1, "\(w) returned AX error \(r.rawValue)") }
  print(w)
  exit(0)
}
fail(2, "NOT_SENT: no \(wanted.joined(separator: " or ")) on that message; it offers " + available.compactMap(label).joined(separator: ","))
