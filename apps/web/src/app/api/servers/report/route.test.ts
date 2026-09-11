/**
 * Тесты: POST /api/servers/report — единственная связка узла с главным сервером.
 *
 * Через этот ответ доступ к VPN вообще существует: узел приводит интерфейс к
 * присланному списку пиров и снимает всех, кого в списке нет. Отсюда два
 * следствия, которые здесь и проверяются:
 *
 *   • выключатель сервиса обязан быть настоящим — пустой список рвёт туннели;
 *   • право на доступ проверяется ЗДЕСЬ, а не только при выдаче. Раньше туннель
 *     переживал и конец подписки, и снятие премиума руками, и бан: пира просто
 *     продолжали присылать узлу.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/serverMesh", () => ({ findNodeByToken: vi.fn() }));

import { findNodeByToken } from "@/lib/serverMesh";

const mockFindNode = vi.mocked(findNodeByToken);

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");

function vpnNode(over: Record<string, unknown> = {}) {
  return { id: "n1", name: "vpn-1", role: "CHILD", kind: "VPN", url: "", region: "", ...over };
}

function premiumUser(over: Record<string, unknown> = {}) {
  return { banned: false, bannedUntil: null, isPremium: true, role: "USER", ...over };
}

/**
 * Строка пира для списка узла.
 *
 * Поля учёта трафика обязательны: с ними считается лимит, и без них расчёт
 * получал бы недействительную дату периода. Раньше каждый тест перечислял
 * поля сам, и после появления учёта половина файла отвалилась — набор полей
 * теперь один на всех.
 */
function peerFor(user: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    publicKey: KEY,
    address: "10.8.0.2",
    exitIp: "",
    rxBytes: 0,
    txBytes: 0,
    usageResetAt: new Date(),
    user,
    ...over,
  };
}

async function call(body: unknown) {
  const { POST } = await import("@/app/api/servers/report/route");
  const res = await POST(
    new Request("http://localhost/api/servers/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockFindNode.mockResolvedValue(row(vpnNode()));
  prismaMock.serverNode.update.mockResolvedValue(row({ id: "n1" }));
  prismaMock.serverNode.findFirst.mockResolvedValue(row(null));
  prismaMock.vpnSettings.upsert.mockResolvedValue(
    row({
      id: "default",
      enabled: true,
      maxPeersPerNode: 200,
      // Условия тарифа: без них не посчитать ни лимит, ни расчётный период.
      trafficLimitGb: 250,
      usagePeriodDays: 30,
      overLimitAction: "BLOCK",
      throttleKbps: 2048,
    }),
  );
  prismaMock.vpnPeer.findMany.mockResolvedValue(row([]));
  prismaMock.vpnPeer.updateMany.mockResolvedValue(row({ count: 1 }));
});

describe("кто может отчитываться", () => {
  /**
   * ИНВАРИАНТ: без узнанного токена агента отчёт не принимается и список пиров не
   * отдаётся. Иначе достаточно было бы знать адрес сервера, чтобы получить чужие
   * публичные ключи и адреса.
   */
  it("ИНВАРИАНТ: неизвестный токен — 401 и никакого списка пиров", async () => {
    mockFindNode.mockResolvedValue(null);
    const { status, body } = await call({ report: { version: "0.1.0" } });
    expect(status).toBe(401);
    expect(body.peers).toBeUndefined();
    expect(prismaMock.serverNode.update).not.toHaveBeenCalled();
  });
});

describe("что сохраняется из отчёта", () => {
  it("отметка «узел жив» ставится на каждом отчёте", async () => {
    await call({ report: { version: "0.1.0", peers: 3 } });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as {
      where: { id: string };
      data: { lastSeenAt: Date; lastReport: string };
    };
    expect(args.where.id).toBe("n1");
    expect(args.data.lastSeenAt).toBeInstanceOf(Date);
    expect(JSON.parse(args.data.lastReport)).toEqual({ version: "0.1.0", peers: 3 });
  });

  /**
   * ИНВАРИАНТ: отчёт приходит с чужой машины и целиком показывается в панели.
   * Поэтому в базу попадает только белый список полей — иначе узел мог бы
   * положить туда что угодно и любой размер.
   */
  it("ИНВАРИАНТ: посторонние поля отчёта отбрасываются", async () => {
    await call({ report: { version: "0.1.0", evil: "<script>", nested: { a: 1 } } });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { lastReport: string } };
    const saved = JSON.parse(args.data.lastReport);
    expect(saved.evil).toBeUndefined();
    expect(saved.nested).toBeUndefined();
  });

  it("ИНВАРИАНТ: строки обрезаются по длине", async () => {
    await call({ report: { message: "я".repeat(500) } });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { lastReport: string } };
    expect(JSON.parse(args.data.lastReport).message).toHaveLength(200);
  });

  it("параметры интерфейса не присланы — прежние не затираются", async () => {
    await call({ report: { version: "0.1.0" } });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect("obfuscation" in args.data).toBe(false);
  });

  it("параметры интерфейса присланы — сохраняются, мусорные ключи отброшены", async () => {
    await call({ report: {}, obfuscation: { Jc: 4, "плохой ключ": 1 } });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { obfuscation: string } };
    expect(JSON.parse(args.data.obfuscation)).toEqual({ Jc: 4 });
  });
});

