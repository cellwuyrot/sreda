#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Install only the turn.trioz.ru certificate pair received over SSH stdin.
# This script is intended to be the forced command for a dedicated SSH key.
readonly CERT_ROOT='/etc/trusttunnel/certs'
readonly RELEASES="${CERT_ROOT}/releases"
readonly CURRENT="${CERT_ROOT}/current"
readonly EXPECTED_HOST='turn.trioz.ru'
readonly MAX_ARCHIVE_BYTES=65536

fail() {
  printf 'trusttunnel-cert-receiver: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail 'must run as root'
getent group trusttunnel >/dev/null || fail 'trusttunnel group is missing'
command -v openssl >/dev/null || fail 'openssl is required'
command -v tar >/dev/null || fail 'tar is required'
command -v systemctl >/dev/null || fail 'systemd is required'

install -d -o root -g trusttunnel -m 0750 "${CERT_ROOT}" "${RELEASES}"
incoming="$(mktemp -d "${CERT_ROOT}/.incoming.XXXXXX")"
trap 'rm -rf -- "${incoming}"' EXIT

archive="${incoming}/payload.tar"
# Bound input from the restricted SSH key, even if the sending host is compromised.
dd iflag=count_bytes count="$((MAX_ARCHIVE_BYTES + 1))" \
  of="${archive}" status=none
archive_size="$(stat -c '%s' "${archive}")"
(( archive_size > 0 && archive_size <= MAX_ARCHIVE_BYTES )) \
  || fail 'archive is empty or exceeds the size limit'

tar -tf "${archive}" > "${incoming}/entries" \
  || fail 'invalid tar archive'
mapfile -t entries < "${incoming}/entries"
(( ${#entries[@]} == 2 )) || fail 'archive must contain exactly two files'
if ! { [[ "${entries[0]}" == 'fullchain.pem' && "${entries[1]}" == 'privkey.pem' ]] \
    || [[ "${entries[0]}" == 'privkey.pem' && "${entries[1]}" == 'fullchain.pem' ]]; }; then
  fail 'archive may contain only fullchain.pem and privkey.pem'
fi
tar -tvf "${archive}" --numeric-owner > "${incoming}/listing" \
  || fail 'could not inspect tar members'
awk '
  NF != 6 || substr($1, 1, 1) != "-" || $3 !~ /^[0-9]+$/ || $3 > 32768 {
    invalid = 1
  }
  END { exit invalid }
' "${incoming}/listing" || fail 'archive members must be small regular files'

payload="${incoming}/payload"
install -d -o root -g root -m 0700 "${payload}"
tar --no-same-owner --no-same-permissions -xf "${archive}" -C "${payload}" \
  || fail 'could not extract certificate archive'
[[ -f "${payload}/fullchain.pem" && ! -L "${payload}/fullchain.pem" ]] \
  || fail 'fullchain.pem is not a regular file'
[[ -f "${payload}/privkey.pem" && ! -L "${payload}/privkey.pem" ]] \
  || fail 'privkey.pem is not a regular file'

openssl x509 -in "${payload}/fullchain.pem" -noout -checkhost "${EXPECTED_HOST}" \
  >/dev/null 2>&1 || fail 'certificate does not cover turn.trioz.ru'
openssl x509 -in "${payload}/fullchain.pem" -checkend 2592000 -noout \
  >/dev/null 2>&1 || fail 'certificate expires in less than 30 days'

cert_pub="$(
  openssl x509 -in "${payload}/fullchain.pem" -pubkey -noout |
    openssl pkey -pubin -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}'
)"
key_pub="$(
  openssl pkey -in "${payload}/privkey.pem" -pubout -outform DER 2>/dev/null |
    sha256sum | awk '{print $1}'
)"
[[ -n "${cert_pub}" && "${cert_pub}" == "${key_pub}" ]] \
  || fail 'certificate and private key do not match'

previous=''
if [[ -L "${CURRENT}" ]]; then
  previous="$(readlink "${CURRENT}")"
  [[ "${previous}" == releases/* ]] || fail 'current symlink points outside the release directory'
elif [[ -e "${CURRENT}" ]]; then
  fail 'current certificate path exists but is not a symlink'
fi

release_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
release="${RELEASES}/${release_id}"
install -d -o root -g trusttunnel -m 0750 "${release}"
install -o root -g trusttunnel -m 0640 \
  "${payload}/fullchain.pem" "${release}/fullchain.pem"
install -o root -g trusttunnel -m 0640 \
  "${payload}/privkey.pem" "${release}/privkey.pem"

next_link="${CERT_ROOT}/.current.${$}.new"
ln -s "releases/${release_id}" "${next_link}"
mv -Tf "${next_link}" "${CURRENT}"

if systemctl is-active --quiet trusttunnel; then
  if ! systemctl restart trusttunnel; then
    if [[ -n "${previous}" ]]; then
      rollback_link="${CERT_ROOT}/.current.${$}.rollback"
      ln -s "${previous}" "${rollback_link}"
      mv -Tf "${rollback_link}" "${CURRENT}"
      systemctl restart trusttunnel || true
    else
      rm -f -- "${CURRENT}"
    fi
    fail 'certificate installed but service restart failed; rollback attempted'
  fi
fi

printf 'Installed validated certificate for %s; service was not started if inactive.\n' \
  "${EXPECTED_HOST}"