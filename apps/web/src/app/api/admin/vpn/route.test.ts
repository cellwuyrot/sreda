/**
 * Тесты: GET/PATCH /api/admin/vpn — настройки сервиса VPN.
 *
 * Маршрут был без тестов, а решает он три вещи: кто вообще может менять
 * настройки, что считается допустимым значением и — с появлением выбора у
 * пользователя — что означает каждый из двух вариантов включения. Смысл
 * вариантов задаёт администратор здесь; выбор между ними делает человек в своём
 * окне VPN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";

const mockSession = vi.mocked(getServerSession);

const SETTINGS = {
  id: "default",
  enabled: true,
  dns: "1.1.1.1",
  allowedIps: "0.0.0.0/0, ::/0",
  serviceAllowedIps: "10.8.0.0/24",
  maxPeersPerNode: 200,
};

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/admin/vpn/route");
  const res = await PATCH(
    new Request("http://localhost/api/admin/vpn", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function get() {
  const { GET } = await import("@/app/api/admin/vpn/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.vpnSettings.upsert.mockResolvedValue(row(SETTINGS));
  prismaMock.serverNode.findMany.mockResolvedValue(row([]));
});

describe("кто может менять настройки", () => {
  /**
   * ИНВАРИАНТ: настройки сервиса — только для администратора. Редактор здесь не
   * при делах: выключатель VPN и маршруты касаются всех устройств сразу.
   */
  it("ИНВАРИАНТ: не администратор получает 403 и ничего не пишет", async () => {
    for (const role of ["USER", "EDITOR", "CONSULTANT"]) {
      mockSession.mockResolvedValue({ user: { id: "u1", role } } as never);
      expect((await patch({ enabled: false })).status).toBe(403);
      expect((await get()).status).toBe(403);
    }
    expect(prismaMock.vpnSettings.upsert).not.toHaveBeenCalled();
  });

  it("без сессии — тоже 403", async () => {
    mockSession.mockResolvedValue(null);
    expect((await patch({ enabled: false })).status).toBe(403);
  });
});

describe("маршруты двух вариантов включения", () => {
  /**
   * ИНВАРИАНТ: у варианта «только сервисы TZ» есть собственный список подсетей.
   * Без него выбор был бы невозможен: маршруты были одни на всех, и человек
   * получал то, что решил администратор.
   */
  it("ИНВАРИАНТ: маршруты «только сервисы TZ» сохраняются отдельно", async () => {
    await patch({ serviceAllowedIps: "10.8.0.0/24, 203.0.113.10/32" });
    const args = prismaMock.vpnSettings.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.serviceAllowedIps).toBe("10.8.0.0/24, 203.0.113.10/32");
    expect(args.update.allowedIps).toBeUndefined();
  });

  it("ИНВАРИАНТ: мусор вместо подсетей отклоняется", async () => {
    const res = await patch({ serviceAllowedIps: "сайты проекта" });
    expect(res.status).toBe(400);
    expect(prismaMock.vpnSettings.upsert).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: пустое поле не оставляет вариант без маршрутов — иначе человек,
   * выбравший «только сервисы TZ», получил бы профиль, через который не идёт
   * ничего вообще.
   */
  it("ИНВАРИАНТ: пустое значение падает на подсеть туннеля", async () => {
    await patch({ serviceAllowedIps: "   " });
    const args = prismaMock.vpnSettings.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.serviceAllowedIps).toBe("10.8.0.0/24");
  });

  it("маршруты «весь трафик» правятся отдельно и так же проверяются", async () => {
    await patch({ allowedIps: "0.0.0.0/0" });
    const args = prismaMock.vpnSettings.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.allowedIps).toBe("0.0.0.0/0");
    expect((await patch({ allowedIps: "весь интернет" })).status).toBe(400);
  });

  it("оба списка отдаются панели", async () => {
    const { body } = await patch({ enabled: true });
    expect(body.settings.allowedIps).toBe(SETTINGS.allowedIps);
    expect(body.settings.serviceAllowedIps).toBe(SETTINGS.serviceAllowedIps);
  });
});

describe("остальные настройки", () => {
  it("DNS проверяется на форму", async () => {
    expect((await patch({ dns: "1.1.1.1, 8.8.8.8" })).status).toBe(200);
    expect((await patch({ dns: "какой-нибудь" })).status).toBe(400);
  });

  it("потолок пиров ограничен размером подсети", async () => {
    expect((await patch({ maxPeersPerNode: 200 })).status).toBe(200);
    expect((await patch({ maxPeersPerNode: 0 })).status).toBe(400);
    expect((await patch({ maxPeersPerNode: 254 })).status).toBe(400);
  });

  it("выключатель сохраняется как есть", async () => {
    await patch({ enabled: false });
    const args = prismaMock.vpnSettings.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.enabled).toBe(false);
  });
});