describe("список пиров для узла", () => {
  it("узел не VPN — списка нет вовсе", async () => {
    mockFindNode.mockResolvedValue(row(vpnNode({ kind: "MEDIA" })));
    const { body } = await call({ report: {} });
    expect(body.peers).toBeNull();
    expect(prismaMock.vpnPeer.findMany).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: выключатель сервиса настоящий. Выключено — узел получает пустой
   * список и снимает все туннели в течение минуты. Если бы список приходил
   * прежний, выключатель был бы только надписью в панели.
   */
  it("ИНВАРИАНТ: сервис выключен — пустой список, а не прежние пиры", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ enabled: false, maxPeersPerNode: 200, trafficLimitGb: 250, usagePeriodDays: 30, overLimitAction: "BLOCK", throttleKbps: 2048 }));
    const { body } = await call({ report: {} });
    expect(body.peers).toEqual([]);
    expect(prismaMock.vpnPeer.findMany).not.toHaveBeenCalled();
  });

  it("пир отдаётся адресом с маской /32", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([peerFor(premiumUser(), { exitIp: "203.0.113.7" })]),
    );
    const { body } = await call({ report: {} });
    /* throttleKbps = 0 — «ограничений нет»: расход в пределах лимита. */
    expect(body.peers).toEqual([
      { publicKey: KEY, allowedIp: "10.8.0.2/32", exitIp: "203.0.113.7", throttleKbps: 0 },
    ]);
  });

  it("выбираются только свои включённые пиры", async () => {
    await call({ report: {} });
    const args = prismaMock.vpnPeer.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ nodeId: "n1", enabled: true });
  });

  /* FIX-PEERWAIT: VPN-узел спрашивает о своих пирах каждые пять секунд, а не
     раз в минуту: свежий пир ждёт включения туннеля, и минута ожидания читается
     как «интернета нет». Минута осталась остальным узлам — им торопиться некуда. */
  it("VPN-узел спрашивает пиров чаще: следующий отчёт через пять секунд", async () => {
    const { body } = await call({ report: {} });
    expect(body.nextReportInMs).toBe(5_000);
  });

  it("узлу не-VPN следующий отчёт — через минуту", async () => {
    mockFindNode.mockResolvedValue(row(vpnNode({ kind: "MEDIA" })));
    const { body } = await call({ report: {} });
    expect(body.nextReportInMs).toBe(60_000);
  });
});

describe("право на доступ проверяется в момент выдачи списка", () => {
  function peers() {
    return [
      peerFor(premiumUser()),
      peerFor(premiumUser({ isPremium: false }), { publicKey: KEY2, address: "10.8.0.3" }),
    ];
  }

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: доступ не переживает своё основание. Подписка
   * кончилась или премиум сняли — пир не уходит на узел, и туннель закрывается в
   * течение минуты. Отдельная задача по расписанию для этого не нужна: список
   * пиров и так собирается заново на каждом отчёте.
   */
  it("ИНВАРИАНТ: пир без premium на узел не уходит", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row(peers()));
    const { body } = await call({ report: {} });
    expect(body.peers.map((p: { publicKey: string }) => p.publicKey)).toEqual([KEY]);
  });

  it("ИНВАРИАНТ: пир забаненного на узел не уходит", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row([peerFor(premiumUser({ banned: true }))]));
    const { body } = await call({ report: {} });
    expect(body.peers).toEqual([]);
  });

  it("истёкший бан доступ не отбирает", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([peerFor(premiumUser({ banned: true, bannedUntil: new Date(Date.now() - 60_000) }))]),
    );
    const { body } = await call({ report: {} });
    expect(body.peers).toHaveLength(1);
  });

  it("администратору доступ остаётся и без подписки", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([peerFor(premiumUser({ isPremium: false, role: "ADMIN" }))]),
    );
    const { body } = await call({ report: {} });
    expect(body.peers).toHaveLength(1);
  });

  /**
   * ИНВАРИАНТ: запись пира при потере права НЕ удаляется. Вернулась подписка —
   * доступ вернулся с тем же адресом и тем же ключом, без перевыпуска профиля.
   */
  it("ИНВАРИАНТ: пир не удаляется, только не отдаётся", async () => {
    prismaMock.vpnPeer.findMany.mockResolvedValue(row(peers()));
    await call({ report: {} });
    expect(prismaMock.vpnPeer.delete).not.toHaveBeenCalled();
    expect(prismaMock.vpnPeer.deleteMany).not.toHaveBeenCalled();
  });
});

