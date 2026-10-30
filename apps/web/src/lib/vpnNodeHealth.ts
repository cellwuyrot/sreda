/** Only local configuration health. Never describe it as a successful Internet test. */
export const VPN_HEALTH_FIELDS = [
  "vpnInterface",
  "vpnListener",
  "vpnForwarding",
  "vpnNat",
  "vpnForwardOut",
  "vpnForwardIn",
  "vpnUdp",
] as const;
const STATES = new Set(["ready", "missing", "unknown"]);
export function sanitizeVpnHealth(
  source: Record<string, unknown>,
): Record<string, string | number> {
  if (source.vpnHealthVersion !== 1) return {};
  const out: Record<string, string | number> = { vpnHealthVersion: 1 };
  for (const field of VPN_HEALTH_FIELDS)
    if (STATES.has(String(source[field]))) out[field] = String(source[field]);
  if (
    ["disabled", "unchanged", "applied", "failed"].includes(
      String(source.vpnRepair),
    )
  )
    out.vpnRepair = String(source.vpnRepair);
  for (const field of [
    "vpnCheckedAtMs",
    "vpnRecentPeers",
    "vpnBidirectionalPeers",
  ]) {
    const raw = source[field];
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0)
      out[field] = raw;
  }
  if (
    typeof source.vpnEgress === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/.test(source.vpnEgress)
  )
    out.vpnEgress = source.vpnEgress;
  if (
    typeof source.vpnSubnet === "string" &&
    /^\d{1,3}(\.\d{1,3}){3}\/(?:[1-9]|[12]\d|30)$/.test(source.vpnSubnet) &&
    source.vpnSubnet
      .split("/")[0]
      .split(".")
      .every((n) => Number(n) <= 255)
  )
    out.vpnSubnet = source.vpnSubnet;
  return out;
}
export function vpnHealthView(
  report: Record<string, unknown> | null,
  online: boolean,
  now = Date.now(),
) {
  const health = sanitizeVpnHealth(report ?? {});
  const checked = health.vpnCheckedAtMs;
  const fresh =
    online &&
    typeof checked === "number" &&
    now - checked >= -30_000 &&
    now - checked <= 120_000;
  const failed = VPN_HEALTH_FIELDS.filter(
    (field) => health[field] === "missing",
  );
  const complete = VPN_HEALTH_FIELDS.every(
    (field) => health[field] === "ready",
  );
  const status = !fresh
    ? "unknown"
    : failed.length
      ? "degraded"
      : complete
        ? "ready"
        : "unknown";
  return { health, fresh, status, failed };
}
