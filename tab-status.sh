#!/bin/zsh
# Is the live Tab bot healthy? On the server: ./tab-status.sh (same as ops/status.sh).
exec "${0:A:h}/ops/status.sh"
