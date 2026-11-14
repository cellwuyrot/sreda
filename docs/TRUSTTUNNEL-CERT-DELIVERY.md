# TrustTunnel certificate delivery (connect → VDS)

This adds a narrowly scoped renewal path for the existing `turn.trioz.ru`
certificate. It does not change Nginx, DNS, firewall rules, VPN credentials, or
the active TrioZ provider.

## Security model

- The VDS receiver is a root-owned forced command. A dedicated SSH key can send
  one bounded tar archive containing exactly `fullchain.pem` and `privkey.pem`;
  it cannot request a shell, forwarding, or a PTY.
- The receiver checks the hostname, validity window, and certificate/key match,
  then installs a root-owned `root:trusttunnel` pair with mode `0640`.
- It switches a `current` symlink atomically. It restarts TrustTunnel only when
  the service is already active; it never enables or starts the service.
- Certbot invokes the sender only when the `turn.trioz.ru` lineage is renewed.
  The SSH host key must already be verified in root's `known_hosts`.
- The VDS retains versioned certificate copies for rollback. The private key is
  therefore present on VDS and accessible to the TrustTunnel service account.

## Installation sequence

1. On VDS, install `receive-cert.sh` as
   `/usr/local/sbin/trusttunnel-cert-receiver`, owned by `root:root`, mode
   `0755`. Do this only after confirming the `trusttunnel` group exists.
2. On connect, create a dedicated root-only Ed25519 key at
   `/root/.ssh/trusttunnel-cert-sync`. Do not reuse it for general SSH.
3. Add only its public key to root's `authorized_keys` on VDS, prefixed with:

   ```text
   restrict,command="/usr/local/sbin/trusttunnel-cert-receiver"
   ```

   Keep the existing authorized keys unchanged. Do not copy the private key.
4. Install `certbot-deploy-hook.sh` on connect at
   `/etc/letsencrypt/renewal-hooks/deploy/trusttunnel-vds.sh`, owned by
   `root:root`, mode `0750`.
5. Test the hook once by setting `RENEWED_LINEAGE` to the existing lineage and
   verify the certificate on VDS. The receiver must not start an inactive
   service. Do not enable or start TrustTunnel until its configuration has
   passed review and a separate test-start step is taken.

The files contain no credentials. Review them before deployment. The VDS IPv4
target and certificate lineage are specific to this deployment and must be
verified before installation.