#!/bin/bash
# Is the live Tab bot healthy? Run: ./tab-status.sh   (no Claude needed)
S=/private/tmp/claude-501/-Users-harjyot-Desktop-code-tab-Tab-MHacks26/89771490-9c85-439d-bb42-4a221654c27f/scratchpad
ok() { pgrep -f "$1" >/dev/null && echo "  up    $2" || echo "  DOWN  $2"; }
echo "processes:"
ok "^/Users/harjyot/.bun/bin/bun src/index.ts" "iMessage bridge"
ok "keepalive.sh bridge" "bridge restart loop"
ok "keepalive.sh backend-mc" "live backend (restart loop)"
ok "tsx src/nessie-worker.ts" "Nessie mirror"
ok "watchdog.sh" "watchdog"
ok "caffeinate -dims" "keep-awake"
echo "bridge:   $(grep -E 'Tab bridge up|Connecting to SpacetimeDB|Unable to connect' $S/bridge-maincloud.log | tail -1 | cut -c1-70)"
echo "backend:  last start $(grep '"event":"running"' $S/backend-mc.log | tail -1 | cut -c8-27) UTC"
echo "last message handled: $(grep '"event":"classified"' $S/backend-mc.log | tail -1 | cut -c8-27) UTC"
echo "failed messages: $(grep -c '"event":"message_failed"' $S/backend-mc.log)"
echo "internet: $(curl -s -o /dev/null -m 6 -w '%{http_code}' https://maincloud.spacetimedb.com/ | sed 's/403/ok/;s/000/DOWN/')"
echo "watchdog log:"; tail -n 5 $S/watchdog.log 2>/dev/null | sed 's/^/  /'
