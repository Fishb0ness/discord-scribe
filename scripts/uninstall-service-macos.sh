#!/usr/bin/env bash
# Stops and removes the discord-scribe launchd service (and the metrics job, if any).
# Usage: scripts/uninstall-service-macos.sh [--system]   (--system removes the LaunchDaemon, using sudo)
# Recordings and logs are left untouched.
set -euo pipefail

SYSTEM=0
case "${1:-}" in
  "") ;;
  --system) SYSTEM=1 ;;
  *) echo "Usage: $0 [--system]" >&2; exit 2 ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  echo "Do not run this script as root: it runs as your user and calls sudo itself for the privileged steps." >&2
  exit 1
fi

USER_SLUG="$(id -un | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')"
LABEL="com.${USER_SLUG}.discord-scribe"

if [ "$SYSTEM" -eq 1 ]; then
  DOMAIN="system"; TARGET_DIR="/Library/LaunchDaemons"; SUDO="sudo"
else
  DOMAIN="gui/$(id -u)"; TARGET_DIR="$HOME/Library/LaunchAgents"; SUDO=""
fi

for label in "$LABEL" "$LABEL.metrics"; do
  $SUDO launchctl bootout "$DOMAIN/$label" 2>/dev/null || echo "$label was not loaded"
  $SUDO rm -f "$TARGET_DIR/$label.plist"
  echo "Removed $label"
done
