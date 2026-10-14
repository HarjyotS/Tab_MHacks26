#!/bin/zsh
# Installs Tab's launchd services for the logged-in user: the bridge, the
# backend, the auto-updater, and keep-awake. Safe to run again (it reloads
# them). `ops/install.sh --uninstall` removes them.
#   ops/install.sh
set -eu
REPO="${0:A:h:h}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/tab"
DOMAIN="gui/$(id -u)"
SERVICES=(app.tab.awake app.tab.backend app.tab.bridge app.tab.update)

for s in $SERVICES; do
  launchctl bootout "$DOMAIN/$s" 2>/dev/null || true
  rm -f "$AGENTS/$s.plist"
done
if [[ "${1:-}" == "--uninstall" ]]; then
  echo "removed: $SERVICES"
  exit 0
fi

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
NODE="$(command -v node || true)"
[[ -x "$BUN" ]] || { echo "bun not found: install it first (see ops/README.md)"; exit 1; }
[[ -n "$NODE" ]] || { echo "node not found: install it first (see ops/README.md)"; exit 1; }
[[ -f "$REPO/.env" ]] || { echo "missing $REPO/.env (the backend's settings): see ops/README.md"; exit 1; }
[[ -f "$REPO/client/.env" ]] || { echo "missing $REPO/client/.env (the bridge's settings): see ops/README.md"; exit 1; }
[[ -x "$REPO/node_modules/.bin/tsx" ]] || { echo "run 'npm ci' in $REPO first"; exit 1; }

mkdir -p "$AGENTS" "$LOGS"
PATH_FOR_SERVICES="${BUN:h}:${NODE:h}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
for s in $SERVICES; do
  sed -e "s|__REPO__|$REPO|g" -e "s|__BUN__|$BUN|g" -e "s|__LOGS__|$LOGS|g" -e "s|__PATH__|$PATH_FOR_SERVICES|g" \
    "$REPO/ops/launchd/$s.plist" > "$AGENTS/$s.plist"
  plutil -lint -s "$AGENTS/$s.plist"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$s.plist"
done
echo "installed: $SERVICES"
echo "logs: $LOGS (bridge.log, backend.log, update.log)"
echo "check: ops/status.sh"
