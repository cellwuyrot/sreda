# TrustTunnel Stage 7 — provider control on connect

This patch adds a persistent, administrator-only global provider control to the
existing TrioZ VPN service. It does **not** activate TrustTunnel.

## Behavior

- `VpnSettings.activeProvider` is a single global setting. Its migration default
  is `AMNEZIAWG`; existing subscriptions, peers, and usage counters are left
  intact.
- The admin VPN page shows the active provider, the TrustTunnel readiness
  blockers, and a confirmed switch action. Users do not choose a technology.
- `POST /api/admin/vpn/provider` requires an ADMIN session, same-origin request,
  explicit confirmation, and the provider state the administrator confirmed.
  Updates use a serializable transaction and compare-and-set; successful changes
  and blocked TrustTunnel attempts are recorded in `AuditLog`.
- Returning to AmneziaWG is always available as a rollback. Switching to
  TrustTunnel is rejected until every server-side readiness gate is implemented
  and actually passes.
- If a non-AmneziaWG or unknown provider is stored, the AmneziaWG profile,
  enrollment, deletion, admin peer issuance, and node peer delivery fail closed.
  VPN node reports do not update AmneziaWG handshakes or usage while that
  provider is inactive. AmneziaWG usage totals are hidden rather than presented
  as TrustTunnel usage.
- TrustTunnel credentials and private keys are not collected or stored by this
  control page.

## Current readiness blockers

The readiness report intentionally marks all of these as blocked:

1. Endpoint v1.1.0 configuration, TLS validation, and authenticated health report.
2. Per-user credential creation, refresh, and revocation.
3. Verified per-user traffic ingestion and mapping into TrioZ accounts.
4. Android native adapter and tested build.
5. Windows/Desktop native adapter, build, and signing.
6. Turn gateway deployment and real end-to-end validation.

These are implementation blockers, not editable administrator checkboxes. The
HTTP API independently enforces the same gate, so a crafted browser request
cannot force a switch.

## Database and application rollout

Apply the migration before deploying code that reads the new column. Back up
the database and use the existing release procedure:

```bash
npm run migrate -w apps/web
npm run build -w apps/web
```

Then verify in the admin page that `AmneziaWG` remains active and TrustTunnel is
blocked. Do not start the Endpoint, change firewall/Nginx/DNS, or switch users
as part of this stage.

## Tests

Run the provider-control, user-route, node-report, and admin VPN tests with the
project's Vitest setup, then run the web typecheck. These require the repository's
normal installed dependencies and generated Prisma client.

This stage is control-plane groundwork only; it is not production readiness and
does not provide an Android APK or Windows build.
