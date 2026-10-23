// Puts Tab's reaction emoji (TAB_EMOJI) first in macOS's recent emoji, then
// restarts Messages, so every message bubble offers each one as an
// accessibility action for tab-ax. Run once on Tab's Mac (ops/install.sh
// does), and again if Tab's emoji start going out as their stand-ins.
//   bun run seed-emoji
import { TAB_EMOJI } from "./reactions.ts";

const DOMAIN = "com.apple.EmojiPreferences";
const run = (cmd: string[], stdin?: Uint8Array) => {
  const p = Bun.spawnSync(cmd, { stdin });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout;
};

type Prefs = { EMFDefaultsKey?: { EMFRecentsKey?: string[]; EMFUsageHistoryKey?: Record<string, number[]>; EMFRecentSequenceNumberKey?: number } };
const exported = Bun.spawnSync(["defaults", "export", DOMAIN, "-"]).stdout;
const prefs: Prefs = exported.length ? JSON.parse(run(["plutil", "-convert", "json", "-o", "-", "-"], exported).toString()) : {};
const k = (prefs.EMFDefaultsKey ??= {});
const ours: string[] = [...TAB_EMOJI];
k.EMFRecentsKey = [...ours, ...(k.EMFRecentsKey ?? []).filter((e) => !ours.includes(e))];
const history = (k.EMFUsageHistoryKey ??= {});
let seq = k.EMFRecentSequenceNumberKey ?? 0;
for (const e of [...ours].reverse()) history[e] = [...(history[e] ?? []), ++seq].slice(-10);
k.EMFRecentSequenceNumberKey = seq;
run(["defaults", "import", DOMAIN, "-"], run(["plutil", "-convert", "xml1", "-o", "-", "-"], Buffer.from(JSON.stringify(prefs))));
console.log(`recent emoji: ${k.EMFRecentsKey.slice(0, 8).join(" ")}`);

// Messages reads them when it starts.
Bun.spawnSync(["osascript", "-e", 'if application "Messages" is running then quit app "Messages"']);
await Bun.sleep(2_000);
run(["open", "-ga", "Messages"]);
console.log("restarted Messages");
