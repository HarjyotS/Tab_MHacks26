#!/bin/zsh
# Deploys new commits on main, run by launchd every 2 minutes
# (app.tab.update). Pull, install what changed, run the tests, and restart
# only the parts that changed. If anything fails it rolls back to the
# commit that was running, and skips that commit until a newer one lands.
#   ops/update.sh            check once
#   ops/update.sh --restart  restart the bridge and backend now
set -u
REPO="${0:A:h:h}"
cd "$REPO"
BRANCH="${TAB_BRANCH:-main}"
STATE="$REPO/.state-ops"
DOMAIN="gui/$(id -u)"
mkdir -p "$STATE"
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
restart() { for s in "$@"; do launchctl kickstart -k "$DOMAIN/app.tab.$s" && log "restarted $s"; done; }

if [[ "${1:-}" == "--restart" ]]; then restart backend bridge; exit 0; fi

# One run at a time.
if ! mkdir "$STATE/lock" 2>/dev/null; then exit 0; fi
trap 'rmdir "$STATE/lock"' EXIT

git fetch --quiet origin "$BRANCH" || { log "fetch failed (offline?)"; exit 0; }
OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"
[[ "$OLD" == "$NEW" ]] && exit 0
[[ "$(cat "$STATE/bad-commit" 2>/dev/null)" == "$NEW" ]] && exit 0

changed() { git diff --name-only "$OLD" "$NEW" -- "$@" | grep -q .; }
install_deps() {
  if changed package-lock.json package.json '*/package.json'; then npm ci --no-audit --no-fund --loglevel=error || return 1; fi
  if changed client/bun.lock client/package.json; then (cd client && bun install --frozen-lockfile) || return 1; fi
}
rollback() {
  log "FAILED ($1): staying on ${OLD:0:7}, skipping ${NEW:0:7} until a newer commit"
  print -r -- "$NEW" > "$STATE/bad-commit"
  git reset --quiet --hard "$OLD"
  local tmp="$OLD"; OLD="$NEW"; NEW="$tmp"
  install_deps
  exit 1
}

log "deploying ${OLD:0:7} -> ${NEW:0:7}"
# Only fast-forwards: edits made on the server stop the update rather than
# being thrown away.
git merge --ff-only --quiet "origin/$BRANCH" || { log "can't fast-forward: local changes on the server? (git status)"; exit 1; }
install_deps || rollback "install"
if changed client/native; then "$REPO/ops/build-tab-ax.sh" || log "tab-ax not built: tapbacks use the picker"; fi

BOT=(backend gate spacetime package-lock.json package.json)
if changed $BOT client; then
  log "running checks"
  npm run typecheck -w backend --silent >/dev/null 2>&1 || rollback "backend typecheck"
  npm test -w backend --silent >/dev/null 2>&1 || rollback "backend tests"
  npm test -w gate --silent >/dev/null 2>&1 || rollback "gate tests"
  (cd client && bun test >/dev/null 2>&1) || rollback "client tests"
fi

# Restart only what changed. Site, video, and docs changes restart nothing.
if changed $BOT; then restart backend; fi
if changed client package-lock.json; then restart bridge; fi
rm -f "$STATE/bad-commit"
log "now on ${NEW:0:7}: $(git log -1 --format=%s)"
