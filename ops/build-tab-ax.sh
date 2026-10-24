#!/bin/zsh
# Builds client/native/tab-ax (the bridge's tapbacks with TAPBACK_MODE=ax)
# when its Swift source is newer than the binary. Needs swiftc, from the
# Command Line Tools (xcode-select --install). Run by install.sh and update.sh.
set -u
REPO="${0:A:h:h}"
SRC="$REPO/client/native/tab-ax.swift"
BIN="$REPO/client/native/tab-ax"
[[ -x "$BIN" && "$BIN" -nt "$SRC" ]] && exit 0
command -v swiftc >/dev/null || { echo "swiftc not found: tab-ax not built (xcode-select --install)"; exit 1; }
swiftc -O -o "$BIN.tmp" "$SRC" && mv "$BIN.tmp" "$BIN" && echo "built tab-ax"