describe("рукопожатия из отчёта", () => {
  /**
   * ИНВАРИАНТ: узел обновляет отметки только своих пиров. Иначе владелец одного
   * узла мог бы вслепую менять записи чужого.
   */
  it("ИНВАРИАНТ: обновление ограничено пирами этого узла", async () => {
    await call({ report: {}, handshakes: [{ publicKey: KEY, atMs: 1_750_000_000_000 }] });
    const args = prismaMock.vpnPeer.updateMany.mock.calls[0][0] as {
      where: { nodeId: string; publicKey: string };
      data: { lastHandshakeAt: Date };
    };
    expect(args.where).toEqual({ nodeId: "n1", publicKey: KEY });
    expect(args.data.lastHandshakeAt.getTime()).toBe(1_750_000_000_000);
  });

  it("негодные записи пропускаются", async () => {
    await call({
      report: {},
      handshakes: [{ publicKey: "мусор", atMs: 1 }, { publicKey: KEY }, { publicKey: KEY, atMs: "давно" }, null],
    });
    expect(prismaMock.vpnPeer.updateMany).not.toHaveBeenCalled();
  });

  it("у не-VPN узла рукопожатия не принимаются", async () => {
    mockFindNode.mockResolvedValue(row(vpnNode({ kind: "APP" })));
    await call({ report: {}, handshakes: [{ publicKey: KEY, atMs: 1_750_000_000_000 }] });
    expect(prismaMock.vpnPeer.updateMany).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: длина списка рукопожатий ограничена", async () => {
    const many = Array.from({ length: 600 }, () => ({ publicKey: KEY, atMs: 1_750_000_000_000 }));
    await call({ report: {}, handshakes: many });
    expect(prismaMock.vpnPeer.updateMany.mock.calls.length).toBeLessThanOrEqual(500);
  });
});

