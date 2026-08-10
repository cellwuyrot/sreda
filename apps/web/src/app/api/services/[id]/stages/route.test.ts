/**
 * Тесты: /api/services/[id]/stages — редактор этапов работ по услуге.
 *
 * Проверяется то, ради чего маршрут заводился, и то, чем он может навредить:
 *
 *   • правит только администрация — этапы видит каждый заказчик в кабинете,
 *     это публичное обещание о ходе работ;
 *   • услуга без своего набора всё равно отдаёт непустой список, иначе кабинет
 *     показал бы карточку без этапов;
 *   • идентификаторы существующих этапов сохраняются при переименовании и
 *     перестановке — по ним в проектах отмечены выполненные работы;
 *   • сброс пишет NULL, а не копию каталожного набора: копия застыла бы.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/services/svc1/stages", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const params = { params: Promise.resolve({ id: "svc1" }) };

async function call(method: "GET" | "PUT" | "DELETE", body?: unknown) {
  const mod = await import("@/app/api/services/[id]/stages/route");
  const req = makeRequest(method, body);
  const res = method === "GET"
    ? await mod.GET(req, params)
    : method === "PUT"
      ? await mod.PUT(req, params)
      : await mod.DELETE(req, params);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.service.findUnique.mockResolvedValue(row({ id: "svc1", title: "Честный Знак", stages: null }));
  prismaMock.service.update.mockResolvedValue(row({ id: "svc1", title: "Честный Знак", stages: null }));
});

describe("кто правит этапы", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(401);
    expect((await call("PUT", { stages: [{ title: "Этап" }] })).status).toBe(401);
    expect((await call("DELETE")).status).toBe(401);
  });

  it("ИНВАРИАНТ: обычный пользователь не правит этапы чужой услуги", async () => {
    /* Этапы видит каждый заказчик — это обещание о ходе работ от лица проекта,
       а не личная заметка. */
    mockSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    expect((await call("GET")).status).toBe(403);
    expect((await call("PUT", { stages: [{ title: "Этап" }] })).status).toBe(403);
    expect((await call("DELETE")).status).toBe(403);
    expect(prismaMock.service.update).not.toHaveBeenCalled();
  });

  it("редактор правит наравне с администратором", async () => {
    mockSession.mockResolvedValue({ user: { id: "e1", role: "EDITOR" } } as never);
    expect((await call("GET")).status).toBe(200);
  });

  it("несуществующая услуга — 404", async () => {
    prismaMock.service.findUnique.mockResolvedValue(null as never);
    expect((await call("GET")).status).toBe(404);
    expect((await call("PUT", { stages: [{ title: "Этап" }] })).status).toBe(404);
    expect((await call("DELETE")).status).toBe(404);
  });
});

describe("чтение набора", () => {
  it("ИНВАРИАНТ: услуга без своего набора отдаёт каталожный, а не пустоту", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.body.custom).toBe(false);
    expect(res.body.stages[0]).toEqual({ id: "honest-1", title: "Заявка принята" });
    expect(res.body.stages.length).toBeGreaterThan(0);
  });

  it("свой набор отдаётся как есть и помечается как правленый", async () => {
    prismaMock.service.findUnique.mockResolvedValue(row({
      id: "svc1",
      title: "Честный Знак",
      stages: [{ id: "s1", title: "Мой этап" }],
    }));
    const res = await call("GET");
    expect(res.body.custom).toBe(true);
    expect(res.body.stages).toEqual([{ id: "s1", title: "Мой этап" }]);
    /* Каталожный набор приходит рядом: кнопка «По умолчанию» обязана показать,
       к чему вернётся список, ещё до нажатия. */
    expect(res.body.defaults[0].id).toBe("honest-1");
  });
});

describe("сохранение набора", () => {
  it("ИНВАРИАНТ: набор без единого этапа не сохраняется", async () => {
    /* Пустой список означал бы карточку проекта без этапов и без прогресса. */
    expect((await call("PUT", { stages: [] })).status).toBe(400);
    expect((await call("PUT", { stages: [{ title: "   " }] })).status).toBe(400);
    expect((await call("PUT", {})).status).toBe(400);
    expect(prismaMock.service.update).not.toHaveBeenCalled();
  });

  it("слишком длинный список отклоняется", async () => {
    const stages = Array.from({ length: 40 }, (_, i) => ({ title: `Этап ${i}` }));
    expect((await call("PUT", { stages })).status).toBe(400);
    expect(prismaMock.service.update).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: идентификаторы существующих этапов сохраняются", async () => {
    /* Переименование и перестановка не должны сбивать отметки о выполненных
       работах у проектов — они помнят этап по идентификатору. */
    await call("PUT", {
      stages: [
        { id: "honest-3", title: "Регистрация в ГИС МТ" },
        { id: "honest-1", title: "Заявка получена" },
        { title: "Совсем новый этап" },
      ],
    });
    /* Приведение через unknown: тип входа Json-поля объединяет массив с DbNull,
       и прямое сужение компилятор не пропускает. */
    const args = prismaMock.service.update.mock.calls[0]![0] as unknown as { data: { stages: { id: string; title: string }[] } };
    expect(args.data.stages[0]).toEqual({ id: "honest-3", title: "Регистрация в ГИС МТ" });
    expect(args.data.stages[1]).toEqual({ id: "honest-1", title: "Заявка получена" });
    expect(args.data.stages[2]!.title).toBe("Совсем новый этап");
    expect(args.data.stages[2]!.id).toBeTruthy();
  });

  it("ФИКСАЦИЯ: идентификатор новому этапу выдаёт сервер, а не клиент", async () => {
    /* Два администратора, добавившие этап одновременно, выдали бы один и тот же
       номер, и отметки проектов слиплись бы. */
    await call("PUT", { stages: [{ title: "Первый" }, { title: "Второй" }] });
    const args = prismaMock.service.update.mock.calls[0]![0] as unknown as { data: { stages: { id: string }[] } };
    const ids = args.data.stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("сброс набора", () => {
  it("ИНВАРИАНТ: сброс пишет NULL, а не копию каталожного набора", async () => {
    /* Копия застыла бы: поправили формулировку в каталоге — у услуги остался бы
       старый текст, и никто бы не понял, почему. */
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(res.body.custom).toBe(false);
    expect(res.body.stages[0].id).toBe("honest-1");
    const args = prismaMock.service.update.mock.calls[0]![0] as unknown as { data: { stages: unknown } };
    expect(Array.isArray(args.data.stages)).toBe(false);
  });
});
