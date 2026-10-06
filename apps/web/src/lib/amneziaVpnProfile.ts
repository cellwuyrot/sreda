"use client";

/**
 * Упаковка УЖЕ СОБРАННОГО WireGuard/AmneziaWG-профиля в формат AmneziaVPN.
 *
 * Этот модуль намеренно ничего не знает о VpnPeer, маршрутизации, лимитах или
 * параметрах узла. Единственный источник VPN-логики — buildWireGuardConfig():
 * сюда приходит его готовый результат, который лишь перекладывается в JSON,
 * используемый официальным импортёром AmneziaVPN.
 */

const AWG_KEYS = [
  "Jc",
  "Jmin",
  "Jmax",
  "S1",
  "S2",
  "S3",
  "S4",
  "H1",
  "H2",
  "H3",
  "H4",
  "I1",
  "I2",
  "I3",
  "I4",
  "I5",
  "HeaderProtectionKey",
  "ContentPaddingAddition",
  "RekeyAfterTime",
  "RekeyTimeout",
  "RejectAfterTime",
  "KeepaliveTimeout",
  "MaxHandshakeAttempts",
  "RandomTrailers",
  "DisableCookies",
] as const;

interface ParsedConfig {
  values: Record<string, string>;
  hostName: string;
  port: number;
}

export interface AmneziaVpnProfile {
  /** Строка для файла .vpn и QR-кода. */
  uri: string;
  /** Исходный .conf — только fallback, собран тем же buildWireGuardConfig(). */
  wireGuardConfig: string;
}

function parseConfig(config: string): ParsedConfig {
  const values: Record<string, string> = {};
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith(";") ||
      line.startsWith("[")
    )
      continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  const endpoint = values.Endpoint ?? "";
  const match = endpoint.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  if (!match)
    throw new Error("Не удалось определить endpoint готового VPN-профиля");
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("В готовом VPN-профиле указан некорректный порт");
  }
  return { values, hostName: match[1] || match[2], port };
}

async function qCompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("Этот браузер не поддерживает создание профиля AmneziaVPN");
  }
  /* CompressionStream("deflate") выдаёт zlib-поток. qCompress добавляет перед
     ним четыре байта длины исходных данных в big-endian. */
  const compressed = new Uint8Array(
    await new Response(
      new Blob([data.slice().buffer])
        .stream()
        .pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const result = new Uint8Array(4 + compressed.length);
  new DataView(result.buffer).setUint32(0, data.length, false);
  result.set(compressed, 4);
  return result;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  /* Не передаём весь массив через spread: длинный профиль может переполнить
     стек аргументов браузера. */
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Создать совместимый vpn://: JSON → UTF-8 → Qt qCompress → URL-safe Base64.
 * Приватный ключ остаётся только внутри возвращённого локального профиля.
 */
export async function buildAmneziaVpnProfile(
  wireGuardConfig: string,
  description = "TZ Connect",
): Promise<AmneziaVpnProfile> {
  const { values, hostName, port } = parseConfig(wireGuardConfig);
  const allowedIps = (values.AllowedIPs ?? "").split(/\s*,\s*/).filter(Boolean);
  const dns = (values.DNS ?? "").split(/\s*,\s*/).filter(Boolean);

  /* Повторяем структуру, которую официальный ImportController строит при
     импорте стороннего AmneziaWG .conf. config остаётся неизменным: MTU, DNS,
     AllowedIPs и AWG-параметры уже сформированы buildWireGuardConfig(). */
  const lastConfig: Record<string, string | number | string[]> = {
    config: wireGuardConfig,
    hostName,
    port,
    client_priv_key: values.PrivateKey ?? "",
    client_ip: values.Address ?? "",
    server_pub_key: values.PublicKey ?? "",
    allowed_ips: allowedIps,
    persistent_keep_alive: values.PersistentKeepalive ?? "25",
    mtu: values.MTU ?? "",
  };
  for (const key of AWG_KEYS) {
    if (values[key] !== undefined) lastConfig[key] = values[key];
  }

  const payload = {
    format_version: 1,
    containers: [
      {
        container: "amnezia-awg",
        awg: {
          last_config: JSON.stringify(lastConfig),
          isThirdPartyConfig: true,
          port,
          transport_proto: "udp",
        },
      },
    ],
    defaultContainer: "amnezia-awg",
    description,
    hostName,
    dns1: dns[0] ?? "",
    dns2: dns[1] ?? dns[0] ?? "",
  };

  const json = new TextEncoder().encode(JSON.stringify(payload));
  return {
    uri: `vpn://${base64Url(await qCompress(json))}`,
    wireGuardConfig,
  };
}
