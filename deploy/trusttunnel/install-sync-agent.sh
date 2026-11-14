#!/usr/bin/env bash
# Install the TrioZ TrustTunnel sync agent on the ENDPOINT host (VDS), as root.
#   sudo bash deploy/trusttunnel/install-sync-agent.sh            # from a repo checkout
# Creates /etc/trioz/trusttunnel-sync.json ONLY if absent (never overwrites
# secrets), prints the values the web server needs, does NOT start the agent.
# Nothing is downloaded; ~100 KB of Python files are copied.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
SRC="$(cd "$(dirname "$0")/../../apps/vpn/src" && pwd)"
DST=/opt/trioz-tt-sync
CFG=/etc/trioz/trusttunnel-sync.json
CREDS=/etc/trusttunnel/credentials.toml

python3 -c 'import sys; assert sys.version_info >= (3, 10)' || { echo "Python 3.10+ required"; exit 1; }
python3 -c 'import ctypes; ctypes.CDLL("libcrypto.so.3")' || { echo "OpenSSL 3 libcrypto required"; exit 1; }

install -d -m 0755 -o root -g root "$DST" "$DST/trusttunnel_vendor_tomli"
for f in trusttunnel_sync_agent.py trusttunnel_credentials.py trusttunnel_atomic_store.py trusttunnel_pilot_gcm.py; do
  install -m 0644 -o root -g root "$SRC/$f" "$DST/$f"
done
cp -r "$SRC/trusttunnel_vendor_tomli/." "$DST/trusttunnel_vendor_tomli/"
chown -R root:root "$DST"; find "$DST" -type d -exec chmod 0755 {} +; find "$DST" -type f -exec chmod 0644 {} +

# credentials.toml must be owned by root (the agent) and readable by the endpoint group.
if [[ -f "$CREDS" ]]; then
  owner=$(stat -c %U "$CREDS")
  if [[ "$owner" != root ]]; then
    echo "NOTE: $CREDS owner is $owner. Run: chown root:trusttunnel $CREDS && chmod 0640 $CREDS"
  fi
  d=$(stat -c '%U %a' "$(dirname "$CREDS")"); echo "credentials dir: $d (must be root-owned, not group/other-writable)"
fi

install -d -m 0700 -o root -g root /etc/trioz
if [[ ! -f "$CFG" ]]; then
  TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(36))')
  KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  umask 077
  python3 - "$CFG" "$TOKEN" "$KEY" <<'PY'
import json, sys
path, token, key = sys.argv[1:]
json.dump({"mainUrl": "https://trioz.ru", "token": token, "syncKey": key,
           "credentialsPath": "/etc/trusttunnel/credentials.toml", "serviceName": "trusttunnel",
           "stateDir": "/var/lib/trioz-tt-sync", "intervalSeconds": 60, "minRestartIntervalSeconds": 30},
          open(path, "w"), indent=2)
PY
  chmod 0600 "$CFG"
  HASH=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)
  echo
  echo "=== Add to the WEB server environment (.env), keep secret ==="
  echo "TRIOZ_TT_SYNC_KEY=$KEY"
  echo "TRIOZ_TT_SYNC_TOKEN_SHA256=$HASH"
  echo "(the agent token itself stays only in $CFG)"
else
  echo "$CFG exists - left untouched"
fi
install -m 0644 -o root -g root "$(dirname "$0")/trioz-tt-sync.service" /etc/systemd/system/trioz-tt-sync.service
systemctl daemon-reload
echo
echo "Next: one real cycle (applies the current web snapshot) ->  python3 $DST/trusttunnel_sync_agent.py --config $CFG --once"
echo "Then:               ->  systemctl enable --now trioz-tt-sync"
