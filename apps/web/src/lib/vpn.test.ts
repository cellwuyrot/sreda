/**
 * Тесты: src/lib/vpn.ts — серверная часть выдачи доступа к WireGuard.
 *
 * Модуль был без тестов вовсе, а в нём держится всё: право на доступ, выдача
 * адресов, выбор узла, закрепление внешнего адреса и разбор того, что узел
 * сообщает о себе. Разбор VPN «от разворачивания до работы» нашёл здесь три
 * поломки, и на каждую ниже стоит отдельный ИНВАРИАНТ:
 *
 *   1. адрес выдавался в пределах узла, а уникальность в базе была глобальной —
 *      второй VPN-узел падал на первом же пире;
 *   2. при переезде пира на другой узел сохранялся прежний адрес — на новом узле
 *      он мог быть занят;
 *   3. право на VPN проверялось только в момент выдачи, поэтому туннель
 *      переживал и конец подписки, и бан.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  VPN_ALLOWED_IPS,
  VPN_DEFAULT_PORT,
  VPN_SERVER_ADDRESS,
  VPN_SERVICE_ALLOWED_IPS,
  allocateAddress,
  assignExitIp,
  chooseAddress,
  hasVpnEntitlement,
  isPeerEntitled,
  isTransport,
  isVpnRouting,
  isValidWireGuardKey,
  nodeTunnel,
  normalizeWgEndpoint,
  parseObfuscation,
  parsePublicIps,
  pickVpnNode,
  readWgReport,
  rebalanceExitIps,
  routingAllowedIps,
} from "@/lib/vpn";

/** Настоящий публичный ключ WireGuard: 32 байта в base64. */
const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");

describe("isValidWireGuardKey", () => {
  it("принимает 32 байта в base64", () => {
    expect(isValidWireGuardKey(KEY)).toBe(true);
  });

  it("отвергает всё, что не 44 символа", () => {
    expect(isValidWireGuardKey("")).toBe(false);
    expect(isValidWireGuardKey(KEY.slice(0, 43))).toBe(false);
    expect(isValidWireGuardKey(`${KEY}=`)).toBe(false);
  });

  /**
   * ИНВАРИАНТ: ключ уходит в конфиг узла и в профиль клиента. Мусор той же длины
   * не должен пройти — иначе `wg set` отвалится уже на узле, где ошибку никто не
   * увидит.
   */
  it("ИНВАРИАНТ: длина не заменяет проверку содержимого", () => {
    expect(isValidWireGuardKey("!".repeat(43) + "=")).toBe(false);
    expect(isValidWireGuardKey(Buffer.alloc(31, 1).toString("base64").padEnd(44, "="))).toBe(false);
  });

  it("не строка — не ключ", () => {
    expect(isValidWireGuardKey(null)).toBe(false);
    expect(isValidWireGuardKey(42)).toBe(false);
    expect(isValidWireGuardKey({ toString: () => KEY })).toBe(false);
  });
});

describe("normalizeWgEndpoint", () => {
  it("хост без порта получает стандартный", () => {
    expect(normalizeWgEndpoint("vpn1.example.ru")).toBe(`vpn1.example.ru:${VPN_DEFAULT_PORT}`);
  });

  it("порт сохраняется", () => {
    expect(normalizeWgEndpoint("1.2.3.4:51821")).toBe("1.2.3.4:51821");
  });

  /**
   * ИНВАРИАНТ: у WireGuard нет URL. Администратор всё равно вставит ссылку —
   * схема и путь срезаются, чтобы получилось рабочее значение, а не пустое поле.
   */
  it("ИНВАРИАНТ: вставленная ссылка превращается в host:port", () => {
    expect(normalizeWgEndpoint("https://vpn1.example.ru/panel")).toBe(`vpn1.example.ru:${VPN_DEFAULT_PORT}`);
  });

  it("IPv6 в скобках понимается вместе с портом", () => {
    expect(normalizeWgEndpoint("[2001:db8::1]:51821")).toBe("[2001:db8::1]:51821");
    expect(normalizeWgEndpoint("2001:db8::1")).toBe(`[2001:db8::1]:${VPN_DEFAULT_PORT}`);
  });

  it("мусор и пустое значение дают пустую строку", () => {
    expect(normalizeWgEndpoint("")).toBe("");
    expect(normalizeWgEndpoint("   ")).toBe("");
    expect(normalizeWgEndpoint("хост:51820")).toBe("");
    expect(normalizeWgEndpoint("1.2.3.4:99999")).toBe("");
    expect(normalizeWgEndpoint("1.2.3.4:0")).toBe("");
    expect(normalizeWgEndpoint(null)).toBe("");
  });
});

