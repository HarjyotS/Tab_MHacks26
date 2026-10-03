// Lists recent group chats so you can find a guid for TAB_GROUP_IDS. Local only.
import { ChatDb } from "./chatdb.ts";
import { config } from "./config.ts";

const db = new ChatDb(config.chatDbPath);
for (const chat of db.recentGroups(15)) {
  const when = chat.last_message_at?.toISOString().slice(0, 16).replace("T", " ") ?? "never";
  console.log(`${chat.guid}  ${chat.display_name ?? "(unnamed)"}  ${chat.participants} people  last ${when}`);
}
db.close();
