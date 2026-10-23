# Running Tab on a Mac server

This is the checklist for putting Tab on an always-on Mac (a cloud Mac or a Mac mini) so it texts from its own Apple Account. It takes about an hour. Once it's done, every push to `main` deploys itself.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Messages.app | the Mac | Signed into Tab's Apple ID. This is how Tab texts. |
| Bridge (`client/`, Bun) | the Mac | Reads the Messages database, sends texts and tapbacks, serves photos and their on-device text. |
| Backend (`backend/`, Node) | the Mac | The brain: the screener (Jev), Grok, splits, reminders. Holds Tab's data and saves every change to the database. The bridge talks to it on `127.0.0.1:4100`. |
| Auto-updater (`ops/update.sh`) | the Mac | Every 2 minutes: pulls `main`, runs the tests, restarts what changed. |
| Neon Postgres | Vercel (cloud) | The database, `tab-db` on Harjyot's Vercel account (free plan, Oregon). The backend creates its tables itself. |

All four Mac pieces run as launchd services (macOS's built-in service manager). They start at login, restart if they crash, and log to `~/Library/Logs/tab/`.

## 1. Before you start

You need:

- **The Mac.** A cloud Mac with at least 4 GB of RAM, or a Mac mini. macOS 15 or newer. You need remote desktop access to it (NoMachine, Screen Sharing or VNC), not just SSH. Some steps are clicks in System Settings, and Messages needs a real logged-in desktop.
- **Tab's Apple ID.** A fresh Apple ID just for Tab, not anyone's personal one.
- **Tab's address.** Tab is for iPhone groups only, so it texts from its Apple Account's email, `tab@addtab.app`, and needs no phone number. (A number would need an iPhone with a SIM signed into the same account; skip it unless Tab ever has to reach Android phones, which iMessage can't do anyway.)
- **The secrets, from Harjyot, privately** (an encrypted file plus its password by text, or a password manager share; never plain email or Slack):
  - `DATABASE_URL` (the Neon database)
  - `XAI_API_KEY` (Grok)
  - `TYPESAFE_API_KEY` (Jev, the screener)

> Only one copy of Tab may run at a time. Once this server is up, nobody else runs the bridge or backend, or every message gets answered twice.

**On HostMyApple** (our cloud Mac), the host's rules come first. Break them and we lose the machine:

- **Restart, never Shut Down.** A shut-down VM stays off until the host turns it back on.
- **No FileVault.** Skip step 2.5.
- **No VPN apps.**
- A macOS update can take it offline for up to 45 minutes. Don't force a reboot during one.

## 2. Mac settings

In **System Settings**:

1. **Users & Groups → Automatically log in as**: the user Tab runs as. After a reboot, Messages and the services need a logged-in desktop.
2. **Lock Screen**: turn the screen saver off, set "Require password after screen saver" to **Never**, and set "Turn display off" to **Never**. Tapbacks click through Messages, which doesn't work on a locked screen.
3. **Energy** (or Battery → Options on a laptop): turn on "Prevent automatic sleeping" and "Start up automatically after a power failure" if they're offered. The `app.tab.awake` service keeps it awake too.
4. **General → Software Update → Automatic Updates**: turn off "Install macOS updates". A surprise restart takes Tab offline, so update by hand.
5. **Privacy & Security → FileVault**: on, if the host allows it. The Mac holds group chats. HostMyApple doesn't: leave it off there.
6. **General → Sharing → Remote Login**: on, so the Mac can be reached over SSH.

On a cloud Mac, also check with the host that the desktop session stays unlocked after you disconnect from remote desktop.

## 3. Tab's Apple Account

On the **Mac**:

1. Open Messages and sign in with Tab's Apple Account (`tab@addtab.app`). Apple sends a code to a device on that account, or by text to its recovery number.
2. Messages → Settings → iMessage: make sure `tab@addtab.app` is ticked and is what "Start new conversations from" shows.
3. Messages → Settings → General → **Keep messages: 30 days**. Tab deletes chatter from its own database, but Messages keeps its own copy, so keep that short.
4. From your own iPhone, iMessage `tab@addtab.app`. The message should show up in Messages on the Mac.

Everyone in a group with Tab needs an iPhone (iMessage). A group with an Android member turns into SMS, which Tab can't join.

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

## 5. The database

Tab's data lives in Neon Postgres, on Harjyot's Vercel account: the database `tab-db` (free plan, Oregon), connected to the `tab-ledger` project. There's nothing to install or publish. The backend creates its tables the first time it starts, and adds new columns itself after updates.

All you need is its address, `DATABASE_URL`. It's in the encrypted settings file (step 6), or on Vercel: **Storage → tab-db → .env.local**, the `DATABASE_URL` line (the pooled one, with `-pooler` in the host). It contains the database password, so keep it private.

## 6. Settings files

Two files, both gitignored. If Harjyot sent the encrypted settings file, it holds both with the secrets filled in: decrypt it into `~/tab` with the password he texted you,

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ~/Downloads/tab-env.tgz.enc | tar -xzf - -C ~/tab
```

then set `TAB_PHONE` in `client/.env`. Otherwise create them:

**`~/tab/.env`** (the backend):

```sh
DATABASE_URL=                     # step 5
XAI_API_KEY=                      # from Harjyot
TYPESAFE_API_KEY=                 # from Harjyot
```

Leave `DEMO_MODE` and `PAYMENTS` out. The defaults are real timing and real payment links. The web ledger links (`LEDGER_BASE_URL`, `LEDGER_LINK_KEY`) stay off until the ledger site points at your database (see "Web ledger" at the end).

**`~/tab/client/.env`** (the bridge):

```sh
TAB_EMAIL=tab@addtab.app          # what Tab texts from, and what its contact card carries
TAB_PHONE=                        # only if Tab ever gets a number
TAB_NAME=Tab
HUB=backend
ECHO=0
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

- The bridge should print `Talking to the backend at http://127.0.0.1:4100` and `Tab bridge up...`. If it says `authorization denied` on chat.db, Full Disk Access is missing (step 7).
- The backend logs `connected` with `"store":"postgres"`, then `running`. If it can't reach the database it exits with the error: check `DATABASE_URL`.

Now check the bridge itself with no AI involved, using a throwaway test group. Stop the bridge (Ctrl+C), then run it with the dev hub:

```sh
cd ~/tab/client && HUB=dev ECHO=1 bun start
```

In Messages on the Mac (signed in as Tab), make a test group with you in it and send `/tab on` into it: anything Tab's own account sends counts as Tab. Then, from your own phone, try `@tab ping` (Tab replies "pong") and `@tab like` (Tab tapbacks your message). When macOS asks to let bun control Messages, click **Allow**. If tapbacks fail, run `bun run tapback-probe` and see Troubleshooting.

Stop both windows with Ctrl+C when it all works.

## 9. Install the services

```sh
cd ~/tab && ops/install.sh
ops/status.sh
```

`status.sh` should show all four services running, the bridge and backend health answering, and the commit you're on. From now on you don't start anything by hand. It all comes back after a reboot or a crash.

## 10. Turn Tab on in a group

Add `tab@addtab.app` to the group chat like any contact, then send `/tab on` into the group **as Tab**: from Messages on the Mac (in NoMachine), where you're signed in as Tab. Tab introduces itself, sends its contact card, and asks for names. `/tab off` switches it off. Tab only reads groups it's been switched on in, plus DMs from their members.

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

Nothing to do by hand. When the backend starts it creates any table or column the code needs that the database doesn't have yet. It never drops or renames anything, so a push that adds a field deploys like any other. Renaming or removing a column needs a one-off migration: write it, test it on a copy, and say so in the PR.

Neon's free plan holds 0.5 GB and sleeps when nothing's happening. The backend keeps every row in memory and only talks to Neon to save changes, so a sleeping database just adds a second to the first save after a quiet spell. Backups: Neon keeps a short restore window (Vercel → Storage → tab-db → Open in Neon).

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
| Backend log: `db_retry`, or messages failing with `saving failed` | Neon is unreachable. Check the Mac's internet and Neon's status. Nothing is lost: the change rolls back and the bridge keeps the message until it goes through. |
| Backend exits at startup with a database error | `DATABASE_URL` in `~/tab/.env` is wrong or missing (step 5). |
| Bridge log: `backend unreachable` | The backend is down or restarting. Messages wait in the bridge until it's back. Check `ops/status.sh` and `backend.log`. |
| Someone can't add Tab, or Tab's texts turn green | They or someone in the group isn't on iMessage (Android, or iMessage off). Tab only works in all-iPhone groups. |
| Every message answered twice | Another copy of Tab is running somewhere (a laptop). Stop it. If it uses the same `DATABASE_URL`, the backend that started first stops itself at its next save (`save_failed_restarting`, "another backend started") rather than overwrite rows; launchd restarts the server's. |
| Update log: `can't fast-forward` | Someone changed files on the server. `cd ~/tab && git status`, then `git stash` or `git reset --hard origin/main` once you're sure nothing there matters. |
| Update log: `FAILED (...)` | The pushed commit broke tests. Fix it on a laptop and push again. The server stays on the last good commit until then. |
| After a macOS update nothing works | The permissions in step 7 may need re-adding, and the services restarting: `ops/install.sh`. |

`ops/install.sh --uninstall` removes all four services.

## Web ledger (optional)

"@tab ledger" sends a private link to a live web page of the group's balances. The page at tab-ledger.vercel.app still reads the hackathon's SpacetimeDB, not Neon, so leave `LEDGER_*` out until it's moved over (it needs a small API on Vercel reading `tab-db`). When it is, add to `~/tab/.env`:

```sh
LEDGER_BASE_URL=https://<where the web app is deployed>
LEDGER_LINK_KEY=                  # any long random string: openssl rand -base64 32
```
