/**
 * Тесты: POST /api/projects/[id]/chat — переход из карточки проекта в чат.
 *
 * Вызов может ЗАВЕСТИ обращение и разговор, поэтому проверяется прежде всего
 * то, кому это позволено, и то, что неудача не выдаётся за успех: пустой ответ
 * выглядел бы как молча не работающая кнопка.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const ensureProjectConversation = vi.fn();
vi.mock("@/lib/projectConversation", () => ({
  ensureProjectConversation: (...a: unknown[]) => ensureProjectConversation(...a),
}));

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

const params = { params: Promise.resolve({ id: "p1" }) };

async function post() {
  const mod = await import("@/app/api/projects/[id]/chat/route");
  const req = new Request("http://localhost/api/projects/p1/chat", { method: "POST" }) as unknown as import("next/server").NextRequest;
  const res = await mod.POST(req, params);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  ensureProjectConversation.mockReset().mockResolvedValue({ appealId: "ap1", conversationId: "conv1" });
  mockSession.mockResolvedValue({ user: { id: "client", role: "CONSULTANT" } } as never);
  prismaMock.partnerProject.findUnique.mockResolvedValue(row({
    id: "p1",
    name: "Проект",
    purpose: "Назначение",
    ownerId: "client",
    appealId: null,
    service: { id: "svc1", title: "Честный Знак" },
  }));
});

describe("кто попадает в чат по проекту", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(ensureProjectConversation).not.toHaveBeenCalled();
  });

  it("владелец проекта попадает", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe("conv1");
  });

  it("ИНВАРИАНТ: администрация попадает в ТОТ ЖЕ разговор", async () => {
    /* В этом и смысл правки: один разговор, а не переписка заказчика с одним
       окном и администратора с другим. */
    mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe("conv1");
  });

  it("ИНВАРИАНТ: посторонний в чужой проект не попадает", async () => {
    mockSession.mockResolvedValue({ user: { id: "чужой", role: "CONSULTANT" } } as never);
    expect((await post()).status).toBe(403);
    expect(ensureProjectConversation).not.toHaveBeenCalled();
  });

  it("несуществующий проект — 404", async () => {
    prismaMock.partnerProject.findUnique.mockResolvedValue(null as never);
    expect((await post()).status).toBe(404);
  });
});

describe("когда разговор открыть нельзя", () => {
  it("ФИКСАЦИЯ: нет канала обращений — внятный отказ, а не пустой успех", async () => {
    ensureProjectConversation.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("раздел обращений не создан");
  });

  it("ФИКСАЦИЯ: некому вести разговор — тоже отказ", async () => {
    /* Обращение завелось, а собеседника нет: в проекте не заведено ни одного
       администратора или редактора. Отдать «успех» без адреса чата значит
       отправить человека в никуда. */
    ensureProjectConversation.mockResolvedValue({ appealId: "ap1", conversationId: null });
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("нет ни одного администратора");
  });
});