describe("parsePublicIps", () => {
  it("разбирает список и убирает повторы", () => {
    expect(parsePublicIps("1.2.3.4, 1.2.3.5 ,1.2.3.4")).toEqual(["1.2.3.4", "1.2.3.5"]);
  });

  it("нечисловое и явно неверное отбрасывается", () => {
    expect(parsePublicIps("1.2.3.4, 999.1.1.1, домен.ру, 1.2.3")).toEqual(["1.2.3.4"]);
  });

  it("пустая строка — пустой пул", () => {
    expect(parsePublicIps("")).toEqual([]);
  });
});

describe("allocateAddress", () => {
  it("первый пир получает второй адрес подсети: первый занят сервером", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([]));
    expect(await allocateAddress("n1")).toBe("10.8.0.2");
    expect(VPN_SERVER_ADDRESS).toBe("10.8.0.1");
  });

  it("занятые адреса пропускаются", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([{ address: "10.8.0.2" }, { address: "10.8.0.3" }]));
    expect(await allocateAddress("n1")).toBe("10.8.0.4");
  });

  it("подсеть кончилась — null, а не переполнение", async () => {
    const taken = Array.from({ length: 253 }, (_, i) => ({ address: `10.8.0.${i + 2}` }));
    prismaMock.vpnPeer.findMany.mockResolvedValue(row(taken));
    expect(await allocateAddress("n1")).toBeNull();
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: занятость считается в пределах узла. Подсеть
   * 10.8.0.0/24 поднята на каждом узле, поэтому 10.8.0.2 на двух узлах — два
   * разных туннеля. Глобальная уникальность в базе делала второй узел
   * неработоспособным: первый же пир получал отказ на записи вместо доступа.
   */
  it("ИНВАРИАНТ: занятость считается только по своему узлу", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([]));
    await allocateAddress("n2");
    const args = prismaMock.vpnPeer.findMany.mock.calls[0][0] as { where: { nodeId: string } };
    expect(args.where).toEqual({ nodeId: "n2" });
  });
});

describe("chooseAddress", () => {
  it("на своём узле адрес сохраняется", async () => {
    expect(await chooseAddress("n1", { nodeId: "n1", address: "10.8.0.9" })).toBe("10.8.0.9");
    expect(prismaMock.vpnPeer.findMany).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: при переезде на другой узел адрес выдаётся заново. Узел выключили,
   * человек перевыпустил доступ — прежний адрес в подсети нового узла может быть
   * занят кем-то другим, и попытка его сохранить заканчивалась отказом на записи
   * вместо переезда.
   */
  it("ИНВАРИАНТ: при переезде на другой узел адрес берётся из его подсети", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([{ address: "10.8.0.2" }]));
    expect(await chooseAddress("n2", { nodeId: "n1", address: "10.8.0.2" })).toBe("10.8.0.3");
  });

  it("пира ещё нет — обычная выдача", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([]));
    expect(await chooseAddress("n1", null)).toBe("10.8.0.2");
  });
});

