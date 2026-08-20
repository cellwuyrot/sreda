/**
 * Тесты встроенного клиента туннеля.
 *
 * Раньше профиль разбирали сторонние `wg` и `wg-quick` — и ошибки разбора были
 * их заботой. Теперь это наш код, и всё, что он делает неверно, ломается самым
 * неприятным способом: туннель «включён», а трафика нет. Поэтому здесь закреплено
 * то, что нельзя проверить глазами: порядок строк UAPI, перевод ключей и
 * защита от маршрутной петли в режиме «весь трафик».
 *
 * Запуск процессов и права ОС здесь не участвуют: без реальной машины их всё
 * равно не проверить.
 */
import { describe, it, expect } from "vitest";
import {
  base64KeyToHex,
  embeddedClientName,
  endpointHost,
  ifaceDownCommands,
  ifaceUpCommands,
  ipv4Mask,
  isUsableConfig,
  parseUapiHandshake,
  parseWgConfig,
  ROUTE_MARK,
  routesEverything,
  uapiSetRequest,
  uapiSocketPath,
  DEFAULT_KEEPALIVE_SECONDS,
  wintunSearchDirs,
  excludeRouteCommand,
  excludeRouteDeleteCommand,
  parseDefaultRoute,
} from "./vpnEmbedded";

/** Реальные 32-байтные ключи: короткие заглушки здесь не пройдут — и это верно. */
const PRIV = "QOM2s3xS1S4H1H2gP+aBcDeFgHiJkLmNoPqRsTuVwXY=";
const PUB = "HdS1S2H1I5aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456=";

const ALL = [
  "[Interface]",
  `PrivateKey = ${PRIV}`,
  "Address = 10.8.0.7/32",
  "DNS = 1.1.1.1",
  "MTU = 1380",
  "",
  "[Peer]",
  `PublicKey = ${PUB}`,
  "Endpoint = vpn1.example.ru:51820",
  "AllowedIPs = 0.0.0.0/0, ::/0",
  "PersistentKeepalive = 25",
].join("\n");

const SERVICES = [
  "[Interface]",
  `PrivateKey = ${PRIV}`,
  "Address = 10.8.0.7/32",
  "",
  "[Peer]",
  `PublicKey = ${PUB}`,
  "Endpoint = vpn1.example.ru:51820",
  "AllowedIPs = 10.8.0.0/24",
].join("\n");

describe("разбор профиля", () => {
  it("читает адрес, MTU и пира", () => {
    const parsed = parseWgConfig(ALL);
    expect(parsed.privateKey).toBe(PRIV);
    expect(parsed.addresses).toEqual(["10.8.0.7/32"]);
    expect(parsed.mtu).toBe(1380);
    expect(parsed.peers).toHaveLength(1);
    expect(parsed.peers[0].endpoint).toBe("vpn1.example.ru:51820");
    expect(parsed.peers[0].allowedIps).toEqual(["0.0.0.0/0", "::/0"]);
    expect(parsed.peers[0].persistentKeepalive).toBe(25);
    expect(isUsableConfig(parsed)).toBe(true);
  });

  it("ИНВАРИАНТ: профиль без ключа или адреса непригоден", () => {
    /* Лучше отказать сразу, чем поднять пустой интерфейс и сказать «включено». */
    expect(isUsableConfig(parseWgConfig("[Interface]\nAddress = 10.8.0.7/32"))).toBe(false);
    expect(isUsableConfig(parseWgConfig(`[Interface]\nPrivateKey = ${PRIV}`))).toBe(false);
  });

  it("отличает «весь трафик» от частичного режима", () => {
    expect(routesEverything(parseWgConfig(ALL))).toBe(true);
    expect(routesEverything(parseWgConfig(SERVICES))).toBe(false);
  });
});

