#!/bin/zsh
# Is Tab healthy on this Mac?   ops/status.sh
REPO="${0:A:h:h}"
LOGS="$HOME/Library/Logs/tab"
echo "services (pid, last exit):"
for s in app.tab.bridge app.tab.backend app.tab.update app.tab.awake; do
  line=$(launchctl list | awk -v s="$s" '$3 == s')
  if [[ -z "$line" ]]; then echo "  MISSING  $s (run ops/install.sh)"; continue; fi
  pid=$(echo "$line" | awk '{print $1}'); code=$(echo "$line" | awk '{print $2}')
  [[ "$pid" == "-" ]] && state="stopped" || state="running"
  echo "  $state  $s  (pid $pid, last exit $code)"
done
echo "bridge health: $(curl -s -m 3 http://127.0.0.1:${CLIENT_PORT:-8787}/health || echo 'no answer')"
echo "backend health: $(curl -s -m 3 http://127.0.0.1:${HUB_PORT:-4100}/health || echo 'no answer')"
echo "running commit: $(git -C "$REPO" log -1 --format='%h %s (%cr)')"
echo "backend last start: $(grep '"event":"running"' "$LOGS/backend.log" 2>/dev/null | tail -1 | cut -c8-26) UTC"
echo "last message handled: $(grep '"event":"classified"' "$LOGS/backend.log" 2>/dev/null | tail -1 | cut -c8-26) UTC"
echo "database retries: $(grep -c '"event":"db_retry"' "$LOGS/backend.log" 2>/dev/null || echo 0)"
echo "failed messages: $(grep -c '"event":"message_failed"' "$LOGS/backend.log" 2>/dev/null || echo 0)"
echo "last updates:"; tail -n 5 "$LOGS/update.log" 2>/dev/null | sed 's/^/  /'
