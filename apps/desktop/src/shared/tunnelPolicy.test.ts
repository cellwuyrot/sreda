import { describe, expect, it } from "vitest";

import {
  ALLOWED_ENDPOINT_PORTS,
  DEFAULT_POLICY,
  checkConfigAgainstPolicy,
  configFields,
  hostMatches,
  parsePolicy,
  splitEndpoint,
} from "./tunnelPolicy";

/**
 * SERVICE-POLICY: проверка профиля перед поднятием туннеля.
 *
 * Почему эти тесты важнее обычных. Профиль доходит до служебного компонента,
 * который работает от SYSTEM и меняет маршруты всей машины. Если сюда пройдёт
 * чужой профиль, весь трафик пользователя уйдёт на чужой сервер, а в приложении
 * при этом будет гореть «соединение активно».
 */

/** Настоящий профиль сервиса — от него отличаются все отрицательные случаи. */
function profile(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    Address: "10.8.0.7/32",
    DNS: "10.8.0.1",
    MTU: "1280",
    Endpoint: "vpn1.trioz.ru:51820",
    AllowedIPs: "0.0.0.0/0",
    ...overrides,
  };
  return [
    "[Interface]",
    `PrivateKey = ${"A".repeat(43)}=`,
    `Address = ${fields.Address}`,
    `DNS = ${fields.DNS}`,
    `MTU = ${fields.MTU}`,
    "",
    "[Peer]",
    `PublicKey = ${"B".repeat(43)}=`,
    `Endpoint = ${fields.Endpoint}`,
    `AllowedIPs = ${fields.AllowedIPs}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}

describe("configFields", () => {
  it("собирает все значимые строки, включая повторные", () => {
    /* Повторная строка — типовой способ обойти проверку, которая смотрит
       только первое вхождение ключа. Здесь видны оба. */
    const fields = configFields("[Peer]\nAllowedIPs = 0.0.0.0/0\nAllowedIPs = 10.8.0.0/24\nDNS = 1.1.1.1, 9.9.9.9\nMTU = 1280");
    expect(fields.allowedIps).toEqual(["0.0.0.0/0", "10.8.0.0/24"]);
    expect(fields.dns).toEqual(["1.1.1.1", "9.9.9.9"]);
    expect(fields.mtu).toBe(1280);
  });

  it("комментарии и секции не считаются значениями", () => {
    const fields = configFields("# Endpoint = evil.example.com:51820\n; DNS = 8.8.8.8\n[Interface]");
    expect(fields.endpoints).toEqual([]);
    expect(fields.dns).toEqual([]);
  });
});

describe("splitEndpoint", () => {
  it("разбирает имя, IPv4 и IPv6 в скобках", () => {
    expect(splitEndpoint("vpn1.trioz.ru:51820")).toEqual({ host: "vpn1.trioz.ru", port: 51820 });
    expect(splitEndpoint("95.81.126.242:443")).toEqual({ host: "95.81.126.242", port: 443 });
    expect(splitEndpoint("[2a00:1::5]:51820")).toEqual({ host: "2a00:1::5", port: 51820 });
  });

  it("отказывает без порта и на невозможных портах", () => {
    expect(splitEndpoint("vpn1.trioz.ru")).toBeNull();
    expect(splitEndpoint("vpn1.trioz.ru:0")).toBeNull();
    expect(splitEndpoint("vpn1.trioz.ru:70000")).toBeNull();
    expect(splitEndpoint("")).toBeNull();
  });
});

describe("hostMatches", () => {
  it("звёздочка покрывает только поддомены, а не чужие окончания", () => {
    expect(hostMatches("vpn1.trioz.ru", "*.trioz.ru")).toBe(true);
    expect(hostMatches("trioz.ru", "*.trioz.ru")).toBe(false);
    /* Классическая ловушка: чужой домен, заканчивающийся на наше имя. */
    expect(hostMatches("evil-trioz.ru", "*.trioz.ru")).toBe(false);
    expect(hostMatches("trioz.ru.evil.com", "*.trioz.ru")).toBe(false);
  });
});

describe("checkConfigAgainstPolicy", () => {
  it("настоящий профиль сервиса проходит", () => {
    expect(checkConfigAgainstPolicy(profile())).toEqual({ ok: true, reason: "" });
  });

  it("все разрешённые порты допустимы", () => {
    for (const port of ALLOWED_ENDPOINT_PORTS) {
      const result = checkConfigAgainstPolicy(profile({ Endpoint: `vpn1.trioz.ru:${port}` }));
      expect(result.ok, `порт ${port}`).toBe(true);
    }
  });

  it("посторонний домен отклоняется", () => {
    const result = checkConfigAgainstPolicy(profile({ Endpoint: "evil.example.com:51820" }));
    expect(result).toEqual({ ok: false, reason: "Точка подключения не принадлежит сервису" });
  });

  it("неразрешённый порт отклоняется с указанием номера", () => {
    const result = checkConfigAgainstPolicy(profile({ Endpoint: "vpn1.trioz.ru:22" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("22");
  });

  it("посторонний сервер имён отклоняется", () => {
    /* Подмена DNS — самый тихий вид перехвата: туннель работает, а все
       запросы имён видны чужой стороне. */
    const result = checkConfigAgainstPolicy(profile({ DNS: "5.5.5.5" }));
    expect(result).toEqual({ ok: false, reason: "Профиль назначает посторонний сервер имён" });
  });

  it("посторонний маршрут отклоняется", () => {
    const result = checkConfigAgainstPolicy(profile({ AllowedIPs: "192.168.0.0/16" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("192.168.0.0/16");
  });

  it("адрес вне подсети сервиса отклоняется", () => {
    const result = checkConfigAgainstPolicy(profile({ Address: "192.168.1.50/32" }));
    expect(result).toEqual({ ok: false, reason: "Адрес интерфейса вне подсети сервиса" });
  });

  it("MTU вне разумных границ отклоняется, а рабочие значения — нет", () => {
    expect(checkConfigAgainstPolicy(profile({ MTU: "9000" })).ok).toBe(false);
    expect(checkConfigAgainstPolicy(profile({ MTU: "100" })).ok).toBe(false);
    expect(checkConfigAgainstPolicy(profile({ MTU: "1280" })).ok).toBe(true);
    expect(checkConfigAgainstPolicy(profile({ MTU: "1420" })).ok).toBe(true);
  });

  it("профиль без точки подключения и без адреса отклоняется", () => {
    expect(checkConfigAgainstPolicy("[Interface]\nDNS = 10.8.0.1").reason).toBe("В профиле нет точки подключения");
    const noAddress = profile();
    expect(checkConfigAgainstPolicy(noAddress.replace(/Address = .*\n/, "")).reason).toBe("В профиле нет адреса интерфейса");
  });

  it("вторая добавленная точка подключения тоже проверяется", () => {
    /* Именно так можно было бы добавить второго «пира» с чужим сервером,
       оставив первого настоящим для виду. */
    const twoPeers = `${profile()}\n\n[Peer]\nEndpoint = evil.example.com:51820\nAllowedIPs = 0.0.0.0/0`;
    expect(checkConfigAgainstPolicy(twoPeers).ok).toBe(false);
  });

  it("числовой адрес узла допустим: узлы добавляются в панели", () => {
    expect(checkConfigAgainstPolicy(profile({ Endpoint: "95.81.126.242:51820" })).ok).toBe(true);
  });
});

describe("parsePolicy", () => {
  it("мусор и пустые списки откатываются к политике по умолчанию", () => {
    expect(parsePolicy("не json")).toBeNull();
    expect(parsePolicy("[]")).toBeNull();
    /* Пустой список НЕ должен отключать проверку: отключённая проверка —
       ровно то, чего добивался бы подменивший файл. */
    expect(parsePolicy('{"endpointHosts":[]}')?.endpointHosts).toEqual(DEFAULT_POLICY.endpointHosts);
    expect(parsePolicy('{"endpointPorts":["443"]}')?.endpointPorts).toEqual(DEFAULT_POLICY.endpointPorts);
  });

  it("свои значения принимаются", () => {
    const policy = parsePolicy('{"endpointHosts":["*.example.net"],"endpointPorts":[443]}');
    expect(policy?.endpointHosts).toEqual(["*.example.net"]);
    expect(policy?.endpointPorts).toEqual([443]);
    /* Неуказанные поля берутся из политики по умолчанию, а не обнуляются. */
    expect(policy?.dnsServers).toEqual(DEFAULT_POLICY.dnsServers);
  });
});