describe("assignExitIp", () => {
  it("пула нет — пустая строка: узел выпустит общим адресом", async () => {
    expect(await assignExitIp("n1", "")).toBe("");
    expect(prismaMock.vpnPeer.findMany).not.toHaveBeenCalled();
  });

  it("берётся наименее занятый адрес пула", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([{ exitIp: "1.2.3.4" }, { exitIp: "1.2.3.4" }, { exitIp: "1.2.3.5" }]),
    );
    expect(await assignExitIp("n1", "1.2.3.4, 1.2.3.5, 1.2.3.6")).toBe("1.2.3.6");
  });

  it("чужие значения в подсчёт не идут", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([{ exitIp: "9.9.9.9" }, { exitIp: "" }]));
    expect(await assignExitIp("n1", "1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("rebalanceExitIps", () => {
  /**
   * ИНВАРИАНТ: адрес, убранный из пула, не остаётся закреплённым. Иначе узел
   * делает SNAT на адрес, которого на машине больше нет: туннель поднят,
   * рукопожатие идёт, а интернета нет — самый неудобный вид поломки.
   */
  it("ИНВАРИАНТ: пир с исчезнувшим адресом получает новый", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([
        { id: "p1", address: "10.8.0.2", exitIp: "1.2.3.9" },
        { id: "p2", address: "10.8.0.3", exitIp: "1.2.3.4" },
      ]),
    );
    expect(await rebalanceExitIps("n1", "1.2.3.4, 1.2.3.5")).toBe(1);
    expect(prismaMock.vpnPeer.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.vpnPeer.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { exitIp: "1.2.3.5" } });
  });

  /**
   * ИНВАРИАНТ: у кого адрес остался в пуле — тому не меняем. Смена внешнего
   * адреса посреди работы выглядит для банка как смена пользователя.
   */
  it("ИНВАРИАНТ: уцелевшие закрепления не трогаем", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([{ id: "p1", address: "10.8.0.2", exitIp: "1.2.3.4" }]));
    expect(await rebalanceExitIps("n1", "1.2.3.4, 1.2.3.5")).toBe(0);
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
  });

  it("пул появился позже пиров — раздаём его тем, у кого адреса не было", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([
        { id: "p1", address: "10.8.0.2", exitIp: "" },
        { id: "p2", address: "10.8.0.3", exitIp: "" },
      ]),
    );
    expect(await rebalanceExitIps("n1", "1.2.3.4, 1.2.3.5")).toBe(2);
    const assigned = prismaMock.vpnPeer.update.mock.calls.map(
      (call: unknown[]) => (call[0] as { data: { exitIp: string } }).data.exitIp,
    );
    /* Раздача ровная: два пира на два адреса — по одному. */
    expect(new Set(assigned).size).toBe(2);
  });

  it("пул убрали целиком — возвращаемся к общему адресу узла", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([
        { id: "p1", address: "10.8.0.2", exitIp: "1.2.3.4" },
        { id: "p2", address: "10.8.0.3", exitIp: "" },
      ]),
    );
    expect(await rebalanceExitIps("n1", "")).toBe(1);
    expect(prismaMock.vpnPeer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { exitIp: "" },
    });
  });

  it("на узле нет пиров — делать нечего", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([]));
    expect(await rebalanceExitIps("n1", "1.2.3.4")).toBe(0);
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
    expect(prismaMock.vpnPeer.updateMany).not.toHaveBeenCalled();
  });
});

describe("isPeerEntitled", () => {
  const premium = { banned: false, bannedUntil: null, isPremium: true, role: "USER" };

  it("premium — доступ есть", () => {
    expect(isPeerEntitled(premium)).toBe(true);
  });

  it("администратор — доступ есть и без подписки", () => {
    expect(isPeerEntitled({ ...premium, isPremium: false, role: "ADMIN" })).toBe(true);
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: доступ не может переживать своё основание. Подписка
   * кончилась (или премиум сняли руками) — туннель обязан закрыться, а не жить
   * дальше только потому, что пир однажды был записан.
   */
  it("ИНВАРИАНТ: без premium доступа нет", () => {
    expect(isPeerEntitled({ ...premium, isPremium: false })).toBe(false);
  });

  it("ИНВАРИАНТ: забаненному доступа нет", () => {
    expect(isPeerEntitled({ ...premium, banned: true })).toBe(false);
  });

  it("бессрочный бан закрывает доступ навсегда", () => {
    expect(isPeerEntitled({ ...premium, banned: true, bannedUntil: null })).toBe(false);
  });

  it("бан со сроком: пока срок идёт — нет, вышел — снова да", () => {
    const now = new Date("2026-08-01T12:00:00Z");
    expect(isPeerEntitled({ ...premium, banned: true, bannedUntil: new Date("2026-08-02T12:00:00Z") }, now)).toBe(false);
    expect(isPeerEntitled({ ...premium, banned: true, bannedUntil: new Date("2026-07-31T12:00:00Z") }, now)).toBe(true);
  });
});

describe("hasVpnEntitlement", () => {
  it("нет пользователя — нет права", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row(null));
    expect(await hasVpnEntitlement("u1")).toBe(false);
  });

  it("premium даёт право, обычный аккаунт — нет", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ isPremium: true, role: "USER" }));
    expect(await hasVpnEntitlement("u1")).toBe(true);
    prismaMock.user.findUnique.mockResolvedValue(row({ isPremium: false, role: "USER" }));
    expect(await hasVpnEntitlement("u1")).toBe(false);
  });
});

