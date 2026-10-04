#!/usr/bin/env bash
# Installs discord-scribe as a launchd service (restarts on crash).
# Usage: scripts/install-service-macos.sh [--system] [--metrics] [--dry-run]
#   (default)  LaunchAgent in gui/<uid>: starts at login, dies when the GUI session logs out.
#   --system   LaunchDaemon in the system domain: survives logouts and starts at boot; runs as you, calls sudo itself.
#   --metrics  also installs a sampler job (every 5 min) that feeds logs/metrics.csv (see: npm run metrics).
#   --dry-run  prints the rendered plist(s) and changes nothing.
set -euo pipefail

SYSTEM=0; METRICS=0; DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --system) SYSTEM=1 ;;
    --metrics) METRICS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown option: $arg" >&2; echo "Usage: $0 [--system] [--metrics] [--dry-run]" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then
  echo "Do not run this script as root: it runs as your user and calls sudo itself for the privileged steps." >&2
  exit 1
fi

# The label is derived from the installing user so nothing in the repository is tied to one person.
USER_NAME="$(id -un)"
USER_SLUG="$(echo "$USER_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')"
LABEL="com.${USER_SLUG}.discord-scribe"
METRICS_LABEL="$LABEL.metrics"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$HOME/Library/LaunchAgents"
DAEMON_DIR="/Library/LaunchDaemons"
AGENT_DOMAIN="gui/$(id -u)"

if [ "$SYSTEM" -eq 1 ]; then
  DOMAIN="system"; TARGET_DIR="$DAEMON_DIR"; SUDO="sudo"
else
  DOMAIN="$AGENT_DOMAIN"; TARGET_DIR="$AGENT_DIR"; SUDO=""
fi

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "node not found on PATH" >&2; exit 1; }
# Resolve version-manager shims (mise/asdf/nvm) to the real binary so launchd does not need them.
NODE_BIN="$(node -p 'process.execPath')"

# PATH for the service: node's dir, Homebrew (whisper-cli), ~/.local/bin (claude), then the system defaults.
SERVICE_PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Daemon-only pieces: a daemon has no login environment, so HOME/USER and the Claude config dir are passed explicitly.
CLAUDE_ENV=""
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  CLAUDE_ENV="    <key>CLAUDE_CONFIG_DIR</key>
    <string>$CLAUDE_CONFIG_DIR</string>"
fi
USER_KEYS=""; ENV_EXTRA=""
if [ "$SYSTEM" -eq 1 ]; then
  USER_KEYS="
  <key>UserName</key>
  <string>$USER_NAME</string>
"
  ENV_EXTRA="    <key>HOME</key>
    <string>$HOME</string>
    <key>USER</key>
    <string>$USER_NAME</string>"
  [ -z "$CLAUDE_ENV" ] || ENV_EXTRA="$ENV_EXTRA
$CLAUDE_ENV"
fi

# render <template> <label>: fills the placeholders (bash substitution, so multi-line blocks work).
render() {
  local text
  text="$(cat "$PROJECT_DIR/service/$1")"
  text="${text//\{\{LABEL\}\}/$2}"
  text="${text//\{\{NODE_BIN\}\}/$NODE_BIN}"
  text="${text//\{\{PROJECT_DIR\}\}/$PROJECT_DIR}"
  text="${text//\{\{PATH\}\}/$SERVICE_PATH}"
  text="${text//\{\{USER_NAME\}\}/$USER_NAME}"
  text="${text//\{\{HOME_DIR\}\}/$HOME}"
  text="${text//\{\{CLAUDE_ENV\}\}/$CLAUDE_ENV}"
  text="${text//\{\{USER_KEYS\}\}/$USER_KEYS}"
  text="${text//\{\{ENV_EXTRA\}\}/$ENV_EXTRA}"
  printf '%s\n' "$text"
}