describe("учёт трафика из отчёта", () => {
  /** Настройки с лимитом: расчёт периода и порога живёт в lib/connectionUsage. */
  function settings(over: Record<string, unknown> = {}) {
    prismaMock.vpnSettings.upsert.mockResolvedValue(
      row({
        id: "default",
        enabled: true,
        maxPeersPerNode: 200,
        trafficLimitGb: 250,
        usagePeriodDays: 30,
        overLimitAction: "BLOCK",
        throttleKbps: 2048,
        ...over,
      }),
    );
  }

  /** Пир этого узла с уже накопленным расходом и свежим периодом. */
  function peerRow(over: Record<string, unknown> = {}) {
    prismaMock.vpnPeer.findFirst.mockResolvedValue(
      row({
        id: "p1",
        rxBytes: 1000,
        txBytes: 500,
        lastRx: 800,
        lastTx: 400,
        usageResetAt: new Date(),
        ...over,
      }),
    );
    prismaMock.vpnPeer.update.mockResolvedValue(row({ id: "p1" }));
  }

  /** Данные последней записи расхода. */
  function written() {
    return (prismaMock.vpnPeer.update.mock.calls[0][0] as {
      data: Record<string, number | Date>;
    }).data;
  }

  beforeEach(() => settings());

  /**
   * ИНВАРИАНТ: в расход идёт ПРИРОСТ счётчика, а не само его значение. Узел
   * присылает накопительные счётчики интерфейса; складывать их целиком значило
   * бы списывать человеку один и тот же трафик на каждом отчёте.
   */
  it("ИНВАРИАНТ: считается прирост счётчика", async () => {
    peerRow();
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 1_800, tx: 1_400 }] });
    const data = written();
    expect(data.rxBytes).toBe(1000 + 1000);
    expect(data.txBytes).toBe(500 + 1000);
    expect(data.lastRx).toBe(1_800);
    expect(data.lastTx).toBe(1_400);
  });

  it("счётчик упал (интерфейс перезапустили) — прирост берётся целиком", async () => {
    peerRow();
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 100, tx: 50 }] });
    const data = written();
    expect(data.rxBytes).toBe(1000 + 100);
    expect(data.txBytes).toBe(500 + 50);
  });

  /**
   * ИНВАРИАНТ: отметка «учёт дошёл» ставится тем же запросом, что и цифры.
   * Без неё клиент не может отличить честный ноль от молчащего узла — и
   * показывал бы «израсходовано 0», пока трафик идёт мимо счёта.
   */
  it("ИНВАРИАНТ: ставится отметка свежести учёта", async () => {
    peerRow();
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 900, tx: 500 }] });
    expect(written().usageUpdatedAt).toBeInstanceOf(Date);
  });

  it("срок периода вышел — счётчики начинаются заново", async () => {
    peerRow({ usageResetAt: new Date("2026-01-01T00:00:00.000Z") });
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 1_800, tx: 1_400 }] });
    const data = written();
    expect(data.rxBytes).toBe(1_000);
    expect(data.txBytes).toBe(1_000);
    expect(data.usageResetAt).toBeInstanceOf(Date);
    expect(data.usageUpdatedAt).toBeInstanceOf(Date);
  });

  it("чужой или негодный ключ в расход не идёт", async () => {
    prismaMock.vpnPeer.findFirst.mockResolvedValue(row(null));
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 1, tx: 1 }, { publicKey: "мусор", rx: 1, tx: 1 }] });
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
  });

  it("у не-VPN узла расход не принимается", async () => {
    mockFindNode.mockResolvedValue(row(vpnNode({ kind: "APP" })));
    peerRow();
    await call({ report: {}, transfers: [{ publicKey: KEY, rx: 1_800, tx: 1_400 }] });
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
  });
});

describe("лимит трафика в списке пиров", () => {
  const GB = 1024 ** 3;

  function settingsWithLimit(over: Record<string, unknown> = {}) {
    prismaMock.vpnSettings.upsert.mockResolvedValue(
      row({
        id: "default",
        enabled: true,
        maxPeersPerNode: 200,
        trafficLimitGb: 250,
        usagePeriodDays: 30,
        overLimitAction: "BLOCK",
        throttleKbps: 2048,
        ...over,
      }),
    );
  }

  /** Пир, у которого расход уже вышел за лимит. */
  function overLimitPeer(role: string) {
    prismaMock.vpnPeer.findMany.mockResolvedValue(
      row([peerFor(premiumUser({ role }), { rxBytes: 200 * GB, txBytes: 100 * GB })]),
    );
  }

  /**
   * ИНВАРИАНТ: подписка от лимита не освобождает. Ни Premium, ни «Ускоренный
   * интернет»: по части соединения это одна и та же услуга с одним лимитом.
   */
  it("ИНВАРИАНТ: подписчик за лимитом выпадает из списка узла", async () => {
    settingsWithLimit();
    overLimitPeer("USER");
    const res = await call({ report: {} });
    expect(res.body.peers).toEqual([]);
  });

  /**
   * ИНВАРИАНТ: безлимит — признак роли в проекте, и только его. Сервис нужно
   * проверять, в том числе прогоняя через него больше подписочного лимита.
   */
  it("ИНВАРИАНТ: у администрации проекта (ADMIN) лимита нет", async () => {
    settingsWithLimit();
    overLimitPeer("ADMIN");
    const res = await call({ report: {} });
    expect(res.body.peers).toHaveLength(1);
    expect(res.body.peers[0].throttleKbps).toBe(0);
  });

  it("правило «снизить скорость»: подписчик остаётся, но с потолком", async () => {
    settingsWithLimit({ overLimitAction: "THROTTLE" });
    overLimitPeer("USER");
    const res = await call({ report: {} });
    expect(res.body.peers).toHaveLength(1);
    expect(res.body.peers[0].throttleKbps).toBe(2048);
  });

  it("правило «снизить скорость»: администрацию не режем", async () => {
    settingsWithLimit({ overLimitAction: "THROTTLE" });
    overLimitPeer("ADMIN");
    const res = await call({ report: {} });
    expect(res.body.peers[0].throttleKbps).toBe(0);
  });
});
