// Tapbacks the newest incoming message in an enabled group, then checks chat.db
// to confirm it landed on that message. Usage: bun run tapback-probe [like|love|…]
import { ChatDb } from "./chatdb.ts";
import { config } from "./config.ts";
import { messageText, reactionTarget, tapback } from "./decode.ts";
import { State } from "./state.ts";
import { uiTapbacker } from "./tapback.ts";
import type { Reaction } from "./types.ts";

const reaction = (process.argv[2] ?? "like") as Reaction;
const db = new ChatDb(config.chatDbPath);
const groups = new State(config.statePath).data.enabledGroups;
const target = db.latestIncoming(groups);
if (!target) {
  console.error(groups.length ? "No incoming messages in the enabled groups yet." : 'No enabled groups. Text "/tab on" first.');
  process.exit(1);
}

console.log(`Target: "${messageText(target).slice(0, 40)}" from ${target.handle} (${target.guid})`);
if (db.latestInChat(target.chat_guid!)?.guid !== target.guid) {
  console.error("Something newer was sent in that chat, and Messages only tapbacks the newest message. Have someone send a message, then rerun.");
  process.exit(1);
}
const before = db.maxRowId();
const started = Date.now();
try {
  await uiTapbacker().react(target.guid, reaction);
} catch (err) {
  console.error(`The UI script failed after ${Date.now() - started} ms: ${err}`);
  process.exit(1);
}
console.log(`UI script finished in ${Date.now() - started} ms. Checking chat.db…`);

for (let i = 0; i < 40; i++) {
  for (const row of db.messagesAfter(before, 50)) {
    const kind = tapback(row.associated_message_type);
    if (!row.is_from_me || !kind) continue;
    const on = reactionTarget(row.associated_message_guid);
    console.log(
      on === target.guid && kind === reaction
        ? `✅ ${kind} landed on the target.`
        : `❌ A ${kind} landed on ${on}, not ${reaction} on ${target.guid}. Undo it by hand.`,
    );
    process.exit(on === target.guid ? 0 : 1);
  }
  await Bun.sleep(200);
}
console.log("❌ No tapback from Tab's account showed up in chat.db.");
process.exit(1);
