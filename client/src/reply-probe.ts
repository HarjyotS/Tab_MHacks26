// Replies in thread to the newest incoming message in an enabled group, then checks
// chat.db to confirm the reply landed in that message's thread.
// Usage: bun run reply-probe ["text"]
import { ChatDb } from "./chatdb.ts";
import { config } from "./config.ts";
import { messageText } from "./decode.ts";
import { uiReplier } from "./reply.ts";
import { State } from "./state.ts";

const text = process.argv[2] ?? "(Tab test: this should appear as a threaded reply)";
const db = new ChatDb(config.chatDbPath);
const groups = new State(config.statePath).data.enabledGroups;
const target = db.latestIncoming(groups);
if (!target) {
  console.error(groups.length ? "No incoming messages in the enabled groups yet." : 'No enabled groups. Text "/tab on" first.');
  process.exit(1);
}
console.log(`Target: "${messageText(target).slice(0, 40)}" from ${target.handle} (${target.guid})`);
if (db.latestInChat(target.chat_guid!)?.guid !== target.guid) {
  console.error("Something newer was sent in that chat, and Messages only replies to the newest message. Have someone send a message, then rerun.");
  process.exit(1);
}
const before = db.maxRowId();
try {
  await uiReplier().reply(target.guid, text);
} catch (err) {
  console.error(`The UI script failed: ${err}`);
  process.exit(1);
}
for (let i = 0; i < 40; i++) {
  const mine = db.messagesAfter(before, 50).find((r) => r.is_from_me && messageText(r) === text.trim());
  if (mine) {
    console.log(mine.thread_originator_guid === target.guid ? "✅ Reply landed in the target's thread." : `❌ Sent, but not threaded (thread: ${mine.thread_originator_guid ?? "none"}).`);
    process.exit(mine.thread_originator_guid === target.guid ? 0 : 1);
  }
  await Bun.sleep(200);
}
console.log("❌ The reply never showed up in chat.db.");
process.exit(1);
