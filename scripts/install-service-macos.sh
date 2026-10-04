#!/usr/bin/env bash
# Installs discord-scribe as a per-user launchd service (starts at login, restarts on crash).
# Usage: scripts/install-service.sh [--dry-run]   (--dry-run prints the rendered plist and changes nothing)
set -euo pipefail

# The label is derived from the installing user so nothing in the repository is tied to one person.
USER_SLUG="$(id -un | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')"
LABEL="com.${USER_SLUG}.discord-scribe"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT_DIR/service/macos.plist.template"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "node not found on PATH" >&2; exit 1; }
# Resolve version-manager shims (mise/asdf/nvm) to the real binary so launchd does not need them.
NODE_BIN="$(node -p 'process.execPath')"

# PATH for the service: node's dir, Homebrew (whisper-cli), ~/.local/bin (claude), then the system defaults.
SERVICE_PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

render() {
  sed \
    -e "s|{{LABEL}}|$LABEL|g" \
    -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
    -e "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
    -e "s|{{PATH}}|$SERVICE_PATH|g" \
    "$TEMPLATE"
}

if [ "${1:-}" = "--dry-run" ]; then
  render
  exit 0
fi

[ -f "$PROJECT_DIR/.env" ] || { echo "Missing $PROJECT_DIR/.env (copy .env.example and fill it in first)" >&2; exit 1; }
[ -d "$PROJECT_DIR/node_modules" ] || { echo "Run 'npm install' first" >&2; exit 1; }

mkdir -p "$PROJECT_DIR/logs" "$HOME/Library/LaunchAgents"
render > "$TARGET"
plutil -lint "$TARGET"

# Replace a previous instance if there is one.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "Installed $LABEL"
echo "  plist: $TARGET"
echo "  logs:  $PROJECT_DIR/logs/discord-scribe.log (stdout), discord-scribe.err.log (stderr)"
echo "  check: launchctl print $DOMAIN/$LABEL | head -20"