BOT_TEMPLATE="macos.plist.template"
[ "$SYSTEM" -eq 0 ] || BOT_TEMPLATE="macos-system.plist.template"

# An external volume is not mounted at boot unless macOS is told to mount disks without a login.
warn_automount() {
  case "$PROJECT_DIR" in /Volumes/*) ;; *) return 0 ;; esac
  [ "$SYSTEM" -eq 1 ] || return 0
  local value
  value="$(defaults read /Library/Preferences/SystemConfiguration/autodiskmount AutomountDisksWithoutUserLogin 2>/dev/null || echo 0)"
  [ "$value" = "1" ] && return 0
  {
    echo "WARNING: $PROJECT_DIR is on an external volume that macOS will not mount at boot until someone logs in."
    echo "  To mount it without a login, run once:"
    echo "  sudo defaults write /Library/Preferences/SystemConfiguration/autodiskmount AutomountDisksWithoutUserLogin -bool true"
  } >&2
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "would write $TARGET_DIR/$LABEL.plist (domain $DOMAIN)" >&2
  render "$BOT_TEMPLATE" "$LABEL"
  if [ "$METRICS" -eq 1 ]; then
    echo "would write $TARGET_DIR/$METRICS_LABEL.plist (domain $DOMAIN)" >&2
    render "macos-metrics.plist.template" "$METRICS_LABEL"
  fi
  warn_automount
  exit 0
fi

[ -f "$PROJECT_DIR/.env" ] || { echo "Missing $PROJECT_DIR/.env (copy .env.example and fill it in first)" >&2; exit 1; }
[ -d "$PROJECT_DIR/node_modules" ] || { echo "Run 'npm install' first" >&2; exit 1; }
mkdir -p "$PROJECT_DIR/logs" "$AGENT_DIR"

# Removes the instance of the other mode (left behind it would run the bot twice).
remove_other_mode() {
  local label other
  for label in "$LABEL" "$METRICS_LABEL"; do
    if [ "$SYSTEM" -eq 1 ]; then
      launchctl bootout "$AGENT_DOMAIN/$label" 2>/dev/null || true
      rm -f "$AGENT_DIR/$label.plist"
    else
      other="$DAEMON_DIR/$label.plist"
      if [ -f "$other" ]; then
        echo "Removing the system LaunchDaemon $label (needs sudo)"
        sudo launchctl bootout "system/$label" 2>/dev/null || true
        sudo rm -f "$other"
      fi
    fi
  done
}

# install_job <template> <label> <kickstart 0|1>
install_job() {
  local tmp target="$TARGET_DIR/$2.plist"
  tmp="$(mktemp)"
  render "$1" "$2" > "$tmp"
  plutil -lint "$tmp" >/dev/null
  if [ "$SYSTEM" -eq 1 ]; then
    sudo install -m 644 -o root -g wheel "$tmp" "$target"
  else
    install -m 644 "$tmp" "$target"
  fi
  rm -f "$tmp"
  # Replace a previous instance if there is one.
  $SUDO launchctl bootout "$DOMAIN/$2" 2>/dev/null || true
  $SUDO launchctl bootstrap "$DOMAIN" "$target"
  $SUDO launchctl enable "$DOMAIN/$2"
  if [ "$3" -eq 1 ]; then $SUDO launchctl kickstart -k "$DOMAIN/$2"; fi
  echo "Installed $2"
  echo "  plist: $target"
}

warn_automount
remove_other_mode
install_job "$BOT_TEMPLATE" "$LABEL" 1
[ "$METRICS" -eq 0 ] || install_job "macos-metrics.plist.template" "$METRICS_LABEL" 0

echo "  logs:  $PROJECT_DIR/logs/discord-scribe.log (stdout), discord-scribe.err.log (stderr)"
echo "  check: $SUDO launchctl print $DOMAIN/$LABEL | head -20"
[ "$METRICS" -eq 0 ] || echo "  metrics: npm run metrics (samples in logs/metrics.csv)"