describe("UAPI", () => {
  it("переводит ключ в hex и отвергает мусор", () => {
    expect(base64KeyToHex(PRIV)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => base64KeyToHex("короткий")).toThrow(/неверную длину/);
  });

  it("ИНВАРИАНТ: параметры устройства — до первого public_key", () => {
    /* В UAPI всё после `public_key=` относится к пиру. Стоит fwmark уехать ниже —
       и клиент отвергнет запрос целиком, ровно когда нужно включить VPN. */
    const req = uapiSetRequest(parseWgConfig(ALL), true, "linux");
    const lines = req.split("\n");
    expect(lines[0]).toBe("set=1");
    const mark = lines.findIndex((l) => l === `fwmark=${ROUTE_MARK}`);
    const peer = lines.findIndex((l) => l.startsWith("public_key="));
    expect(mark).toBeGreaterThan(0);
    expect(mark).toBeLessThan(peer);
    expect(lines.indexOf("replace_peers=true")).toBeLessThan(peer);
    expect(req.endsWith("\n\n")).toBe(true);
  });

  it("FIX-WGHANDSHAKE: keepalive задаётся всегда — иначе рукопожатие не начнётся", () => {
    /* Профиль без PersistentKeepalive — именно на таком клиент молчал: адаптер
       поднят, ключи заданы, а первый пакет так и не ушёл. */
    const noKeepalive = ALL.filter((line) => !line.startsWith("PersistentKeepalive"));
    const req = uapiSetRequest(parseWgConfig(noKeepalive), true, "win32");
    expect(req).toContain(`persistent_keepalive_interval=${DEFAULT_KEEPALIVE_SECONDS}`);

    /* Значение из профиля при этом остаётся главным. */
    const custom = ALL.map((line) =>
      line.startsWith("PersistentKeepalive") ? "PersistentKeepalive = 15" : line,
    );
    expect(uapiSetRequest(parseWgConfig(custom), true, "win32")).toContain(
      "persistent_keepalive_interval=15",
    );
  });

  it("метка маршрутизации — только в Linux и только для «всего трафика»", () => {
    expect(uapiSetRequest(parseWgConfig(ALL), true, "darwin")).not.toContain("fwmark=");
    expect(uapiSetRequest(parseWgConfig(ALL), false, "linux")).not.toContain("fwmark=");
  });

  it("FIX-WINTUN: ищет системную wintun.dll в известных местах установки", () => {
    const dirs = wintunSearchDirs({
      TRIOZ_WINTUN_DIR: "D:\\my",
      ProgramFiles: "C:\\Program Files",
      SystemRoot: "C:\\Windows",
    });
    /* Явно указанный путь — первый: он для нестандартных сборок. */
    expect(dirs[0]).toBe("D:\\my");
    expect(dirs).toContain("C:\\Program Files\\Wintun\\bin\\amd64");
    expect(dirs).toContain("C:\\Windows\\System32");
  });

  it("берёт самое свежее рукопожатие из ответа get=1", () => {
    const response = [
      "private_key=00",
      "public_key=aa",
      "last_handshake_time_sec=0",
      "public_key=bb",
      "last_handshake_time_sec=1750000000",
      "errno=0",
      "",
    ].join("\n");
    expect(parseUapiHandshake(response)).toBe(1750000000);
    expect(parseUapiHandshake("errno=0\n\n")).toBe(0);
  });
});

describe("настройка интерфейса", () => {
  it("Linux: адрес, MTU, подъём и отдельная таблица для «всего трафика»", () => {
    const cmds = ifaceUpCommands("linux", parseWgConfig(ALL)).map((c) => c.join(" "));
    expect(cmds).toContain("ip -4 address add 10.8.0.7/32 dev trioz");
    expect(cmds).toContain("ip link set mtu 1380 dev trioz");
    expect(cmds).toContain("ip link set trioz up");
    expect(cmds).toContain(`ip -4 route add 0.0.0.0/0 dev trioz table ${ROUTE_MARK}`);
    /* Без этого правила локальная сеть (принтеры, NAS) уедет в туннель. */
    expect(cmds).toContain("ip -4 rule add table main suppress_prefixlength 0");
  });

  it("ИНВАРИАНТ: в частичном режиме маршрута по умолчанию нет", () => {
    /* «Только сервисы», уводящие весь трафик, — это обман пользователя. */
    const cmds = ifaceUpCommands("linux", parseWgConfig(SERVICES)).map((c) => c.join(" "));
    expect(cmds.some((c) => c.includes("0.0.0.0/0"))).toBe(false);
    expect(cmds).toContain("ip -4 route add 10.8.0.0/24 dev trioz");
  });

  it("macOS: от петли спасает маршрут до точки подключения и две половины маршрута", () => {
    const conf = ALL.replace("vpn1.example.ru:51820", "203.0.113.10:51820");
    const cmds = ifaceUpCommands("darwin", parseWgConfig(conf)).map((c) => c.join(" "));
    expect(cmds.some((c) => c.includes("203.0.113.10/32"))).toBe(true);
    expect(cmds.some((c) => c.includes("0.0.0.0/1"))).toBe(true);
    expect(cmds.some((c) => c.includes("128.0.0.0/1"))).toBe(true);
  });

  it("уборка снимает то, что не исчезает с процессом", () => {
    /* Интерфейс уйдёт вместе с клиентом, а правила маршрутизации — нет. */
    const cmds = ifaceDownCommands("linux", "trioz").map((c) => c.join(" "));
    expect(cmds.some((c) => c.includes("rule") && c.includes("del"))).toBe(true);
    /* В Windows адаптер удаляет Wintun, а маршруты половин остались бы в
       таблице и тихо съедали весь трафик после выключения. */
    const win = ifaceDownCommands("win32", "trioz").map((c) => c.join(" "));
    expect(win.every((c) => c.startsWith("netsh "))).toBe(true);
    expect(win.some((c) => c.includes("delete route 0.0.0.0/1"))).toBe(true);
    expect(win.some((c) => c.includes("delete route 128.0.0.0/1"))).toBe(true);
  });

  it("Windows настраивается штатным netsh и без маршрута по умолчанию", () => {
    const cmds = ifaceUpCommands("win32", parseWgConfig(ALL)).map((c) => c.join(" "));
    /* Ни одного стороннего инструмента: только то, что есть в любой Windows. */
    expect(cmds.every((c) => c.startsWith("netsh "))).toBe(true);
    /* /32 в профиле → маска для netsh: он не понимает длину префикса. */
    expect(cmds.some((c) => c.includes("address=10.8.0.7 mask=255.255.255.255"))).toBe(true);
    expect(cmds.some((c) => c.includes("mtu=1380"))).toBe(true);
    /* DNS туннеля — иначе имена утекают к прежнему серверу. */
    expect(cmds.some((c) => c.includes("dnsservers") && c.includes("1.1.1.1"))).toBe(true);
    /* Две половины вместо 0.0.0.0/0: системный шлюз остаётся на месте, и
       пакеты самого туннеля не заворачиваются в туннель. */
    expect(cmds.some((c) => c.includes("add route 0.0.0.0/1"))).toBe(true);
    expect(cmds.some((c) => c.includes("add route 128.0.0.0/1"))).toBe(true);
    expect(cmds.some((c) => c.includes("0.0.0.0/0"))).toBe(false);
  });

  it("хост точки подключения без порта, включая IPv6 в скобках", () => {
    expect(endpointHost("vpn1.example.ru:51820")).toBe("vpn1.example.ru");
    expect(endpointHost("[2001:db8::1]:51820")).toBe("2001:db8::1");
  });
});

