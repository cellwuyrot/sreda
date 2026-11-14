#!/usr/bin/env bash
set -Eeuo pipefail

# Certbot deploy hook: send only the turn.trioz.ru pair to the VDS receiver.
# Install root-owned, executable, with the dedicated forced-command SSH key.
readonly EXPECTED_LINEAGE='/etc/letsencrypt/live/turn.trioz.ru'
readonly SSH_TARGET='root@185.109.21.157'
readonly SSH_KEY='/root/.ssh/trusttunnel-cert-sync'
readonly KNOWN_HOSTS='/root/.ssh/known_hosts'

[[ "${EUID}" -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ "${RENEWED_LINEAGE:-}" == "${EXPECTED_LINEAGE}" ]] || exit 0
[[ -r "${SSH_KEY}" ]] || { echo 'dedicated SSH key is not readable' >&2; exit 1; }
[[ -r "${KNOWN_HOSTS}" ]] || { echo 'known_hosts file is missing' >&2; exit 1; }

openssl x509 -in "${RENEWED_LINEAGE}/fullchain.pem" -noout \
  -checkhost turn.trioz.ru >/dev/null 2>&1 \
  || { echo 'renewed certificate does not cover turn.trioz.ru' >&2; exit 1; }

tar -C "${RENEWED_LINEAGE}" -chf - fullchain.pem privkey.pem |
  ssh -T -4 \
    -i "${SSH_KEY}" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${KNOWN_HOSTS}" \
    -o ConnectTimeout=10 \
    -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=2 \
    "${SSH_TARGET}"