describe("pickVpnNode", () => {
  function node(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: "n1",
      name: "vpn-1",
      url: "",
      endpointHost: "vpn1.example.ru:51820",
      transport: "PLAIN",
      obfuscation: "",
      region: "",
      publicIps: "",
      lastReport: JSON.stringify({ wgPublicKey: KEY, endpoint: "vpn1.example.ru:51820" }),
      _count: { select: 0 },
      ...over,
    };
  }

  beforeEach(() => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ maxPeersPerNode: 200 }));
  });

  it("выбирает наименее загруженный узел", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(
      row([
        node({ id: "busy", _count: { vpnPeers: 10 } }),
        node({ id: "free", _count: { vpnPeers: 2 } }),
      ]),
    );
    expect((await pickVpnNode(200))?.node.id).toBe("free");
  });

  /**
   * ИНВАРИАНТ: узел без публичного ключа или без точки подключения не годится —
   * профиль из него собрать нельзя. Лучше честный отказ, чем выданный конфиг,
   * который никуда не подключается.
   */
  it("ИНВАРИАНТ: узел без ключа или без точки подключения не выбирается", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(
      row([
        node({ id: "no-key", lastReport: null, _count: { vpnPeers: 0 } }),
        node({ id: "no-endpoint", endpointHost: "", lastReport: JSON.stringify({ wgPublicKey: KEY }), _count: { vpnPeers: 0 } }),
      ]),
    );
    expect(await pickVpnNode(200)).toBeNull();
  });

  it("ИНВАРИАНТ: набравший потолок пиров не выбирается", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([node({ _count: { vpnPeers: 200 } })]));
    expect(await pickVpnNode(200)).toBeNull();
  });

  it("ищутся только включённые узлы с назначением VPN", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([]));
    await pickVpnNode(200);
    const args = prismaMock.serverNode.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ kind: "VPN", enabled: true });
  });

  it("потолок не задан — берётся из настроек сервиса", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ maxPeersPerNode: 3 }));
    prismaMock.serverNode.findMany.mockResolvedValue(row([node({ _count: { vpnPeers: 3 } })]));
    expect(await pickVpnNode()).toBeNull();
  });
});

describe("readWgReport", () => {
  it("читает публичный ключ и точку подключения", () => {
    const report = JSON.stringify({ wgPublicKey: KEY, endpoint: "vpn1.example.ru:51820" });
    expect(readWgReport(report)).toEqual({ publicKey: KEY, endpoint: "vpn1.example.ru:51820" });
  });

  it("отчёта нет или он битый — пустые значения, без падения", () => {
    expect(readWgReport(null)).toEqual({ publicKey: null, endpoint: null });
    expect(readWgReport("{не json")).toEqual({ publicKey: null, endpoint: null });
  });

  it("негодный ключ из отчёта не принимается", () => {
    expect(readWgReport(JSON.stringify({ wgPublicKey: "мусор" })).publicKey).toBeNull();
  });
});

describe("nodeTunnel", () => {
  const report = JSON.stringify({ wgPublicKey: KEY, endpoint: "reported.example.ru:51820" });

  /**
   * ИНВАРИАНТ: точка подключения из панели главнее отчёта. Узел за NAT своего
   * публичного адреса не знает и пишет в отчёт лишь то, что ему прописали.
   */
  it("ИНВАРИАНТ: значение из панели важнее отчёта", () => {
    const tunnel = nodeTunnel({ endpointHost: "panel.example.ru", lastReport: report });
    expect(tunnel.endpoint).toBe(`panel.example.ru:${VPN_DEFAULT_PORT}`);
  });

  it("в панели пусто — берём из отчёта", () => {
    expect(nodeTunnel({ endpointHost: "", lastReport: report }).endpoint).toBe("reported.example.ru:51820");
  });

  /**
   * ИНВАРИАНТ: параметры обфускации попадают в профиль только когда режим
   * объявлен в панели. Иначе обновление на узле молча меняло бы то, что выдаётся
   * клиентам, — а профиль с этими строками обычный WireGuard не прочитает.
   */
  it("ИНВАРИАНТ: параметры прикладываются только к объявленному режиму", () => {
    const obfuscation = JSON.stringify({ Jc: 4 });
    expect(nodeTunnel({ endpointHost: "", lastReport: report, transport: "PLAIN", obfuscation }).obfuscation).toBeNull();
    expect(nodeTunnel({ endpointHost: "", lastReport: report, transport: "OBFUSCATED", obfuscation }).obfuscation).toEqual({
      Jc: 4,
    });
  });
});

