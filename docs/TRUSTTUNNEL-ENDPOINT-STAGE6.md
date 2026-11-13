# TrustTunnel Endpoint v1.1.0 — Stage 6 deployment scaffold

This stage only installs the already-verified Endpoint binary and a restricted,
**disabled** systemd unit. It is not the TrioZ provider integration and does not
start TrustTunnel, open ports, alter Nginx, create users' credentials, change
AmneziaWG, or switch clients.

## Findings this stage is based on

- On the TrioZ VPN host, Nginx already owns TCP 443 on IPv4 and IPv6. Do not
  configure TrustTunnel to bind port 443 on this host.
- TCP 8443 and TCP 1987 were free at the time of the operator's check; recheck
  immediately before configuring them.
- The checked Endpoint binary is v1.1.0 with SHA-256
  `9bb15f4e30e2ff196cf0aa387462c42387d9405ddfeb5caad133838560fa33cd`.
- No TrustTunnel service or configuration files were present in the reported
  checks. Therefore the endpoint is not yet configured or running.

## Install command (VPN host only; changes OS files, does not start service)

Run only after reviewing the script and confirming the host/path. Keep the
service disabled until the TOML and certificate permissions have been reviewed.

```bash
cd /root/trioz-tt-test.vxVIcAHx/trusttunnel-v1.1.0-linux-x86_64
printf '%s  %s\n' '9bb15f4e30e2ff196cf0aa387462c42387d9405ddfeb5caad133838560fa33cd' 'trusttunnel_endpoint' | sha256sum -c -
./trusttunnel_endpoint --version
```

Transfer this repository patch to the VPN host through the team's normal
reviewed deployment process, then run:

```bash
sudo bash deploy/trusttunnel/install-v1.1.0.sh --install \
  /root/trioz-tt-test.vxVIcAHx/trusttunnel-v1.1.0-linux-x86_64/trusttunnel_endpoint
```

The installer checks the exact version and digest, creates a `trusttunnel`
system account, installs the binary and a systemd unit, and runs
`systemctl daemon-reload`. It deliberately does **not** enable or start the
service. It refuses to overwrite an existing service unit or a different
binary. The setup wizard is not installed or run by this script.

## Before any service start

1. Review the output of `trusttunnel_endpoint --help` and use the matching
   v1.1.0 setup/configuration documentation to create `vpn.toml`, `hosts.toml`,
   `credentials.toml`, and (if configured) `rules.toml`. Never paste these file
   contents into chat or commit them to Git.
2. Configure a non-conflicting listener on a dedicated address/port. Since Nginx
   occupies 443, do not use 443 for this Endpoint. A candidate such as IPv6
   `:8443` must be validated against the actual global IPv6 address, firewall,
   route through `turn`, and current `ss` output before use.
3. Keep each config file root-owned and readable only by root/the `trusttunnel`
   group as required; the TLS private key must not be world-readable. The
   systemd service runs as the unprivileged `trusttunnel` user, so validate its
   read access to the certificate chain and key before enabling it.
4. The reported stage5 gateway is TCP-only. It can carry TCP-based HTTP/1.1 or
   HTTP/2 as an opaque stream, but it cannot carry QUIC/HTTP/3 UDP. Do not enable
   QUIC through that gateway and claim it is working.
5. TrustTunnel v1.1.0's per-client metrics include usernames and client IPs.
   If enabled for traffic accounting, bind metrics to loopback/protected
   administration only; never expose the metrics port publicly.
6. Do not assume SIGHUP reloads `credentials.toml`; the documented SIGHUP
   behavior is TLS-host settings reload. Credential changes require a separately
   tested, controlled refresh/restart process and audit trail.

## Verify scaffold without starting it

```bash
sudo systemctl is-enabled trusttunnel || true
sudo systemctl is-active trusttunnel || true
sudo systemd-analyze verify /etc/systemd/system/trusttunnel.service
sudo systemctl cat trusttunnel
```

Expected before configuration: service is not enabled and not active. Do not run
`systemctl enable --now trusttunnel` until the endpoint config, TLS files,
network path, credential behavior, monitoring, and rollback plan are reviewed.

## What is not implemented here

- TrioZ provider abstraction, DB migration, admin UI/switch lock/audit.
- TrustTunnel credential provisioning/revocation or subscription delivery.
- Traffic ingestion/mapping into existing `VpnPeer` usage counters.
- Electron/Windows or Android native TrustTunnel client integration.
- Turn gateway systemd deployment, UDP/QUIC forwarding, or production cutover.

Those are separate stages and must not be represented by this scaffold as done.
