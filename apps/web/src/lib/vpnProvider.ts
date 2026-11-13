/**
 * VPN-PROVIDER: provider control plane shared by admin and data-plane routes.
 *
 * TrustTunnel is deliberately not considered ready until its endpoint health,
 * credential lifecycle, per-user accounting and both native client engines are
 * implemented and verified. The admin page reports these blockers; it cannot
 * mark them ready.
 */

export const VPN_PROVIDER_IDS = ["AMNEZIAWG", "TRUSTTUNNEL"] as const;
export type VpnProviderId = (typeof VPN_PROVIDER_IDS)[number];

export const VPN_PROVIDER_LABELS: Record<VpnProviderId, string> = {
  AMNEZIAWG: "AmneziaWG",
  TRUSTTUNNEL: "TrustTunnel",
};

export interface ProviderReadinessCheck {
  id: string;
  label: string;
  status: "BLOCKED" | "READY";
  detail: string;
}

const TRUSTTUNNEL_BLOCKERS: readonly Omit<ProviderReadinessCheck, "status">[] = [
  {
    id: "endpoint-health",
    label: "Endpoint health и TLS",
    detail: "Endpoint v1.1.0 не настроен и не запущен; проверенный health report не подключён.",
  },
  {
    id: "credentials",
    label: "Учётные данные пользователей",
    detail: "Создание, безопасное обновление и отзыв per-user credentials не реализованы.",
  },
  {
    id: "traffic-accounting",
    label: "Учёт трафика",
    detail: "Счётчики v1.1.0 не сопоставляются с пользователями TrioZ; текущие счётчики AmneziaWG сохраняются.",
  },
  {
    id: "android-client",
    label: "Android-клиент",
    detail: "TrustTunnel native adapter не интегрирован и не проверен в сборке.",
  },
  {
    id: "windows-client",
    label: "Windows/Desktop-клиент",
    detail: "TrustTunnel native adapter не интегрирован; сборка и подпись не проверены.",
  },
  {
    id: "turn-gateway",
    label: "Вход через turn",
    detail: "Gateway-код ещё не развёрнут как служба; production-сеть и end-to-end соединение не проверены.",
  },
];

export function parseVpnProvider(value: unknown): VpnProviderId | null {
  // Missing field is tolerated only for legacy unit fixtures and pre-migration
  // reads; actual migrated rows receive AMNEZIAWG from PostgreSQL.
  if (value === undefined || value === null) return "AMNEZIAWG";
  return value === "AMNEZIAWG" || value === "TRUSTTUNNEL" ? value : null;
}

export function isVpnProviderActive(value: unknown, expected: VpnProviderId): boolean {
  return parseVpnProvider(value) === expected;
}

export function trustTunnelReadiness() {
  const checks: ProviderReadinessCheck[] = TRUSTTUNNEL_BLOCKERS.map((check) => ({
    ...check,
    status: "BLOCKED" as const,
  }));
  return { ready: checks.every((check) => check.status === "READY"), checks };
}

export function providerControlView(activeProviderValue: unknown) {
  const activeProvider = parseVpnProvider(activeProviderValue);
  const trustTunnel = trustTunnelReadiness();
  return {
    activeProvider,
    activeProviderLabel: activeProvider ? VPN_PROVIDER_LABELS[activeProvider] : "Неизвестный провайдер",
    trustTunnel: {
      ...trustTunnel,
      switchAllowed: activeProvider === "AMNEZIAWG" && trustTunnel.ready,
    },
    canRollbackToAmneziaWG: activeProvider === "TRUSTTUNNEL" || activeProvider === null,
  };
}