describe("parseObfuscation", () => {
  it("числа в границах проходят, вне границ — нет", () => {
    expect(parseObfuscation(JSON.stringify({ Jc: 4, Jmin: 20 }))).toEqual({ Jc: 4, Jmin: 20 });
    expect(parseObfuscation(JSON.stringify({ Jc: 99 }))).toBeNull();
    expect(parseObfuscation(JSON.stringify({ S1: -1 }))).toBeNull();
  });

  it("заголовки принимаются числом и диапазоном", () => {
    expect(parseObfuscation(JSON.stringify({ H1: 1148195868, H2: "10-20" }))).toEqual({
      H1: "1148195868",
      H2: "10-20",
    });
  });

  it("подписи ограничены длиной", () => {
    expect(parseObfuscation(JSON.stringify({ I1: "<b 0xf00>" }))).toEqual({ I1: "<b 0xf00>" });
    expect(parseObfuscation(JSON.stringify({ I1: "x".repeat(513) }))).toBeNull();
  });

  /**
   * ИНВАРИАНТ: значения приходят с чужой машины. Мусор молча отбрасывается, но и
   * падать из-за одного кривого поля нельзя: остальное всё равно годно.
   */
  it("ИНВАРИАНТ: мусор отбрасывается, годное остаётся", () => {
    expect(parseObfuscation(JSON.stringify({ Jc: 4, Jmax: "нет", PrivateKey: "секрет" }))).toEqual({ Jc: 4 });
  });

  it("пусто, битый JSON и массив — null", () => {
    expect(parseObfuscation(null)).toBeNull();
    expect(parseObfuscation("")).toBeNull();
    expect(parseObfuscation("{не json")).toBeNull();
    expect(parseObfuscation("[1,2]")).toBeNull();
    expect(parseObfuscation("{}")).toBeNull();
  });
});

describe("isTransport", () => {
  it("только два значения", () => {
    expect(isTransport("PLAIN")).toBe(true);
    expect(isTransport("OBFUSCATED")).toBe(true);
    expect(isTransport("plain")).toBe(false);
    expect(isTransport(null)).toBe(false);
  });
});

describe("isVpnRouting", () => {
  it("только два режима", () => {
    expect(isVpnRouting("ALL")).toBe(true);
    expect(isVpnRouting("SERVICES")).toBe(true);
    expect(isVpnRouting("services")).toBe(false);
    expect(isVpnRouting("")).toBe(false);
    expect(isVpnRouting(null)).toBe(false);
    expect(isVpnRouting(undefined)).toBe(false);
  });
});

describe("routingAllowedIps", () => {
  const settings = { allowedIps: "0.0.0.0/0, ::/0", serviceAllowedIps: "10.8.0.0/24, 203.0.113.10/32" };

  /**
   * ИНВАРИАНТ: выбор человека решает, что уйдёт в профиль. До этого маршруты были
   * одни на всех и задавались администратором — то есть за человека решали, менять
   * ему внешний адрес или нет.
   */
  it("ИНВАРИАНТ: режим определяет маршруты профиля", () => {
    expect(routingAllowedIps(settings, "ALL")).toBe("0.0.0.0/0, ::/0");
    expect(routingAllowedIps(settings, "SERVICES")).toBe("10.8.0.0/24, 203.0.113.10/32");
  });

  /**
   * ИНВАРИАНТ: неизвестное значение НЕ даёт «только сервисы». Ошибка в клиенте не
   * должна молча отрезать человека от интернета в туннеле; неизвестное трактуется
   * как обычный полный туннель, а сам маршрут выдачи такое значение отклоняет.
   */
  it("ИНВАРИАНТ: неизвестный режим ведёт себя как «весь трафик»", () => {
    expect(routingAllowedIps(settings, "МУСОР")).toBe("0.0.0.0/0, ::/0");
    expect(routingAllowedIps(settings, undefined)).toBe("0.0.0.0/0, ::/0");
    expect(routingAllowedIps(settings, null)).toBe("0.0.0.0/0, ::/0");
  });

  it("пустые настройки падают на значения по умолчанию", () => {
    expect(routingAllowedIps({ allowedIps: "" }, "ALL")).toBe(VPN_ALLOWED_IPS);
    expect(routingAllowedIps({ allowedIps: "", serviceAllowedIps: "" }, "SERVICES")).toBe(VPN_SERVICE_ALLOWED_IPS);
    expect(routingAllowedIps({ allowedIps: "0.0.0.0/0" }, "SERVICES")).toBe(VPN_SERVICE_ALLOWED_IPS);
  });

  it("по умолчанию «только сервисы TZ» — это подсеть туннеля", () => {
    expect(VPN_SERVICE_ALLOWED_IPS).toBe("10.8.0.0/24");
  });
});
