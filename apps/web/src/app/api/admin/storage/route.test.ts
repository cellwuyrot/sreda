/**
 * Тесты: /api/admin/storage — где лежат файлы и перекладывание их между машинами.
 *
 * Проверяется то, что в этом маршруте может стоить дорого:
 *
 *   • право — только администратор: это распоряжение железом;
 *   • «на главном сервере» показывается как состояние, а не как очередь работ;
 *   • перенос идёт порциями с ограничением сверху, а не «всё сразу»;
 *   • без настроенного узла перенос отвечает отказом, а не тихим нулём.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const offload = {
  currentTargetNode: vi.fn(async () => ({ id: "n1", name: "Хранилище-1" })),
  migrateBatch: vi.fn(
    async (limit: number): Promise<{ moved: number; failed: number; remaining: number; nodeName: string | null }> => ({
      moved: limit,
      failed: 0,
      remaining: 0,
      nodeName: "Хранилище-1",
    }),
  ),
  restoreToMain: vi.fn(async () => true),
};
vi.mock("@/lib/uploadOffload", () => offload);

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

async function call(method: "GET" | "POST", body?: unknown) {
  const mod = await import("@/app/api/admin/storage/route");
  const res =
    method === "GET"
      ? await mod.GET()
      : await mod.POST(
          new Request("http://localhost/api/admin/storage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
          }),
        );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  offload.currentTargetNode.mockResolvedValue({ id: "n1", name: "Хранилище-1" });
  offload.migrateBatch.mockClear();
  offload.restoreToMain.mockClear().mockResolvedValue(true);
  prismaMock.uploadedFile.count.mockResolvedValue(row(0));
  prismaMock.uploadedFile.groupBy.mockResolvedValue(row([]));
  prismaMock.uploadedFile.findMany.mockResolvedValue(row([]));
  prismaMock.serverNode.findMany.mockResolvedValue(row([]));
});

describe("кто распоряжается хранилищем", () => {
  it("ИНВАРИАНТ: редактор не допускается", async () => {
    mockSession.mockResolvedValue({ user: { id: "e1", role: "EDITOR" } } as never);
    expect((await call("GET")).status).toBe(403);
    expect((await call("POST", { action: "migrate" })).status).toBe(403);
    expect(offload.migrateBatch).not.toHaveBeenCalled();
  });

  it("без сессии — 403", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(403);
  });
});

describe("картина по файлам", () => {
  it("показывает, сколько где лежит, и куда пойдут новые", async () => {
    prismaMock.uploadedFile.count.mockResolvedValue(row(120));
    prismaMock.uploadedFile.groupBy.mockResolvedValue(
      row([
        { nodeId: null, _count: { _all: 20 } },
        { nodeId: "n1", _count: { _all: 100 } },
      ]),
    );
    prismaMock.serverNode.findMany.mockResolvedValue(row([{ id: "n1", name: "Хранилище-1" }]));

    const res = await call("GET");
    expect(res.body.byNode).toEqual([{ nodeId: "n1", name: "Хранилище-1", count: 100 }]);
    expect(res.body.target).toEqual({ id: "n1", name: "Хранилище-1" });
  });

  it("узел удалён, а файлы числятся за ним — так и говорим, без пустого имени", async () => {
    prismaMock.uploadedFile.groupBy.mockResolvedValue(row([{ nodeId: "нет-такого", _count: { _all: 3 } }]));
    prismaMock.serverNode.findMany.mockResolvedValue(row([]));
    const res = await call("GET");
    expect(res.body.byNode[0].name).toBe("узел удалён");
  });

  it("узла нет — цель пустая, и это нормальное состояние", async () => {
    offload.currentTargetNode.mockResolvedValue(null as never);
    const res = await call("GET");
    expect(res.body.target).toBeNull();
  });
});

describe("перенос", () => {
  it("переносит порцию и возвращает остаток", async () => {
    offload.migrateBatch.mockResolvedValue({ moved: 25, failed: 0, remaining: 300, nodeName: "Хранилище-1" });
    const res = await call("POST", { action: "migrate", limit: 25 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ moved: 25, remaining: 300 });
  });

  it("ФИКСАЦИЯ: размер порции ограничен сверху — «всё сразу» запросить нельзя", async () => {
    /* Иначе один запрос на живом сервере уходит в перекладку сотен гигабайт:
       время ответа непредсказуемо, а остановить процесс нечем. */
    await call("POST", { action: "migrate", limit: 100000 });
    expect(offload.migrateBatch).toHaveBeenCalledWith(200);
  });

  it("странный размер порции превращается в разумный", async () => {
    await call("POST", { action: "migrate", limit: -5 });
    expect(offload.migrateBatch).toHaveBeenCalledWith(25);
  });

  it("без настроенного узла — отказ словами, а не тихий ноль", async () => {
    offload.migrateBatch.mockResolvedValue({ moved: 0, failed: 0, remaining: 0, nodeName: null });
    const res = await call("POST", { action: "migrate" });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/узла хранения/i);
  });

  it("неизвестное действие отклоняется", async () => {
    const res = await call("POST", { action: "удалить-всё" });
    expect(res.status).toBe(400);
    expect(offload.migrateBatch).not.toHaveBeenCalled();
  });
});

describe("возврат файлов на главный сервер", () => {
  it("возвращает порцию файлов указанного узла", async () => {
    prismaMock.uploadedFile.findMany.mockResolvedValue(row([{ path: "messages/a.webp" }, { path: "documents/b.pdf" }]));
    prismaMock.uploadedFile.count.mockResolvedValue(row(5));
    const res = await call("POST", { action: "restore", nodeId: "n1", limit: 2 });
    expect(res.body).toMatchObject({ moved: 2, failed: 0, remaining: 5 });
    expect(offload.restoreToMain).toHaveBeenCalledTimes(2);
  });

  it("без узла возврат не запускается", async () => {
    const res = await call("POST", { action: "restore" });
    expect(res.status).toBe(400);
    expect(offload.restoreToMain).not.toHaveBeenCalled();
  });

  it("неудачный возврат считается отдельно, а не выдаётся за успех", async () => {
    prismaMock.uploadedFile.findMany.mockResolvedValue(row([{ path: "a/1" }, { path: "a/2" }]));
    offload.restoreToMain.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await call("POST", { action: "restore", nodeId: "n1" });
    expect(res.body).toMatchObject({ moved: 1, failed: 1 });
  });
});
