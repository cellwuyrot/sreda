#!/usr/bin/env bash
# Adopt a live interface without down/up. Used by this node's systemd override.
set -euo pipefail
IFACE="${1:-}"
[[ "$IFACE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$ ]] || exit 1
if awg show "$IFACE" listen-port >/dev/null 2>&1; then
  exit 0
fi
exec awg-quick up "$IFACE"