describe("раскладка встроенного клиента", () => {
  it("имена файлов совпадают с тем, что кладёт vendor-wireguard.mjs", () => {
    /* Расхождение здесь даёт сборку, в которой клиент есть, но «не найден». */
    /* На Windows именно `wireguard-go.exe`, а НЕ официальный `wireguard.exe`:
       тот ставит службу и открывает своё окно. */
    expect(embeddedClientName("win32", "wireguard")).toBe("wireguard-go.exe");
    expect(embeddedClientName("win32", "amneziawg")).toBe("amneziawg-go.exe");
    expect(embeddedClientName("linux", "wireguard")).toBe("wireguard-go");
    expect(embeddedClientName("darwin", "wireguard")).toBe("wireguard-go");
  });

  it("сокет UAPI — туда, куда его кладёт сам клиент", () => {
    expect(uapiSocketPath("linux", "trioz")).toBe("/var/run/wireguard/trioz.sock");
    expect(uapiSocketPath("darwin", "trioz")).toBe("/var/run/wireguard/trioz.sock");
    /* В Windows это именованный канал, а не файл. */
    expect(uapiSocketPath("win32", "trioz")).toBe(
      "\\\\.\\pipe\\ProtectedPrefix\\Administrators\\WireGuard\\trioz",
    );
  });

  it("маска IPv4 из длины префикса", () => {
    expect(ipv4Mask(32)).toBe("255.255.255.255");
    expect(ipv4Mask(24)).toBe("255.255.255.0");
    expect(ipv4Mask(0)).toBe("0.0.0.0");
  });
});

describe("маршрут-исключение до VPN-узла (Windows)", () => {
  it("ведёт трафик до узла через прежний шлюз, а не в туннель", () => {
    expect(excludeRouteCommand("203.0.113.10", "192.168.1.1", 12)).toEqual([
      "netsh", "interface", "ipv4", "add", "route", "203.0.113.10/32",
      "interface=12", "nexthop=192.168.1.1", "store=active",
    ]);
  });

  it("снимается тем же адресом и интерфейсом", () => {
    expect(excludeRouteDeleteCommand("203.0.113.10", 12)).toEqual([
      "netsh", "interface", "ipv4", "delete", "route", "203.0.113.10/32",
      "interface=12", "store=active",
    ]);
  });

  it("читает шлюз и индекс из ответа системы", () => {
    expect(parseDefaultRoute(" 192.168.1.1 14 \r\n")).toEqual({
      gateway: "192.168.1.1",
      interfaceIndex: 14,
    });
  });

  it("на пустой или нулевой ответ не выдумывает шлюз", () => {
    expect(parseDefaultRoute("")).toBeNull();
    expect(parseDefaultRoute("0.0.0.0 5")).toBeNull();
  });
});
