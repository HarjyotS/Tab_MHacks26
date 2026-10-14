# Running Tab on a Mac server

This is the checklist for putting Tab on an always-on Mac (a cloud Mac or a Mac mini) so it texts from its own number. It takes about an hour. Once it's done, every push to `main` deploys itself.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Messages.app | the Mac | Signed into Tab's Apple ID. This is how Tab texts. |
| Bridge (`client/`, Bun) | the Mac | Reads the Messages database, sends texts and tapbacks, serves photos and their on-device text. |
| Backend (`backend/`, Node) | the Mac | The brain: the screener (Jev), Grok, splits, reminders. |
| Auto-updater (`ops/update.sh`) | the Mac | Every 2 minutes: pulls `main`, runs the tests, restarts what changed. |
| SpacetimeDB | Maincloud (cloud) | The database. Already running, nothing to install. |

All four Mac pieces run as launchd services (macOS's built-in service manager). They start at login, restart if they crash, and log to `~/Library/Logs/tab/`.

## 1. Before you start

You need:

- **The Mac.** A cloud Mac with at least 4 GB of RAM, or a Mac mini. macOS 15 or newer. You need remote desktop access to it (Screen Sharing / VNC), not just SSH. Some steps are clicks in System Settings, and Messages needs a real logged-in desktop.
- **Tab's Apple ID.** A fresh Apple ID just for Tab, not anyone's personal one.
- **Tab's phone number.** An iPhone (any used one works) with a prepaid SIM, signed into Tab's Apple ID. Without it, Tab can only text from the Apple ID's email address.
- **The keys, from Harjyot, privately.** Use a password manager share or Signal, never email or Slack:
  - `XAI_API_KEY` (Grok)
  - `TYPESAFE_API_KEY` (Jev, the screener)
  - `LEDGER_LINK_KEY` (web ledger links)
  - `BACKEND_SPACETIME_TOKEN` and `SPACETIME_CLIENT_TOKEN`: the backend's and bridge's database identities. They already have their database roles, so reusing them skips step 9.

> Only one copy of Tab may run at a time. Once this server is up, Harjyot's laptop must not run the bridge or backend against Maincloud, or every message gets answered twice.

## 2. Mac settings

In **System Settings**:

1. **Users & Groups → Automatically log in as**: the user Tab runs as. After a reboot, Messages and the services need a logged-in desktop.
2. **Lock Screen**: turn the screen saver off, set "Require password after screen saver" to **Never**, and set "Turn display off" to **Never**. Tapbacks click through Messages, which doesn't work on a locked screen.
3. **Energy** (or Battery → Options on a laptop): turn on "Prevent automatic sleeping" and "Start up automatically after a power failure" if they're offered. The `app.tab.awake` service keeps it awake too.
4. **General → Software Update → Automatic Updates**: turn off "Install macOS updates". A surprise restart takes Tab offline, so update by hand.
5. **Privacy & Security → FileVault**: on, if the host allows it. The Mac holds group chats.

On a cloud Mac, also check with the host that the desktop session stays unlocked after you disconnect from remote desktop.

## 3. Tab's number

On the **iPhone**:

1. Settings → sign in with Tab's Apple ID.
2. Settings → Apps → Messages → iMessage **on** → Send & Receive: tick the phone number, and set "Start new conversations from" to the number.
3. Keep it plugged in, on Wi-Fi, and switched on. Apple checks the number through it now and then.

On the **Mac**:

1. Open Messages, sign in with Tab's Apple ID.
2. Messages → Settings → iMessage: tick the phone number, and set "Start new conversations from" to the number.
3. Messages → Settings → General → **Keep messages: 30 days**. Tab deletes chatter from its own database, but Messages keeps its own copy, so keep that short.
4. Text the number from your own phone. The reply should come from the number, not an email address.

## 4. Install the tools

In Terminal on the Mac:

```sh
xcode-select --install                                   # git and build tools
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 && brew link --overwrite node@22    # Node 22+
curl -fsSL https://bun.sh/install | bash                 # Bun
exec zsh                                                 # pick up the new PATH
node --version && bun --version
```

Get the code (the repo is public, so no login needed):

```sh
git clone https://github.com/HarjyotS/Tab_MHacks26.git ~/tab
cd ~/tab
npm ci
(cd client && bun install --frozen-lockfile)
```

## 5. Settings files

Two files, both gitignored. Fill in the keys from step 1.

**`~/tab/.env`** (the backend):

```sh
SPACETIME_HOST=https://maincloud.spacetimedb.com
SPACETIME_DB=tabmhacks2026-268xk
BACKEND_SPACETIME_TOKEN=          # from Harjyot
XAI_API_KEY=                      # from Harjyot
TYPESAFE_API_KEY=                 # from Harjyot
LEDGER_BASE_URL=https://tab-ledger.vercel.app
LEDGER_LINK_KEY=                  # from Harjyot
```

Leave `DEMO_MODE` and `PAYMENTS` out. The defaults are real timing and real payment links.

**`~/tab/client/.env`** (the bridge):

```sh
TAB_PHONE=+1XXXXXXXXXX            # Tab's number, with +1
TAB_NAME=Tab
HUB=spacetime
ECHO=0
SPACETIME_HOST=https://maincloud.spacetimedb.com
SPACETIME_DB=tabmhacks2026-268xk
SPACETIME_CLIENT_TOKEN=           # from Harjyot
GROUP_TIMEZONE=America/Detroit
```

Then lock them down: `chmod 600 ~/tab/.env ~/tab/client/.env`.

## 6. Give bun its permissions

The bridge runs as `bun`, so macOS's permissions go to the bun program itself. In **System Settings → Privacy & Security**:

1. **Full Disk Access**: press +, then Cmd+Shift+G, paste `~/.bun/bin/bun`, and add it. This lets it read the Messages database.
2. **Accessibility**: add `~/.bun/bin/bun` the same way. This is for tapbacks and inline replies.
3. Also add **Terminal** to both lists, for the first run by hand in step 7.

**Automation** (bun controlling Messages) can't be added in advance. macOS asks the first time the bridge sends, so click **Allow** in step 7. After a bun upgrade macOS may ask again. If sends start failing, check Privacy & Security → Automation.

## 7. First run, by hand

This shakes out permissions while you can see the prompts. Use two Terminal windows:

```sh
cd ~/tab/client && bun start      # window 1: the bridge
cd ~/tab/backend && DOTENV_CONFIG_PATH=../.env npm start   # window 2: the backend
```

- The bridge should print `Tab bridge up...`. If it says `authorization denied` on chat.db, Full Disk Access is missing (step 6).
- The backend should log `connected` and then `running`. If it logs `no_rows_visible`, its token is wrong or lacks the backend role (step 9).

Now check the bridge itself with no AI involved, using a throwaway test group. Stop the bridge (Ctrl+C), then run it with the dev hub:

```sh
cd ~/tab/client && HUB=dev ECHO=1 bun start
```

From the iPhone (Tab's phone), text `/tab on` into a test group with you in it. Then, from your own phone, try `@tab ping` (Tab replies "pong") and `@tab like` (Tab tapbacks your message). When macOS asks to let bun control Messages, click **Allow**. If tapbacks fail, run `bun run tapback-probe` and see Troubleshooting.

Stop both windows with Ctrl+C when it all works.

## 8. Install the services

```sh
cd ~/tab && ops/install.sh
ops/status.sh
```

`status.sh` should show all four services running, the bridge health answering, and the commit you're on. From now on you don't start anything by hand. It all comes back after a reboot or a crash.

## 9. Database roles (only with new identities)

Skip this if you used the two tokens from Harjyot. Otherwise, leave the token lines out of the `.env` files:

- The bridge then makes its own identity, logs it, and saves the token in `client/.state/`.
- The backend logs `save_token` with a `BACKEND_SPACETIME_TOKEN=...` line. Put that line in `~/tab/.env`.

Send both identities to the database owner (whoever published the database, Harjyot or Kien), who runs:

```sh
spacetime call tabmhacks2026-268xk grant_service_role <bridge-identity> client --server maincloud
spacetime call tabmhacks2026-268xk grant_service_role <backend-identity> backend --server maincloud
```

Then run `ops/update.sh --restart`.

## 10. Turn Tab on in a group

Add Tab's number to the group chat, then text `/tab on` into the group **from the iPhone** (Tab's own phone). Tab introduces itself and asks for names. `/tab off` switches it off. Tab only reads groups it's been switched on in, plus DMs from their members.

## Auto-updates

`app.tab.update` runs `ops/update.sh` every 2 minutes:

1. Fetches `main`. If nothing's new, it stops there.
2. Fast-forwards to the new commit. If someone edited files on the server it refuses, so it never throws away local changes. Don't edit code on the server; push from a laptop instead.
3. Reinstalls packages, only if a lockfile or `package.json` changed.
4. If bot code changed (`backend/`, `client/`, `gate/`, `spacetime/`, packages), runs the backend typecheck and the backend, gate, and client tests.
5. Restarts only what changed: the backend for backend, gate and package changes, the bridge for client changes. Pushes that only touch `site/`, `video/`, or docs restart nothing.
6. If an install or a test fails, it rolls back to the commit that was running, keeps Tab up on it, and skips the bad commit until a newer one lands. The log says why: `FAILED (backend tests): staying on abc1234...`.

So the workflow from a laptop is: merge or push to `main`, and within about 2 minutes, plus a minute for tests, the server is on it. Check with `ops/status.sh` or `tail ~/Library/Logs/tab/update.log`.

`ops/update.sh --restart` restarts the bridge and backend by hand.

### Updating the database

The auto-updater never touches the database schema. That needs the database owner's login, and it should stay off the server. When a change touches `spacetime/src/`, the owner publishes it **before** pushing:

```sh
spacetime publish --server maincloud tabmhacks2026-268xk -p spacetime
```

Adding tables and reducers upgrades in place and keeps the data. If you push first, the new backend may fail against the old module until it's published, and the update log carries a reminder.

## Everyday checks

```sh
cd ~/tab && ops/status.sh                 # services, health, commit, last message handled
tail -f ~/Library/Logs/tab/backend.log    # one JSON line per event, no message text
tail -f ~/Library/Logs/tab/bridge.log
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `status.sh` shows a service stopped with a nonzero last exit | Read its log in `~/Library/Logs/tab/`. Fix, then `ops/update.sh --restart`. |
| Bridge log: `authorization denied` on chat.db | Full Disk Access for `~/.bun/bin/bun` (step 6), then `ops/update.sh --restart`. |
| Sends fail: "Not authorized to send Apple events" | Privacy & Security → Automation: let bun control Messages. |
| Tapbacks fail: "not allowed assistive access" | Accessibility for `~/.bun/bin/bun`. |
| Tapbacks fail: "no enabled Tapback menu item" | The screen is locked or Messages is hidden behind something. Check step 2, and click into Messages once. |
| Backend log: `no_rows_visible` | The backend token is wrong or lacks the backend role (step 9). |
| Tab texts from an email address | The number isn't selected for iMessage on the Mac or iPhone (step 3), or the iPhone has been off for a long time. |
| Every message answered twice | Another copy of Tab is running somewhere (a laptop). Stop it. |
| Update log: `can't fast-forward` | Someone changed files on the server. `cd ~/tab && git status`, then `git stash` or `git reset --hard origin/main` once you're sure nothing there matters. |
| Update log: `FAILED (...)` | The pushed commit broke tests. Fix it on a laptop and push again. The server stays on the last good commit until then. |
| After a macOS update nothing works | The permissions in step 6 may need re-adding, and the services restarting: `ops/install.sh`. |

`ops/install.sh --uninstall` removes all four services.
