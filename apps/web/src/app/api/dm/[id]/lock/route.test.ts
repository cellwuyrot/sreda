/**
 * Тесты: POST /api/dm/[id]/lock — запрет клиенту писать в деловой разговор.
 *
 * Зачем это появилось: остановить клиента в деловом разговоре было нечем. Чёрного
 * списка там нет и быть не может — собеседник у клиента не человек, а
 * администрация; закрытие заявки отправку тоже не запрещало, потому что статус
 * описывает состояние работы, а не право писать.
 *
 * Три вещи, которые здесь проверяются и которые легко испортить: право закрывать,
 * односторонность запрета (администрация пишет и после) и то, что личная переписка
 * такого запрета не получает.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const emitToUser = vi.fn();
vi.mock("@/lib/socketEmit", () => ({ emitToUser: (...a: unknown[]) => emitToUser(...a) }));

import { getServerSession } from "next-auth";

const mockSession = vi.mocked(getServerSession);

function conversation(kind: "PERSONAL" | "BUSINESS", locked = false) {
  return row({
    id: "conv-1",
    kind,
    user1Id: "client-1",
    user2Id: "admin-1",
    appealId: kind === "BUSINESS" ? "appeal-1" : null,
    handlerId: "admin-1",
    locked,
  });
}

async function lock(body: unknown) {
  const { POST } = await import("@/app/api/dm/[id]/lock/route");
  const req = new Request("http://localhost/api/dm/conv-1/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
  const res = await POST(req, { params: Promise.resolve({ id: "conv-1" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  emitToUser.mockClear();
  mockSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
  prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS"));
  prismaMock.directConversation.update.mockResolvedValue(row({ id: "conv-1", locked: true, lockedAt: new Date() }));
  prismaMock.user.findMany.mockResolvedValue(row([{ id: "admin-1" }, { id: "editor-2" }]));
});

describe("кто может закрыть отправку", () => {
  it("без сессии — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await lock({ locked: true })).status).toBe(401);
  });

  /**
   * ИНВАРИАНТ: запрет — полномочие администрации, а не участника разговора. Клиент
   * находится в паре, но закрыть отправку не может: иначе он закрыл бы её сам себе
   * или, что важнее, администрации.
   */
  it("ИНВАРИАНТ: клиент запрет не ставит, хотя он участник", async () => {
    mockSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    const { status } = await lock({ locked: true });
    expect(status).toBe(403);
    expect(prismaMock.directConversation.update).not.toHaveBeenCalled();
  });

  it("администратор и редактор — могут", async () => {
    for (const role of ["ADMIN", "EDITOR"]) {
      prismaMock.directConversation.update.mockClear();
      mockSession.mockResolvedValue({ user: { id: "staff-1", role } } as never);
      expect((await lock({ locked: true })).status).toBe(200);
      expect(prismaMock.directConversation.update).toHaveBeenCalled();
    }
  });

  it("право не зависит от того, кто ведёт заявку: очередь общая", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    expect((await lock({ locked: true })).status).toBe(200);
  });
});

describe("где запрет применим", () => {
  it("несуществующий разговор — 404", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    expect((await lock({ locked: true })).status).toBe(404);
  });

  /**
   * ИНВАРИАНТ: личная переписка такого запрета не получает. Там для этого есть
   * чёрный список, и он взаимный; односторонний запрет между двумя людьми был бы
   * новым видом власти одного над другим.
   */
  it("ИНВАРИАНТ: в личной переписке запрет невозможен", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("PERSONAL"));
    const { status, body } = await lock({ locked: true });
    expect(status).toBe(400);
    expect(body.error).toMatch(/чёрный список/i);
    expect(prismaMock.directConversation.update).not.toHaveBeenCalled();
  });
});

describe("что записывается и кто узнаёт", () => {
  it("закрытие ставит признак и отметку времени", async () => {
    await lock({ locked: true });
    const args = prismaMock.directConversation.update.mock.calls[0][0] as {
      where: { id: string };
      data: { locked: boolean; lockedAt: Date | null };
    };
    expect(args.where.id).toBe("conv-1");
    expect(args.data.locked).toBe(true);
    expect(args.data.lockedAt).toBeInstanceOf(Date);
  });

  it("открытие снимает и признак, и отметку", async () => {
    prismaMock.directConversation.update.mockResolvedValue(row({ id: "conv-1", locked: false, lockedAt: null }));
    await lock({ locked: false });
    const args = prismaMock.directConversation.update.mock.calls[0][0] as {
      data: { locked: boolean; lockedAt: Date | null };
    };
    expect(args.data.locked).toBe(false);
    expect(args.data.lockedAt).toBeNull();
  });

  /**
   * ИНВАРИАНТ: о запрете узнаёт клиент, и сразу. Иначе он поймёт это, только
   * набрав сообщение и получив отказ, — а закрытое поле честнее отказа.
   */
  it("ИНВАРИАНТ: событие уходит клиенту", async () => {
    await lock({ locked: true });
    const recipients = emitToUser.mock.calls.map((call) => call[0]);
    expect(recipients).toContain("client-1");
    const payload = emitToUser.mock.calls[0][2] as { conversationId: string; locked: boolean };
    expect(payload).toMatchObject({ conversationId: "conv-1", locked: true });
  });

  /**
   * ИНВАРИАНТ: узнаёт и остальная администрация. Иначе двое сотрудников будут
   * открывать и закрывать отправку по кругу, не видя действий друг друга.
   */
  it("ИНВАРИАНТ: событие уходит всей администрации", async () => {
    await lock({ locked: true });
    const recipients = emitToUser.mock.calls.map((call) => call[0]);
    expect(recipients).toContain("admin-1");
    expect(recipients).toContain("editor-2");
  });

  it("тело без признака — 400, и ничего не меняется", async () => {
    for (const body of [{}, { locked: "да" }, { locked: 1 }]) {
      expect((await lock(body)).status).toBe(400);
    }
    expect(prismaMock.directConversation.update).not.toHaveBeenCalled();
  });
});
