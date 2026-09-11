/**
 * Тесты маршрута POST /api/vpn/me.
 *
 * Приоритет P1, зона C.
 *
 * Стратегия мокинга:
 *  - Prisma подменяется через prismaMock (без реальной БД).
 *  - next-auth getServerSession и @/lib/auth мокируются.
 *  - @/lib/redis мокируется (нет живого Redis).
 *  - @/lib/rateLimit мокируется — всегда разрешает, чтобы не мешать логике.
 *  - @/lib/vpn частично мокируется для контроля над настройками и entitlement.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";

// ── Порядок vi.mock важен: объявляем ДО импорта тестируемого модуля ─────────

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

vi.mock("@/lib/redis", () => ({
  redis: { status: "end", eval: vi.fn().mockResolvedValue(0) },
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Ограничитель запросов — всегда разрешаем, проверяем его отдельно.
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Мокируем vpn-утилиты. Реальные hasVpnEntitlement / getVpnSettings / pickVpnNode
// тянут Prisma напрямую и содержат логику выдачи адресов — изолируем их.
vi.mock("@/lib/sanitize", () => ({
  sanitizeText: vi.fn((s: string) => s),
}));

/* Проверка бана — отдельный модуль со своим запросом к базе; подменяем целиком,
   чтобы тесты выдачи не зависели от формы этого запроса. */
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn() }));

vi.mock("@/lib/vpn", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vpn")>("@/lib/vpn");
  return {
    ...actual,
    getVpnSettings: vi.fn(),
    hasVpnEntitlement: vi.fn(),
    pickVpnNode: vi.fn(),
    chooseAddress: vi.fn(),
    assignExitIp: vi.fn(),
    nodeTunnel: vi.fn(),
  };
});

import { getServerSession } from "next-auth";
import { checkBan } from "@/lib/banCheck";
import {
  getVpnSettings,
  hasVpnEntitlement,
  pickVpnNode,
  chooseAddress,
  assignExitIp,
  nodeTunnel,
} from "@/lib/vpn";

// Динамический импорт после всех vi.mock.
const { POST, GET, DELETE } = await import("@/app/api/vpn/me/route");

// ── Вспомогательные данные ──────────────────────────────────────────────────

/** Корректный 44-символьный base64 WireGuard-ключ. */
const VALID_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 44 chars

const SESSION_USER = { id: "user-123", name: "Тест", email: "test@example.com" };
const MOCK_SETTINGS = {
  id: "default",
  enabled: true,
  maxPeersPerNode: 100,
  dns: "1.1.1.1",
  allowedIps: "0.0.0.0/0",
  /* VPN-ROUTING: маршруты второго варианта выбора. */
  serviceAllowedIps: "10.8.0.0/24, 203.0.113.10/32",
};
const MOCK_NODE = {
  id: "node-1",
  name: "vpn-eu",
  region: "eu-west",
  publicKey: VALID_PUBLIC_KEY,
  endpoint: "vpn.example.com:51820",
  publicIps: "",
  endpointHost: "vpn.example.com",
  transport: "OBFUSCATED",
  obfuscation: null,
  lastReport: null,
  enabled: true,
  kind: "VPN",
  _count: { vpnPeers: 0 },
};
const MOCK_WG = { publicKey: VALID_PUBLIC_KEY, endpoint: "vpn.example.com:51820", obfuscation: null };
const MOCK_PEER = {
  id: "peer-1",
  userId: SESSION_USER.id,
  nodeId: "node-1",
  publicKey: VALID_PUBLIC_KEY,
  address: "10.8.0.2",
  exitIp: "",
  label: "",
  routing: "ALL",
  enabled: true,
  lastHandshakeAt: null,
  createdAt: new Date(),
};

