#!/usr/bin/env bash
# Installs discord-scribe as a systemd USER service (starts at login, restarts on failure).
# Usage: scripts/install-service-linux.sh [--dry-run]   (--dry-run prints the rendered unit and changes nothing)
set -euo pipefail

UNIT="discord-scribe.service"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT_DIR/service/linux.service.template"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
TARGET="$UNIT_DIR/$UNIT"

command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }
NODE_BIN="$(node -p 'process.execPath')"
# PATH for the service: node's dir, ~/.local/bin (claude), then the system defaults (whisper-cli, if installed there).
SERVICE_PATH="$(dirname "$NODE_BIN"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

render() {
  sed \
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

mkdir -p "$PROJECT_DIR/logs" "$UNIT_DIR"
render > "$TARGET"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
systemctl --user restart "$UNIT"

echo "Installed $UNIT"
echo "  unit:   $TARGET"
echo "  logs:   $PROJECT_DIR/logs/discord-scribe.log (stdout), discord-scribe.err.log (stderr)"
echo "  status: systemctl --user status $UNIT"
echo "To keep it running after you log out (headless server): sudo loginctl enable-linger \"$USER\""
