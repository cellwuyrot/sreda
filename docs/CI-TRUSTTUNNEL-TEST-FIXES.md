# CI fixes: TrustTunnel provider-control integration

## Failure observed

The `npm run test -w apps/web -- --maxWorkers=2` CI step reported 22 failing tests.
The failures were grouped around the newly introduced global VPN-provider check:

- Existing `PremiumInfoModal` tests mocked only `/api/vpn/me`. The component now
  requests `/api/vpn/trusttunnel` first to identify the project-wide selected
  technology. Returning an Amnezia state object for that URL made the component
  correctly fail closed, so legacy Amnezia controls never rendered.
- TrustTunnel Endpoint-sync tests did not set the global `VpnSettings` row.
  Desired credentials are now emitted only when the common VPN service is
  enabled and `activeProvider` is `TRUSTTUNNEL`; without that fixture the route
  returned 503 after the mock database produced no settings row.
- The non-blocking credentials capability was labelled `READY` while the other
  non-probed readiness checks were `INFO`.
- The Android JS bridge always materialized `confirmed: false`, even for older
  native bridges that do not send the optional field.

## Changes

- Updated browser and Android UI test fetch routing so `/api/vpn/trusttunnel`
  returns the explicit global AmneziaWG selection, while `/api/vpn/me` remains
  independently mocked for the data-plane state.
- Updated Endpoint-sync test fixtures to explicitly select and enable
  TrustTunnel. Added regression coverage for empty snapshots when AmneziaWG is
  selected or the global VPN service is disabled.
- Kept credential capability informational (non-blocking) until a live
  per-snapshot ACK exists; operational application remains represented by ACK.
- Kept the Android bridge's `confirmed` property optional for compatibility,
  while preserving explicit native boolean values.

## Validation scope

Run the exact CI commands in `.github/workflows/ci.yml`, especially:

```bash
npm run test -w apps/web -- --maxWorkers=2
npm run typecheck -w apps/web
npm run typecheck
npm run lint
npm run build
```

A local pass does not replace the GitHub Actions run. No server-side network
checks are performed by these tests.
