# Running Tab on a Mac server

This is the checklist for putting Tab on an always-on Mac (a cloud Mac or a Mac mini) so it texts from its own number. It takes about an hour. Once it's done, every push to `main` deploys itself.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Messages.app | the Mac | Signed into Tab's Apple ID. This is how Tab texts. |
| Bridge (`client/`, Bun) | the Mac | Reads the Messages database, sends texts and tapbacks, serves photos and their on-device text. |
| Backend (`backend/`, Node) | the Mac | The brain: the screener (Jev), Grok, splits, reminders. |
| Auto-updater (`ops/update.sh`) | the Mac | Every 2 minutes: pulls `main`, runs the tests, restarts what changed. |
| SpacetimeDB | Maincloud (cloud) | The database. You create your own (free) in step 5, and you own it. |

All four Mac pieces run as launchd services (macOS's built-in service manager). They start at login, restart if they crash, and log to `~/Library/Logs/tab/`.

## 1. Before you start

You need:

- **The Mac.** A cloud Mac with at least 4 GB of RAM, or a Mac mini. macOS 15 or newer. You need remote desktop access to it (Screen Sharing / VNC), not just SSH. Some steps are clicks in System Settings, and Messages needs a real logged-in desktop.
- **Tab's Apple ID.** A fresh Apple ID just for Tab, not anyone's personal one.
- **Tab's phone number.** An iPhone (any used one works) with a prepaid SIM, signed into Tab's Apple ID. Without it, Tab can only text from the Apple ID's email address.
- **The API keys, from Harjyot, privately** (an encrypted file plus its password by text, or a password manager share; never plain email or Slack):
  - `XAI_API_KEY` (Grok)
  - `TYPESAFE_API_KEY` (Jev, the screener)
- **A GitHub account**, to log in to SpacetimeDB's cloud (Maincloud) in step 5.

> Only one copy of Tab may run at a time. Once this server is up, nobody else runs the bridge or backend, or every message gets answered twice.

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

## 5. Your own database

Tab's database runs on SpacetimeDB's free cloud, Maincloud. You publish your own copy, so you own it: nobody else is needed to update it or to let the bot in.

```sh
curl -sSf https://install.spacetimedb.com | sh            # the spacetime CLI
exec zsh
spacetime version install 2.10.2 && spacetime version use 2.10.2   # the version Tab's module is built with
spacetime login                                            # opens a browser; sign in with GitHub
cd ~/tab
spacetime publish --server maincloud tab-db -p spacetime   # any free name; if taken, try another
spacetime call --server maincloud tab-db claim_module_owner
```

Use your name instead of `tab-db` everywhere below if you picked another. `claim_module_owner` makes your login the database's owner, the only one who can let the bot's two parts in (step 9). It's a fresh database: the hackathon's demo data stays behind.

## 6. Settings files

Two files, both gitignored. If Harjyot sent the encrypted settings file, it holds both with the keys filled in: decrypt it into `~/tab` with the password he texted you,

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ~/Downloads/tab-env.tgz.enc | tar -xzf - -C ~/tab
```

then set `SPACETIME_DB` (step 5's name) and `TAB_PHONE` in them. Otherwise create them:

**`~/tab/.env`** (the backend):

```sh
SPACETIME_HOST=https://maincloud.spacetimedb.com
SPACETIME_DB=tab-db               # your database from step 5
BACKEND_SPACETIME_TOKEN=          # filled in at step 9
XAI_API_KEY=                      # from Harjyot
TYPESAFE_API_KEY=                 # from Harjyot
```

Leave `DEMO_MODE` and `PAYMENTS` out. The defaults are real timing and real payment links. The web ledger links (`LEDGER_BASE_URL`, `LEDGER_LINK_KEY`) stay off until the ledger site points at your database (see "Web ledger" at the end).

**`~/tab/client/.env`** (the bridge):

```sh
TAB_PHONE=+1XXXXXXXXXX            # Tab's number, with +1
TAB_NAME=Tab
HUB=spacetime
ECHO=0
SPACETIME_HOST=https://maincloud.spacetimedb.com
SPACETIME_DB=tab-db               # your database from step 5
GROUP_TIMEZONE=America/Detroit
```

Then lock them down: `chmod 600 ~/tab/.env ~/tab/client/.env`.

## 7. Give bun its permissions

The bridge runs as `bun`, so macOS's permissions go to the bun program itself. In **System Settings → Privacy & Security**:

1. **Full Disk Access**: press +, then Cmd+Shift+G, paste `~/.bun/bin/bun`, and add it. This lets it read the Messages database.
2. **Accessibility**: add `~/.bun/bin/bun` the same way. This is for tapbacks and inline replies.
3. Also add **Terminal** to both lists, for the first run by hand in step 8.

**Automation** (bun controlling Messages) can't be added in advance. macOS asks the first time the bridge sends, so click **Allow** in step 8. After a bun upgrade macOS may ask again. If sends start failing, check Privacy & Security → Automation.

## 8. First run, by hand

This shakes out permissions while you can see the prompts. Use two Terminal windows:

```sh
cd ~/tab/client && bun start      # window 1: the bridge
cd ~/tab/backend && DOTENV_CONFIG_PATH=../.env npm start   # window 2: the backend
```

- The bridge should print `Tab bridge up...` and log its database identity (a long hex string). If it says `authorization denied` on chat.db, Full Disk Access is missing (step 7).
- The backend logs `connected`, its identity, and a line `BACKEND_SPACETIME_TOKEN=...`. Copy that line into `~/tab/.env`. Until step 9 it logs `no_rows_visible`: expected.

Now check the bridge itself with no AI involved, using a throwaway test group. Stop the bridge (Ctrl+C), then run it with the dev hub:

```sh
cd ~/tab/client && HUB=dev ECHO=1 bun start
```

From the iPhone (Tab's phone), text `/tab on` into a test group with you in it. Then, from your own phone, try `@tab ping` (Tab replies "pong") and `@tab like` (Tab tapbacks your message). When macOS asks to let bun control Messages, click **Allow**. If tapbacks fail, run `bun run tapback-probe` and see Troubleshooting.

Stop both windows with Ctrl+C when it all works.

## 9. Let the bot into your database

The bridge and the backend each have their own database identity (printed in step 8; the bridge's token is saved in `client/.state/`). As the owner, give each its role:

```sh
cd ~/tab
export SPACETIME_HOST=https://maincloud.spacetimedb.com SPACETIME_DB=tab-db
export SPACETIME_AUTH_TOKEN="$(spacetime login show --token | awk '/auth token/{print $NF}')"
npm run grant:role -- <bridge-identity> client
npm run grant:role -- <backend-identity> backend
unset SPACETIME_AUTH_TOKEN
```

Run the first run again (step 8) to check: the backend should now log `running` with no `no_rows_visible`.

## 10. Install the services

```sh
cd ~/tab && ops/install.sh
ops/status.sh
```

`status.sh` should show all four services running, the bridge health answering, and the commit you're on. From now on you don't start anything by hand. It all comes back after a reboot or a crash.

## 11. Turn Tab on in a group

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

The auto-updater never touches the database schema. That needs the owner's login (yours, from step 5). When a change touches `spacetime/src/`, publish it **before** pushing, from any machine logged in as the owner:

```sh
spacetime publish --server maincloud tab-db -p spacetime
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
| Bridge log: `authorization denied` on chat.db | Full Disk Access for `~/.bun/bin/bun` (step 7), then `ops/update.sh --restart`. |
| Sends fail: "Not authorized to send Apple events" | Privacy & Security → Automation: let bun control Messages. |
| Tapbacks fail: "not allowed assistive access" | Accessibility for `~/.bun/bin/bun`. |
| Tapbacks fail: "no enabled Tapback menu item" | The screen is locked or Messages is hidden behind something. Check step 2, and click into Messages once. |
| Backend log: `no_rows_visible` | The backend token is wrong or lacks the backend role (step 9). |
| `spacetime publish` complains about versions | `spacetime version install 2.10.2 && spacetime version use 2.10.2`, then publish again. |
| Tab texts from an email address | The number isn't selected for iMessage on the Mac or iPhone (step 3), or the iPhone has been off for a long time. |
| Every message answered twice | Another copy of Tab is running somewhere (a laptop). Stop it. |
| Update log: `can't fast-forward` | Someone changed files on the server. `cd ~/tab && git status`, then `git stash` or `git reset --hard origin/main` once you're sure nothing there matters. |
| Update log: `FAILED (...)` | The pushed commit broke tests. Fix it on a laptop and push again. The server stays on the last good commit until then. |
| After a macOS update nothing works | The permissions in step 7 may need re-adding, and the services restarting: `ops/install.sh`. |

`ops/install.sh --uninstall` removes all four services.

## Web ledger (optional)

"@tab ledger" sends a private link to a live web page of the group's balances. The page at tab-ledger.vercel.app still reads the hackathon database, so leave `LEDGER_*` out until it's redeployed against yours: set `VITE_SPACETIME_HOST=wss://maincloud.spacetimedb.com` and `VITE_SPACETIME_DB=tab-db` for `web/`, deploy it, then add to `~/tab/.env`:

```sh
LEDGER_BASE_URL=https://<where the web app is deployed>
LEDGER_LINK_KEY=                  # any long random string: openssl rand -base64 32
```
