#!/usr/bin/env bash
# Stops and removes the discord-scribe systemd user service. Recordings and logs are left untouched.
set -euo pipefail

UNIT="discord-scribe.service"
TARGET="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"

systemctl --user disable --now "$UNIT" 2>/dev/null || echo "Service was not enabled"
rm -f "$TARGET"
systemctl --user daemon-reload
echo "Removed $UNIT"
