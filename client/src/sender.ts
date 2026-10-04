import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { attachment, Spectrum, text } from "spectrum-ts";
import { localIMessage } from "@spectrum-ts/imessage-local";

export type Target = { kind: "group"; chatGuid: string } | { kind: "dm"; handle: string };
export type Outgoing = { text: string } | { file: { name: string; data: Buffer; mimeType: string } };

/** Resolves once Messages.app accepts the send, not when it's delivered. */
export interface Sender {
  send(target: Target, content: Outgoing): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Sends through Photon Spectrum's local iMessage provider. Group chats work
 * because Messages.app on this Mac is signed in as Tab and is already a member.
 */
export async function spectrumSender(): Promise<Sender> {
  const app = await Spectrum({ providers: [localIMessage.config()], telemetry: false });
  const im = localIMessage(app);
  return {
    async send(target, content) {
      const space = await im.space.get(target.kind === "group" ? target.chatGuid : `any;-;${target.handle}`);
      await space.send(
        "text" in content
          ? text(content.text)
          : attachment(content.file.data, { name: content.file.name, mimeType: content.file.mimeType }),
      );
    },
    stop: () => app.stop(),
  };
}

const GROUP_SCRIPT = ["on run argv", 'tell application "Messages" to send (item 2 of argv) to chat id (item 1 of argv)', "end run"];
const DM_SCRIPT = [
  "on run argv",
  'tell application "Messages"',
  "set svc to 1st service whose service type = iMessage",
  "send (item 2 of argv) to buddy (item 1 of argv) of svc",
  "end tell",
  "end run",
];
const GROUP_FILE_SCRIPT = [
  "on run argv",
  'tell application "Messages" to send (POSIX file (item 2 of argv)) to chat id (item 1 of argv)',
  "end run",
];
const DM_FILE_SCRIPT = [
  "on run argv",
  'tell application "Messages"',
  "set svc to 1st service whose service type = iMessage",
  "send (POSIX file (item 2 of argv)) to buddy (item 1 of argv) of svc",
  "end tell",
  "end run",
];

/**
 * Fallback that drives Messages.app with AppleScript directly (SEND_VIA=osascript),
 * in case Spectrum misbehaves on the demo machine. Text goes in as an argument,
 * so nothing needs escaping.
 */
export function osascriptSender(): Sender {
  // Messages.app can only attach files from a few sandbox-safe folders.
  const fileDir = join(homedir(), "Pictures", "tab-bridge");
  return {
    async send(target, content) {
      const id = target.kind === "group" ? target.chatGuid : target.handle;
      if ("text" in content) {
        await osascript(target.kind === "group" ? GROUP_SCRIPT : DM_SCRIPT, [id, content.text]);
        return;
      }
      mkdirSync(fileDir, { recursive: true });
      const path = join(fileDir, content.file.name);
      writeFileSync(path, content.file.data);
      await osascript(target.kind === "group" ? GROUP_FILE_SCRIPT : DM_FILE_SCRIPT, [id, path]);
    },
    stop: async () => {},
  };
}

async function osascript(lines: string[], args: string[]): Promise<void> {
  const proc = Bun.spawn(["osascript", ...lines.flatMap((l) => ["-e", l]), ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 30_000);
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`osascript exited ${code}: ${stderr.trim()}`);
}

/**
 * Payment confirmations go out through Photon's hosted iMessage line
 * (Spectrum cloud, the project's credentials) instead of this Mac's
 * Messages.app. Group chats stay on the local provider.
 */
export async function photonDmSender(projectId: string, projectSecret: string): Promise<{ send(handle: string, body: string): Promise<void>; stop(): Promise<void> }> {
  const { imessage } = await import("@spectrum-ts/imessage");
  const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()], telemetry: false });
  const im = imessage(app);
  return {
    async send(handle, body) {
      const space = await im.space.get(`any;-;${handle}`);
      await space.send(text(body));
    },
    stop: () => app.stop(),
  };
}

