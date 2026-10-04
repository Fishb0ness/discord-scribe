#!/usr/bin/env bash
# Stops and removes the discord-scribe launchd service. Recordings and logs are left untouched.
set -euo pipefail

USER_SLUG="$(id -un | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')"
LABEL="com.${USER_SLUG}.discord-scribe"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || echo "Service was not loaded"
rm -f "$TARGET"
echo "Removed $LABEL"