function makeNextRequest(body: unknown): import("next/server").NextRequest {
  const req = new Request("http://localhost/api/vpn/me", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
  return req as unknown as import("next/server").NextRequest;
}

// ── Сброс моков перед каждым тестом ────────────────────────────────────────

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: SESSION_USER } as never);
  vi.mocked(getVpnSettings).mockResolvedValue(MOCK_SETTINGS as never);
  vi.mocked(hasVpnEntitlement).mockResolvedValue(true);
  vi.mocked(pickVpnNode).mockResolvedValue({ node: MOCK_NODE, wg: MOCK_WG } as never);
  vi.mocked(chooseAddress).mockResolvedValue("10.8.0.2");
  vi.mocked(checkBan).mockResolvedValue(null);
  vi.mocked(assignExitIp).mockResolvedValue("");
  vi.mocked(nodeTunnel).mockReturnValue(MOCK_WG);
  prismaMock.vpnPeer.findUnique.mockResolvedValue(null);
  prismaMock.vpnPeer.upsert.mockResolvedValue(MOCK_PEER as never);
  /* NETLINK: GET собирает ещё и список серверов с их загруженностью. Без этой
     заглушки ответ падал на разборе пустого результата — проверка «нет пира»
     ломалась о совершенно посторонний запрос. */
  prismaMock.serverNode.findMany.mockResolvedValue([] as never);
  prismaMock.user.findUnique.mockResolvedValue({
    isPremium: true,
    role: "USER",
    vpnAccess: null,
    vpnAccessUntil: null,
  } as never);
});

// ── Контракт безопасности: privateKey ──────────────────────────────────────

describe("CONTRACT: приватный ключ не принимается сервером", () => {
  /**
   * Это тест-контракт (P1), а не деталь реализации.
   *
   * Приватный ключ WireGuard создаётся на устройстве пользователя и никогда
   * не должен покидать его. Если клиент случайно отправит privateKey в теле
   * запроса, сервер ОБЯЗАН отклонить запрос с кодом 400, не обрабатывая его.
   *
   * Нарушение этого контракта — утечка секрета пользователя на сервер.
   * Тест намеренно проверяет ПОВЕДЕНИЕ, а не строку кода, чтобы рефакторинг
   * маршрута не мог тихо сломать защиту.
   */
  it("POST с полем privateKey → 400, тело запроса не обрабатывается дальше", async () => {
    const req = makeNextRequest({
      publicKey: VALID_PUBLIC_KEY,
      privateKey: "секретный-ключ-который-не-должен-быть-здесь",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    // Сообщение должно объяснить причину отказа.
    expect(json.error).toMatch(/приватный/i);
    // Убеждаемся, что пир не был создан — prisma.upsert не вызывался.
    expect(prismaMock.vpnPeer.upsert).not.toHaveBeenCalled();
  });

  it("POST с privateKey=undefined (поле есть, значение undefined) → поле не сериализуется, запрос проходит нормально", async () => {
    // JSON.stringify убирает undefined — это допустимый случай.
    const body = JSON.stringify({ publicKey: VALID_PUBLIC_KEY });
    const req = new Request("http://localhost/api/vpn/me", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body,
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).not.toBe(400);
  });

  it("POST с privateKey=null → тоже отклоняется (null !== undefined)", async () => {
    // Защита: даже null в поле privateKey сигнализирует об ошибке клиента.
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY, privateKey: null });
    const res = await POST(req);
    // null === undefined в JS — false; но body.privateKey !== undefined означает null тоже отловится.
    // Проверяем: null → статус 400 (privateKey !== undefined).
    expect(res.status).toBe(400);
  });
});

// ── Аутентификация ──────────────────────────────────────────────────────────

describe("POST: аутентификация", () => {
  it("без сессии → 401", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── Проверка прав (entitlement) ─────────────────────────────────────────────

describe("POST: права на VPN", () => {
  it("без Premium подписки → 403", async () => {
    vi.mocked(hasVpnEntitlement).mockResolvedValue(false);
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("сервис отключён администратором → 503", async () => {
    vi.mocked(getVpnSettings).mockResolvedValue({ ...MOCK_SETTINGS, enabled: false } as never);
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  /**
   * ИНВАРИАНТ: забаненному доступ не выдаётся. Сессия при бане живёт до
   * обновления, поэтому проверка нужна на самом действии, а не только на входе.
   */
  it("ИНВАРИАНТ: забаненный не получает пира", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(checkBan).mockResolvedValue(NextResponse.json({ error: "бан" }, { status: 403 }));
    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY }));
    expect(res.status).toBe(403);
    expect(prismaMock.vpnPeer.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
  });
});

// ── Возврат доступа выключенному пиру ──────────────────────────────────────

describe("POST: пир был выключен", () => {
  /**
   * ИНВАРИАНТ: перевыпуск ключа возвращает пира в строй. Выключенного пира узел
   * не получает, поэтому иначе человеку выдавался бы профиль, по которому туннель
   * не поднимается, — и причина была бы совершенно не видна ни ему, ни панели.
   */
  it("ИНВАРИАНТ: перевыпуск ключа включает пира обратно", async () => {
    prismaMock.vpnPeer.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ("publicKey" in where) return Promise.resolve(null) as never;
      return Promise.resolve({
        ...MOCK_PEER,
        enabled: false,
        node: { ...MOCK_NODE, id: "node-1" },
      }) as never;
    });
    prismaMock.vpnPeer.update.mockResolvedValue({ ...MOCK_PEER, enabled: true } as never);

    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY }));
    expect(res.status).toBe(200);
    const args = prismaMock.vpnPeer.update.mock.calls[0][0] as { data: { enabled: boolean } };
    expect(args.data.enabled).toBe(true);
  });

  it("ИНВАРИАНТ: выдача через upsert тоже включает пира", async () => {
    prismaMock.vpnPeer.findUnique.mockResolvedValue(null);
    await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY }));
    const args = prismaMock.vpnPeer.upsert.mock.calls[0][0] as { update: { enabled: boolean } };
    expect(args.update.enabled).toBe(true);
  });
});

