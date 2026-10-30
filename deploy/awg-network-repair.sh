#!/usr/bin/env bash
# Existing nodes: preview by default; --apply repairs networking without keys,
# reinstalling AWG, flushing tables, touching Docker, or down/up of a live iface.
set -euo pipefail
IFACE=awg0
PORT=
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --iface=*) IFACE="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --apply) APPLY=1 ;;
    *) echo 'Usage: awg-network-repair.sh [--iface=awg0] [--port=51820] [--apply]' >&2; exit 1 ;;
  esac
done
[[ "$IFACE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$ ]] || exit 1
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/apps/vpn/src/network-cli.mjs"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -x "$NODE_BIN" ] && [ -f "$HELPER" ] || { echo 'Node >=20 and current apps/vpn source are required' >&2; exit 1; }
[[ "$ROOT$NODE_BIN" != *[\"\\$'\n']* ]] || { echo 'Unsupported path' >&2; exit 1; }
"$NODE_BIN" -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
# Refuse invented/down interfaces before changing persistent configuration.
ACTUAL_PORT="$(awg show "$IFACE" listen-port)"
PORT="${PORT:-$ACTUAL_PORT}"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$PORT >= 1 && 10#$PORT <= 65535)) || exit 1
PORT=$((10#$PORT))
[ "$PORT" = "$ACTUAL_PORT" ] || { echo 'Port differs from live interface; refusing to change it' >&2; exit 1; }
if [ "$APPLY" = 0 ]; then
  exec "$NODE_BIN" "$HELPER" "--iface=$IFACE" "--port=$PORT"
fi
[ -f /etc/systemd/system/trioz-vpn-agent.service ] || [ -f /usr/lib/systemd/system/trioz-vpn-agent.service ] || {
  echo 'Existing trioz-vpn-agent.service required; use awg-node.sh for new nodes' >&2; exit 1;
}
CURRENT_DIR="$(systemctl show trioz-vpn-agent -p WorkingDirectory --value)"
if [ -n "$CURRENT_DIR" ] && [ "$(readlink -f -- "$CURRENT_DIR")" != "$(readlink -f -- "$ROOT/apps/vpn")" ]; then
  echo 'Run this script from the repository used by trioz-vpn-agent WorkingDirectory' >&2
  exit 1
fi
# No saving/restoring a global iptables snapshot containing Docker rules.
"$NODE_BIN" "$HELPER" "--iface=$IFACE" "--port=$PORT" --repair
BACKUP="/var/backups/trioz-vpn-network/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$BACKUP"
QUICK_DIR="/etc/systemd/system/awg-quick@$IFACE.service.d"
AGENT_DIR=/etc/systemd/system/trioz-vpn-agent.service.d
for target in "$QUICK_DIR/20-trioz-network.conf" "$AGENT_DIR/20-trioz-network.conf"; do
  if [ -f "$target" ]; then cp -- "$target" "$BACKUP/$(basename "$(dirname "$target")").conf"; fi
done
install -d -m 755 /usr/local/lib/trioz-vpn "$QUICK_DIR" "$AGENT_DIR"
install -m 755 "$ROOT/deploy/awg-interface-start.sh" /usr/local/lib/trioz-vpn/ensure-interface.sh
cat > "$QUICK_DIR/20-trioz-network.conf" <<EOF
[Unit]
Wants=network-online.target
After=network-online.target docker.service
[Service]
ExecStart=
ExecStart=/usr/local/lib/trioz-vpn/ensure-interface.sh %i
ExecStartPost="$NODE_BIN" "$HELPER" --iface=%i --port=$PORT --repair
EOF
cat > "$AGENT_DIR/20-trioz-network.conf" <<EOF
[Unit]
Wants=awg-quick@$IFACE.service
After=awg-quick@$IFACE.service
[Service]
Environment=WG_NETWORK_REPAIR=1
EOF
chmod 644 "$QUICK_DIR/20-trioz-network.conf" "$AGENT_DIR/20-trioz-network.conf"
systemctl daemon-reload
systemctl reset-failed "awg-quick@$IFACE" || true
systemctl enable "awg-quick@$IFACE"
# The wrapper adopts an existing interface without touching its keys or peers.
systemctl start "awg-quick@$IFACE"
systemctl restart trioz-vpn-agent
"$NODE_BIN" "$HELPER" "--iface=$IFACE" "--port=$PORT"
echo 'Local VPN network configuration ready. Client Internet access still requires a live test.'
