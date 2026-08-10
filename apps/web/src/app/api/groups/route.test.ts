/**
 * Тесты: POST /api/groups — создание группы по шаблону.
 *
 * Проверяется одно, но то самое: маршрут больше не включает блочный режим.
 * Раньше `sectionsEnabled` вычислялся из пометки `section` у каналов шаблона, и
 * любая группа по премиум-шаблону открывалась как главное сообщество TZ
 * Connect — без панели «Разделы — рабочие модули группы». Пометки не стало, но
 * без теста ничто не мешает вернуть в маршрут любое другое «умное» условие.
 *
 * Права на премиум-шаблоны проверяются здесь же: они к режиму отношения не
 * имеют и меняться не должны были.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
import { COMMUNITY_TEMPLATES } from "@/lib/communityTemplates";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/mainCommunity", () => ({
  ensureMainCommunity: vi.fn(),
  autoJoinMainCommunity: vi.fn(),
  syncServicesToMainCommunity: vi.fn(),
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

/** Данные, с которыми маршрут позвал prisma.group.create. */
function createdData() {
  const call = prismaMock.group.create.mock.calls[0]?.[0] as
    | { data: { sectionsEnabled?: boolean; channels?: { create: { type: string }[] } } }
    | undefined;
  return call?.data;
}

beforeEach(() => {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
  // Владелец с premium: лимит бесплатных сообществ и премиум-шаблоны не мешают.
  prismaMock.user.findUnique.mockResolvedValue(row({ isPremium: true, role: "USER" }));
  prismaMock.group.count.mockResolvedValue(0);
  prismaMock.group.create.mockResolvedValue(row({ id: "g1", channels: [] }));
});

describe("POST /api/groups", () => {
  it.each(COMMUNITY_TEMPLATES.map((t) => t.id))(
    "ИНВАРИАНТ: шаблон «%s» не включает блочный режим",
    async (templateId) => {
      /* sectionsEnabled = true рисует группу как главное сообщество и прячет
         панель модулей. Осознанное включение живёт в настройках группы. */
      const { POST } = await import("@/app/api/groups/route");
      const res = await POST(makeRequest({ name: "Моя группа", templateId }));
      expect(res.status).toBe(200);
      expect(createdData()?.sectionsEnabled).toBe(false);
    },
  );

  it("ИНВАРИАНТ: каналы шаблона уходят в базу как есть", async () => {
    /* Раньше из каждого канала вырезали служебное поле `section`. Поля нет —
       вырезать нечего, и в create должны попасть ровно каналы шаблона. */
    const { POST } = await import("@/app/api/groups/route");
    await POST(makeRequest({ name: "Проект", templateId: "project" }));
    const template = COMMUNITY_TEMPLATES.find((t) => t.id === "project")!;
    expect(createdData()?.channels?.create).toEqual(template.channels);
  });

  it("ФИКСАЦИЯ: премиум-шаблон обычному аккаунту недоступен", async () => {
    /* Проверка прав к режиму разделов отношения не имеет и меняться не должна. */
    prismaMock.user.findUnique.mockResolvedValue(row({ isPremium: false, role: "USER" }));
    const { POST } = await import("@/app/api/groups/route");
    const res = await POST(makeRequest({ name: "Игры", templateId: "gaming" }));
    expect(res.status).toBe(403);
    expect(prismaMock.group.create).not.toHaveBeenCalled();
  });

  it("неизвестный шаблон отклоняется", async () => {
    const { POST } = await import("@/app/api/groups/route");
    const res = await POST(makeRequest({ name: "Группа", templateId: "нет такого" }));
    expect(res.status).toBe(400);
    expect(prismaMock.group.create).not.toHaveBeenCalled();
  });
});