// ── Валидация ключа ─────────────────────────────────────────────────────────

describe("POST: валидация publicKey", () => {
  it("некорректный ключ (не base64 / не 44 символа) → 400", async () => {
    const req = makeNextRequest({ publicKey: "not-a-wg-key" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ключ/i);
  });

  it("отсутствующий publicKey → 400", async () => {
    const req = makeNextRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ── Конфликт ключа ──────────────────────────────────────────────────────────

describe("POST: повторная регистрация публичного ключа", () => {
  it("тот же ключ у другого userId → 409", async () => {
    // Ключ уже зарегистрирован на другого пользователя.
    prismaMock.vpnPeer.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ("publicKey" in where) {
        // Запрос по publicKey — возвращаем запись другого пользователя.
        return Promise.resolve({ userId: "other-user-999" }) as never;
      }
      return Promise.resolve(null) as never;
    });

    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/ключ/i);
    // Пир не создаётся.
    expect(prismaMock.vpnPeer.upsert).not.toHaveBeenCalled();
  });

  it("тот же ключ того же userId → обновление (не конфликт)", async () => {
    // Первый findUnique (по publicKey) — принадлежит тому же пользователю.
    // Второй findUnique (по userId) — нет существующего пира → создаём.
    prismaMock.vpnPeer.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ("publicKey" in where) {
        return Promise.resolve({ userId: SESSION_USER.id }) as never;
      }
      return Promise.resolve(null) as never;
    });

    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ── Успешная регистрация ────────────────────────────────────────────────────

describe("POST: успешная регистрация пира", () => {
  it("новый пир → 200, возвращает peer и replaced=false", async () => {
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("peer");
    expect(json.replaced).toBe(false);
  });

  it("нет доступного VPN-узла → 503", async () => {
    vi.mocked(pickVpnNode).mockResolvedValue(null);
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("нет свободных адресов → 503", async () => {
    vi.mocked(chooseAddress).mockResolvedValue(null);
    const req = makeNextRequest({ publicKey: VALID_PUBLIC_KEY });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });
});

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/vpn/me", () => {
  it("без сессии → 401", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("с сессией, нет пира → peer: null", async () => {
    prismaMock.vpnPeer.findUnique.mockResolvedValue(null);
    vi.mocked(pickVpnNode).mockResolvedValue({ node: MOCK_NODE, wg: MOCK_WG } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.peer).toBeNull();
    expect(json).toHaveProperty("serviceEnabled");
    expect(json).toHaveProperty("entitled");
  });
});

// ── DELETE ──────────────────────────────────────────────────────────────────

describe("DELETE /api/vpn/me", () => {
  it("без сессии → 401", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("нет пира → ok: true без ошибки", async () => {
    prismaMock.vpnPeer.findUnique.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(prismaMock.vpnPeer.delete).not.toHaveBeenCalled();
  });

  it("есть пир → удаляет и возвращает ok: true", async () => {
    prismaMock.vpnPeer.findUnique.mockResolvedValue({ id: "peer-1" } as never);
    prismaMock.vpnPeer.delete.mockResolvedValue(MOCK_PEER as never);
    const res = await DELETE();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(prismaMock.vpnPeer.delete).toHaveBeenCalledWith({ where: { id: "peer-1" } });
  });
});

// ── Выбор режима маршрутизации ─────────────────────────────────────────────

describe("POST: режим маршрутизации", () => {
  /**
   * ИНВАРИАНТ: режим выбирает человек, и выбор доходит до записи. Раньше маршруты
   * были одни на всех и задавались администратором — то есть за человека решали,
   * менять ему внешний адрес или нет.
   */
  it("ИНВАРИАНТ: выбранный режим сохраняется у пира", async () => {
    prismaMock.vpnPeer.upsert.mockResolvedValue({ ...MOCK_PEER, routing: "SERVICES" } as never);
    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY, routing: "SERVICES" }));
    expect(res.status).toBe(200);
    const args = prismaMock.vpnPeer.upsert.mock.calls[0][0] as {
      create: { routing: string };
      update: { routing: string };
    };
    expect(args.create.routing).toBe("SERVICES");
    expect(args.update.routing).toBe("SERVICES");
  });

  /**
   * ИНВАРИАНТ: маршруты в профиле соответствуют выбранному режиму. Иначе выбор был
   * бы надписью: человек просит «только сервисы TZ», а в конфиг уходит весь
   * трафик.
   */
  it("ИНВАРИАНТ: профиль получает маршруты выбранного режима", async () => {
    prismaMock.vpnPeer.upsert.mockResolvedValue({ ...MOCK_PEER, routing: "SERVICES" } as never);
    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY, routing: "SERVICES" }));
    const json = await res.json();
    expect(json.peer.routing).toBe("SERVICES");
    expect(json.peer.tunnel.allowedIps).toBe(MOCK_SETTINGS.serviceAllowedIps);
  });

  it("режим «весь трафик» — маршруты из общей настройки", async () => {
    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY, routing: "ALL" }));
    const json = await res.json();
    expect(json.peer.tunnel.allowedIps).toBe(MOCK_SETTINGS.allowedIps);
  });

  /**
   * ИНВАРИАНТ: неизвестный режим отклоняется, а не толкуется молча. Тихо выдать
   * «весь трафик» вместо запрошенного «только сервисы TZ» значит отправить трафик
   * не туда, куда просили, — и человек об этом не узнает.
   */
  it("ИНВАРИАНТ: неизвестный режим → 400 и ничего не записано", async () => {
    const res = await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY, routing: "ВСЁ" }));
    expect(res.status).toBe(400);
    expect(prismaMock.vpnPeer.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vpnPeer.update).not.toHaveBeenCalled();
  });

  it("режим не передан, пира нет — весь трафик", async () => {
    await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY }));
    const args = prismaMock.vpnPeer.upsert.mock.calls[0][0] as { create: { routing: string } };
    expect(args.create.routing).toBe("ALL");
  });

  /**
   * ИНВАРИАНТ: перевыпуск без указания режима не меняет режим. Человек нажал
   * «перевыпустить профиль», потому что потерял файл, — молча переключать его на
   * другой вид туннеля нельзя.
   */
  it("ИНВАРИАНТ: перевыпуск сохраняет прежний выбор", async () => {
    prismaMock.vpnPeer.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ("publicKey" in where) return Promise.resolve(null) as never;
      return Promise.resolve({ ...MOCK_PEER, routing: "SERVICES", node: MOCK_NODE }) as never;
    });
    prismaMock.vpnPeer.update.mockResolvedValue({ ...MOCK_PEER, routing: "SERVICES" } as never);

    await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY }));
    const args = prismaMock.vpnPeer.update.mock.calls[0][0] as { data: { routing: string } };
    expect(args.data.routing).toBe("SERVICES");
  });

  it("перевыпуск с другим режимом меняет режим", async () => {
    prismaMock.vpnPeer.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ("publicKey" in where) return Promise.resolve(null) as never;
      return Promise.resolve({ ...MOCK_PEER, routing: "SERVICES", node: MOCK_NODE }) as never;
    });
    prismaMock.vpnPeer.update.mockResolvedValue({ ...MOCK_PEER, routing: "ALL" } as never);

    await POST(makeNextRequest({ publicKey: VALID_PUBLIC_KEY, routing: "ALL" }));
    const args = prismaMock.vpnPeer.update.mock.calls[0][0] as { data: { routing: string } };
    expect(args.data.routing).toBe("ALL");
  });
});
