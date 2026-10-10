#!/usr/bin/env bash
# One-step installer for the Hotzonex Router Agent on Ubuntu/Debian.
# Run on a computer connected to the MikroTik router's network:
#
#   curl -fsSL https://raw.githubusercontent.com/omotmam2024-coder/Hotzonex-management/claude/clever-mccarthy-1780c7/agent/deploy/install-ubuntu.sh -o install-agent.sh
#   sudo bash install-agent.sh
#
# It installs Node.js 20, downloads the agent to /opt/hotzonex, asks for the two
# secret keys (typed in hidden, stored only in /opt/hotzonex/agent/.env), checks
# Supabase and the routers, and installs a service that starts on every boot.
# Running it again updates the agent and keeps the saved keys.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/omotmam2024-coder/Hotzonex-management.git}"
BRANCH="${BRANCH:-claude/clever-mccarthy-1780c7}"
SUPABASE_URL="${SUPABASE_URL:-https://tyiwnaxdejtsdofgnuow.supabase.co}"
INSTALL_DIR=/opt/hotzonex
AGENT_DIR="$INSTALL_DIR/agent"
SERVICE_USER=hotzonex

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run with sudo: sudo bash $0"
command -v apt-get >/dev/null || fail "This installer is for Ubuntu/Debian (apt-get not found)."

say "Installing git and curl"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v)"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Creating system user $SERVICE_USER"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

say "Downloading the Router Agent to $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch -q origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  rm -rf "$INSTALL_DIR"
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

ENV_FILE="$AGENT_DIR/.env"
write_env=1
if [ -f "$ENV_FILE" ] && ! grep -q 'your-service-role-key\|replace-with-64-hex' "$ENV_FILE"; then
  read -r -p "Keys are already saved. Keep them? [Y/n] " keep </dev/tty
  case "${keep:-Y}" in [Nn]*) ;; *) write_env=0 ;; esac
fi

if [ "$write_env" -eq 1 ]; then
  say "Secret keys (what you type is hidden)"
  echo "Supabase → Project Settings → API Keys → service_role (secret) key:"
  read -r -s -p "SUPABASE_SERVICE_ROLE_KEY: " service_key </dev/tty; echo
  [ -n "$service_key" ] || fail "The service_role key is empty."
  echo "The same 64-character ROUTER_SECRET_KEY you saved in Supabase → Edge Functions → Secrets:"
  while true; do
    read -r -s -p "ROUTER_SECRET_KEY: " router_key </dev/tty; echo
    [[ "$router_key" =~ ^[0-9a-fA-F]{64}$ ]] && break
    echo "It must be exactly 64 characters of 0-9 and a-f. Try again."
  done
  umask 077
  cat >"$ENV_FILE" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$service_key
ROUTER_SECRET_KEY=$router_key
JOB_POLL_INTERVAL_MS=3000
SYNC_INTERVAL_MS=60000
ROUTER_TIMEOUT_MS=10000
EOF
  unset service_key router_key
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$ENV_FILE"

say "Installing the agent's packages and building it"
cd "$AGENT_DIR"
sudo -u "$SERVICE_USER" -H npm ci --no-audit --no-fund --loglevel=error
sudo -u "$SERVICE_USER" -H npm run build --silent

say "Checking Supabase and your routers"
if ! sudo -u "$SERVICE_USER" -H npm run check --silent; then
  echo
  echo "The check found a problem (see the lines above)."
  read -r -p "Install the service anyway? It retries on its own once the problem is fixed. [Y/n] " go </dev/tty
  case "${go:-Y}" in [Nn]*) exit 1 ;; esac
fi

say "Installing the service (starts now and on every boot)"
systemctl stop hotzonex-agent 2>/dev/null || true
cp "$AGENT_DIR/deploy/hotzonex-agent.service" /etc/systemd/system/hotzonex-agent.service
sed -i "s#^ExecStart=.*#ExecStart=$(command -v node) $AGENT_DIR/dist/index.js#" /etc/systemd/system/hotzonex-agent.service
systemctl daemon-reload
systemctl enable --now hotzonex-agent >/dev/null
sleep 3
systemctl --no-pager --lines=8 status hotzonex-agent || true

say "Done"
echo "This computer's addresses: $(hostname -I)"
echo "The Router Agent is running. Open the website → Routers; waiting routers are tested within a few seconds."
echo "Live log:        journalctl -u hotzonex-agent -f"
echo "Restart:         sudo systemctl restart hotzonex-agent"
echo "Update later:    sudo bash install-agent.sh   (keeps your keys)"
