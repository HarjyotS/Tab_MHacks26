# Tab client: the iMessage bridge

Photon Spectrum's cloud lines can't join group chats on the free and Pro plans: shared-pool numbers can neither create groups nor receive group events, and that takes a paid dedicated line. So Tab runs on a Mac signed into its own iMessage account (for the hackathon, Harjyot's MacBook and number), and this service bridges that Mac to SpacetimeDB.

| Direction | How |
|---|---|
| Inbound | Reads `~/Library/Messages/chat.db` (read-only) every 500 ms. Texts, receipt photos, tapbacks, threaded replies, and members joining or leaving all become `ingest_message` calls. |
| Hub | `HUB=spacetime` talks to the SpacetimeDB module; `HUB=dev` is an in-memory stand-in with echo commands for testing without it. |
| Outbound | Sends through Spectrum's local iMessage provider (`@spectrum-ts/imessage-local`), which drives Messages.app. |
| Tapbacks | Messages has no scripting API for tapbacks, so the bridge drives its interface: it opens the chat with an `sms://open?message-guid=` link, chooses Edit → Tapback Last Message…, and presses the picker key. That only works on a chat's newest message, so the bridge skips (and marks `failed`) any tapback whose target is no longer the newest. |
| Message ids | AppleScript doesn't return the id of a sent message, so the bridge watches for its own sends to land in chat.db and writes that guid back as `sent_photon_id`. That's what lets a 👍 on Tab's settle request route to the right expense. Tapbacks are confirmed the same way. |

## What works and what doesn't

| Feature | Status |
|---|---|
| Group chats: read and post | ✅ |
| DMs: read and send | ✅, with the privacy gate below |
| Incoming tapbacks (👍 to approve) | ✅ classic six; removed, emoji, and sticker tapbacks are ignored |
| Threaded replies (incoming) | ✅ as `reply_to_id` |
| Receipt photos | ✅ converted from HEIC to JPEG and served from this process |
| Member list and joins/leaves | ✅ from chat.db, as `member_joined` / `member_left` system messages |
| Contact card | ✅ sent as a `Tab.vcf` file |
| Sending tapbacks | ✅ by driving Messages' interface, on the chat's newest message only. Brings Messages to the front for about a second, then hands focus back. Each one counts as `sent` only once chat.db shows it on the right message. Tested on macOS 15.1. |
| Threaded replies (outgoing) | ❌ sent as a normal message |
| Typing indicator | ❌ |
| Android / SMS groups | ❌ iMessage groups only |

## Privacy gate

chat.db holds every conversation on the account, so the bridge only looks at:

- **Group chats switched on with `/tab on`**, texted into the group from Tab's own phone (or listed in `TAB_GROUP_IDS`). `/tab off` switches it back off.
- **DMs from members of those groups**, and only if Tab DMed that person within `DM_REPLY_WINDOW_HOURS` (default 72) or the message starts with "tab" or "@tab".

The bridge also refuses to post anywhere else: outbox rows aimed at other groups or non-members are marked `failed`. Message text is never written to disk.

Because Tab *is* this phone number, anything typed by hand from that phone looks like Tab, so the bridge ignores it. Don't use Tab's phone as a group member in the demo.

## Setup on the Tab Mac

1. Sign Messages.app into Tab's Apple ID (for the hackathon, it's already signed in) and leave it open.
2. Give your terminal app **Full Disk Access**: System Settings → Privacy & Security → Full Disk Access. Quit and reopen the terminal afterwards.
3. Install and start the bridge:
   ```sh
   cd client
   cp .env.example .env      # set TAB_PHONE
   bun install
   bun start
   ```
4. The first send asks to let your terminal control Messages. Allow it. For tapbacks, also add your terminal under System Settings → Privacy & Security → **Accessibility**.
5. In the group chat, text `/tab on` from Tab's phone. The bridge logs `Tab is on in iMessage;+;chat…` and ingests one `member_joined` per participant.

The first run starts from the newest message, so history is never replayed. State lives in `client/.state/`.

## Testing without the backend

With `HUB=dev` (the default) and `ECHO=1`, type these into an enabled group from another phone:

| Message | Tab does |
|---|---|
| `@tab ping` | Replies "pong" in the group |
| `@tab dm` | DMs you "pong, privately" |
| `@tab card` | Sends its contact card |
| `@tab like` | Tapbacks 👍 on that message |

Then tapback the "pong". The log should say `like is on Tab's other "pong"`, which proves tapbacks route back to Tab's messages.

Teammates can queue sends with curl too:

```sh
curl -X POST localhost:8787/dev/outbox -H 'content-type: application/json' \
  -d '{"kind":"group_message","group_id":"iMessage;+;chat123…","text":"hello from the backend"}'
```

`bun run tapback-probe` tapbacks 👍 on the newest incoming message in an enabled group and checks chat.db to confirm it landed there. Run it once in the test group before relying on tapbacks. `bun run chats` lists recent group chats with their guids. `bun test` runs the tests against a fake chat.db.

## Connecting to SpacetimeDB

Set `HUB=spacetime` (plus `SPACETIME_HOST` and `SPACETIME_DB`) to use the real module instead of DevHub. The client calls `ingest_message` and `mark_outbox`, and reads its work from the `client_outbox` view.

1. Start the bridge once. It creates its own SpacetimeDB identity, saves the token in `.state/spacetime-token`, and logs the identity.
2. The module owner grants that identity the client role from the repo root:
   ```sh
   npm run grant:role -- <identity> client
   ```
3. Until then, ingests are refused and the outbox looks empty. That's expected.

After the module changes, regenerate bindings with `npm run bindings` from the repo root (it now includes `client/`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Can't open …/chat.db: authorization denied` | Full Disk Access isn't granted to the app running `bun`. Grant it, then restart that app. |
| Sends fail with "Not authorized to send Apple events" | System Settings → Privacy & Security → Automation: let your terminal control Messages. |
| Spectrum errors on send | Set `SEND_VIA=osascript` to drive Messages.app directly. |
| Tapbacks fail with "no longer the newest message" | Someone posted after the target before Tab reacted. Expected now and then; nothing depends on Tab's tapbacks. |
| Tapbacks fail with "no enabled Tapback menu item" | Messages didn't open the chat. Click into it once and retry, or set `TAPBACK_MODE=off`. |
| Tapbacks fail with "not allowed assistive access" | Add your terminal under Privacy & Security → Accessibility. |
| The log says `unrequested like from Tab's account` | A tapback landed on the wrong message, or someone tapped one by hand from Tab's phone. Remove it by hand. |
| Don't type on the Mac while a tapback is going out | The bridge presses a key in Messages. It checks that Messages is in front first, but typing at that exact moment can race it. |
| `sent, but never showed up in chat.db` | Messages.app accepted the send but didn't write it within 15 s. Check that Messages is signed in and the chat still exists. |
| The backend can't fetch receipt images | Set `IMAGE_BASE_URL` to an address the backend can reach (LAN IP, or a tunnel such as cloudflared). |
