/**
 * VPN provider control plane shared by admin and data-plane routes.
 *
 * The selected provider is a single persistent project-wide setting. TrustTunnel
 * may be selected when its server-side secrets/configuration are complete and
 * TRIOZ_TT_ENABLED is explicitly enabled. Operational health (agent ACK and
 * client tunnel state) is reported separately; this module never pretends that
 * configuration validation is a live network health check.
 */
import { loadTrustTunnelSettings } from "./trustTunnelAccess";

export const VPN_PROVIDER_IDS = ["AMNEZIAWG", "TRUSTTUNNEL"] as const;
export type VpnProviderId = (typeof VPN_PROVIDER_IDS)[number];

export const VPN_PROVIDER_LABELS: Record<VpnProviderId, string> = {
  AMNEZIAWG: "AmneziaWG",
  TRUSTTUNNEL: "TrustTunnel",
};

export interface ProviderReadinessCheck {
  id: string;
  label: string;
  status: "BLOCKED" | "READY" | "INFO";
  blocking: boolean;
  detail: string;
}

function trustTunnelServerConfigured(env: Record<string, string | undefined>): boolean {
  if (env.TRIOZ_TT_ENABLED !== "true") return false;
  try {
    loadTrustTunnelSettings(env);
    return true;
  } catch {
    return false;
  }
}

export function parseVpnProvider(value: unknown): VpnProviderId | null {
  // Legacy rows created before the provider migration continue to mean AmneziaWG.
  if (value === undefined || value === null) return "AMNEZIAWG";
  return value === "AMNEZIAWG" || value === "TRUSTTUNNEL" ? value : null;
}

export function isVpnProviderActive(value: unknown, expected: VpnProviderId): boolean {
  return parseVpnProvider(value) === expected;
}

export function trustTunnelReadiness(env: Record<string, string | undefined> = process.env) {
  const configured = trustTunnelServerConfigured(env);
  const checks: ProviderReadinessCheck[] = [
    {
      id: "runtime-config",
      label: "Серверная конфигурация и флаг доступа",
      status: configured ? "READY" : "BLOCKED",
      blocking: true,
      detail: configured
        ? "Серверные параметры прошли локальную проверку формата. Это не активная проверка Endpoint или gateway."
        : "Нужны TRIOZ_TT_ENABLED=true и корректно заданные серверные параметры TrustTunnel.",
    },
    {
      id: "credentials",
      label: "Индивидуальные учётные данные и отзыв",
      status: "READY",
      blocking: false,
      detail: "Ключи выводятся на сервере; агент получает зашифрованный снимок и подтверждает применение. Фактическая свежесть видна по ACK.",
    },
    {
      id: "endpoint-health",
      label: "Состояние Endpoint и TLS",
      status: "INFO",
      blocking: false,
      detail: "Активный health probe не подключён. Состояние применения подтверждается агентом, а не этой страницей.",
    },
    {
      id: "turn-gateway",
      label: "Связь turn → Endpoint",
      status: "INFO",
      blocking: false,
      detail: "Оператор сообщил, что межсерверные проверки пройдены. Админка не выполняет сетевых проверок и не меняет настройки серверов.",
    },
    {
      id: "android-client",
      label: "Android-клиент",
      status: "INFO",
      blocking: false,
      detail: "Движок включается в release исходниками; доступен только arm64-v8a. Подписанная сборка и проверка на физическом устройстве остаются обязательными.",
    },
    {
      id: "windows-client",
      label: "Windows-клиент",
      status: "INFO",
      blocking: false,
      detail: "Код службы и проверка файлов присутствуют. Сборку, подпись и реальную работу Windows-клиента нужно проверять отдельно.",
    },
    {
      id: "traffic-accounting",
      label: "Учёт трафика TrustTunnel",
      status: "INFO",
      blocking: false,
      detail: "Учёт трафика TrustTunnel в тарифах TrioZ не реализован. Счётчики AmneziaWG не используются как данные TrustTunnel.",
    },
  ];
  const ready = checks.filter((check) => check.blocking).every((check) => check.status === "READY");
  return { ready, checks };
}

export function providerControlView(
  activeProviderValue: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const activeProvider = parseVpnProvider(activeProviderValue);
  const trustTunnel = trustTunnelReadiness(env);
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
