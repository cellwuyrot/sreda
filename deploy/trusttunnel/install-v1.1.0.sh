#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_VERSION='1.1.0'
readonly EXPECTED_SHA256='9bb15f4e30e2ff196cf0aa387462c42387d9405ddfeb5caad133838560fa33cd'
readonly PREFIX='/opt/trusttunnel'
readonly CONFIG_DIR='/etc/trusttunnel'
readonly UNIT='/etc/systemd/system/trusttunnel.service'

usage() {
  cat <<'USAGE'
Usage (install only; does not start or enable the service):
  sudo ./install-v1.1.0.sh --install /absolute/path/to/trusttunnel_endpoint

The binary must be the verified upstream TrustTunnel Endpoint v1.1.0.
The script installs the binary, creates a restricted service account and
configuration directories, installs a disabled systemd unit, and reloads
systemd. It does not create credentials/configuration, open firewall ports,
enable/start the service, change Nginx, or switch TrioZ users.
USAGE
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${1:-}" == '--install' && $# -eq 2 ]] || { usage >&2; exit 2; }
(( EUID == 0 )) || fail 'run through sudo/root'
command -v systemctl >/dev/null || fail 'systemd is required'

source_bin=$2
[[ "$source_bin" = /* && -f "$source_bin" && -x "$source_bin" ]] || fail 'binary path must be an absolute path to an executable file'

actual_sha=$(sha256sum -- "$source_bin" | awk '{print $1}')
[[ "$actual_sha" == "$EXPECTED_SHA256" ]] || fail "SHA-256 mismatch: got $actual_sha"
actual_version=$("$source_bin" --version 2>/dev/null | tr -d '\r\n')
[[ "$actual_version" == "$EXPECTED_VERSION" ]] || fail "expected version $EXPECTED_VERSION, got '$actual_version'"

[[ ! -e "$UNIT" ]] || fail "$UNIT already exists; inspect it and do not overwrite"
if [[ -e "$PREFIX/trusttunnel_endpoint" ]]; then
  installed_sha=$(sha256sum -- "$PREFIX/trusttunnel_endpoint" | awk '{print $1}')
  [[ "$installed_sha" == "$EXPECTED_SHA256" ]] || fail 'an unrecognized endpoint binary already exists; refusing to overwrite'
  fail 'verified endpoint binary already installed; inspect current deployment before continuing'
fi

if ! getent group trusttunnel >/dev/null; then
  groupadd --system trusttunnel
fi
if ! getent passwd trusttunnel >/dev/null; then
  useradd --system --gid trusttunnel --home-dir /var/lib/trusttunnel \
    --shell /usr/sbin/nologin --no-create-home trusttunnel
fi

install -d -o root -g trusttunnel -m 0750 "$PREFIX" "$CONFIG_DIR"
install -d -o trusttunnel -g trusttunnel -m 0750 /var/lib/trusttunnel
install -o root -g trusttunnel -m 0750 "$source_bin" "$PREFIX/trusttunnel_endpoint"

unit_tmp=$(mktemp)
trap 'rm -f "$unit_tmp"' EXIT
cat > "$unit_tmp" <<'UNIT'
[Unit]
Description=TrustTunnel Endpoint (TrioZ)
After=network-online.target
Wants=network-online.target
ConditionPathExists=/etc/trusttunnel/vpn.toml
ConditionPathExists=/etc/trusttunnel/hosts.toml

[Service]
Type=simple
User=trusttunnel
Group=trusttunnel
WorkingDirectory=/etc/trusttunnel
ExecStart=/opt/trusttunnel/trusttunnel_endpoint /etc/trusttunnel/vpn.toml /etc/trusttunnel/hosts.toml
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
install -o root -g root -m 0644 "$unit_tmp" "$UNIT"
systemctl daemon-reload

printf '%s\n' \
  'Installed verified TrustTunnel Endpoint v1.1.0.' \
  'Service unit installed but intentionally NOT enabled or started.' \
  'No Nginx, firewall, credentials, config, or user traffic was changed.' \
  'Next: review docs/TRUSTTUNNEL-ENDPOINT-STAGE6.md; configure and validate files before a separately approved start.'
