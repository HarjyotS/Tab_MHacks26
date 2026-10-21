#!/bin/zsh
# Packs the server's secrets into an encrypted settings file for whoever
# runs it (ops/README.md, step 6): ~/tab/.env with the API keys and the
# database's address, and ~/tab/client/.env. They set TAB_PHONE after
# unpacking. Send the file by email and the password some other way (a text).
# DATABASE_URL comes from the environment or this repo's .env.
#   ops/pack-env.sh <password> [output]   (default output: ~/Desktop/tab-env.tgz.enc)
set -eu
REPO="${0:A:h:h}"
PASS="${1:-}"
OUT="${2:-$HOME/Desktop/tab-env.tgz.enc}"
[[ -n "$PASS" ]] || { echo "usage: ops/pack-env.sh <password> [output]"; exit 1; }
get() { grep -E "^$1=" "$REPO/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'"; }
DATABASE_URL="${DATABASE_URL:-$(get DATABASE_URL)}"
for k in XAI_API_KEY TYPESAFE_API_KEY; do
  [[ -n "$(get $k)" ]] || { echo "missing $k in $REPO/.env"; exit 1; }
done
[[ -n "$DATABASE_URL" ]] || { echo "missing DATABASE_URL (Neon's, from Vercel): set it in the environment or $REPO/.env"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/client"
cat > "$TMP/.env" <<EOT
# Tab backend settings: ~/tab/.env (ops/README.md, step 6). Keep private: chmod 600.
DATABASE_URL=$DATABASE_URL
XAI_API_KEY=$(get XAI_API_KEY)
TYPESAFE_API_KEY=$(get TYPESAFE_API_KEY)
EOT
cat > "$TMP/client/.env" <<'EOT'
# Tab bridge settings: ~/tab/client/.env (ops/README.md, step 6). Keep private: chmod 600.
# Tab's own number, like +15551234567.
TAB_PHONE=
TAB_NAME=Tab
HUB=backend
ECHO=0
GROUP_TIMEZONE=America/Detroit
EOT
chmod 600 "$TMP/.env" "$TMP/client/.env"
COPYFILE_DISABLE=1 tar -czf "$TMP/tab-env.tgz" -C "$TMP" .env client/.env
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$TMP/tab-env.tgz" -out "$OUT" -pass "pass:$PASS"
echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes). Email it; send the password separately."
echo "unpack: openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in tab-env.tgz.enc | tar -xzf - -C ~/tab"
