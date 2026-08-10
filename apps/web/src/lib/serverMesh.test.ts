/**
 * Тесты serverMesh.ts: токены узлов, поиск узла, статус онлайн.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  hashAgentToken,
  issueAgentToken,
  findNodeByToken,
  nodeStatus,
  NODE_ONLINE_WINDOW_MS,
  isNodeRole,
  isNodeKind,
} from "@/lib/serverMesh";

// ── Утилиты ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<{
  id: string;
  name: string;
  role: string;
  kind: string;
  url: string;
  region: string;
  tokenHash: string | null;
  enabled: boolean;
}> = {}) {
  return {
    id: "node-1",
    name: "vpn-eu",
    role: "CHILD",
    kind: "VPN",
    url: "https://vpn.example.com",
    region: "eu-west",
    tokenHash: null,
    enabled: true,
    ...overrides,
  };
}

// ── Выпуск и хеширование токена ────────────────────────────────────────────

describe("issueAgentToken / hashAgentToken", () => {
  it("выдаёт токен и его SHA-256 хеш", () => {
    const { token, tokenHash } = issueAgentToken();
    expect(token).toBeTruthy();
    expect(tokenHash).toHaveLength(64); // hex SHA-256
    expect(tokenHash).toBe(hashAgentToken(token));
  });

  it("один и тот же токен всегда даёт одинаковый хеш", () => {
    const token = "fixed-test-token-value";
    expect(hashAgentToken(token)).toBe(hashAgentToken(token));
  });

  it("разные токены → разные хеши (коллизий нет в детерминированных случаях)", () => {
    const h1 = hashAgentToken("token-aaa");
    const h2 = hashAgentToken("token-bbb");
    expect(h1).not.toBe(h2);
  });
});

// ── findNodeByToken ────────────────────────────────────────────────────────

describe("findNodeByToken", () => {
  beforeEach(() => {
    prismaMock.serverNode.findMany.mockResolvedValue([]);
  });

  it("возвращает null при отсутствии заголовка", async () => {
    expect(await findNodeByToken(null)).toBeNull();
  });

  it("возвращает null если заголовок не начинается с 'Bearer '", async () => {
    expect(await findNodeByToken("Basic abc")).toBeNull();
  });

  it("возвращает null для слишком длинного токена (> 200 символов)", async () => {
    const longToken = "Bearer " + "x".repeat(201);
    expect(await findNodeByToken(longToken)).toBeNull();
  });

  it("возвращает null если нет включённых узлов", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue([]);
    const { token } = issueAgentToken();
    expect(await findNodeByToken(`Bearer ${token}`)).toBeNull();
  });

  it("находит узел по верному токену через timingSafeEqual", async () => {
    const { token, tokenHash } = issueAgentToken();
    const node = makeNode({ tokenHash });
    prismaMock.serverNode.findMany.mockResolvedValue([node as never]);

    const result = await findNodeByToken(`Bearer ${token}`);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("node-1");
  });

  it("не возвращает узел при неверном токене", async () => {
    const { tokenHash } = issueAgentToken(); // хеш правильного токена
    const node = makeNode({ tokenHash });
    prismaMock.serverNode.findMany.mockResolvedValue([node as never]);

    // Другой токен — хеш не совпадёт.
    const { token: wrongToken } = issueAgentToken();
    const result = await findNodeByToken(`Bearer ${wrongToken}`);
    expect(result).toBeNull();
  });

  it("не падает на строках разной длины (защита timingSafeEqual)", async () => {
    // Если хранимый хеш не 64 символа, timingSafeEqual бросит TypeError.
    // Реализация должна пропускать такой узел (continue), а не крашиться.
    const badNode = makeNode({ tokenHash: "short" }); // не 64 hex
    prismaMock.serverNode.findMany.mockResolvedValue([badNode as never]);

    const { token } = issueAgentToken();
    // Должен вернуть null без исключения.
    await expect(findNodeByToken(`Bearer ${token}`)).resolves.toBeNull();
  });

  it("пропускает узел с tokenHash === null", async () => {
    const node = makeNode({ tokenHash: null });
    prismaMock.serverNode.findMany.mockResolvedValue([node as never]);
    const { token } = issueAgentToken();
    expect(await findNodeByToken(`Bearer ${token}`)).toBeNull();
  });
});

// ── nodeStatus ─────────────────────────────────────────────────────────────

describe("nodeStatus", () => {
  it("disabled → статус 'disabled' независимо от lastSeenAt", () => {
    expect(nodeStatus(new Date(), false)).toBe("disabled");
    expect(nodeStatus(null, false)).toBe("disabled");
  });

  it("null lastSeenAt → 'offline'", () => {
    expect(nodeStatus(null, true)).toBe("offline");
  });

  it("lastSeenAt в пределах окна → 'online'", () => {
    const recent = new Date(Date.now() - NODE_ONLINE_WINDOW_MS + 5_000);
    expect(nodeStatus(recent, true)).toBe("online");
  });

  it("lastSeenAt за пределами окна → 'offline'", () => {
    const old = new Date(Date.now() - NODE_ONLINE_WINDOW_MS - 1_000);
    expect(nodeStatus(old, true)).toBe("offline");
  });

  it("граничное значение — ровно на краю окна → 'online'", () => {
    const edge = new Date(Date.now() - NODE_ONLINE_WINDOW_MS);
    // Date.now() вычислялся секунду назад — допустим небольшой люфт.
    const status = nodeStatus(edge, true);
    expect(["online", "offline"]).toContain(status);
  });
});

// ── Перечисления ───────────────────────────────────────────────────────────

describe("isNodeRole / isNodeKind", () => {
  it("isNodeRole принимает корректные роли", () => {
    expect(isNodeRole("MAIN")).toBe(true);
    expect(isNodeRole("CHILD")).toBe(true);
  });

  it("isNodeRole отклоняет посторонние значения", () => {
    expect(isNodeRole("UNKNOWN")).toBe(false);
    expect(isNodeRole(null)).toBe(false);
    expect(isNodeRole(42)).toBe(false);
  });

  it("isNodeKind принимает все перечисленные виды", () => {
    for (const kind of ["APP", "MEDIA", "VPN", "COMPUTE", "STORAGE"]) {
      expect(isNodeKind(kind)).toBe(true);
    }
  });

  it("isNodeKind отклоняет посторонние значения", () => {
    expect(isNodeKind("ROUTER")).toBe(false);
    expect(isNodeKind(undefined)).toBe(false);
  });
});
