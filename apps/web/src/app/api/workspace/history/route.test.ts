/**
 * Тесты: /api/workspace/history — история рабочей среды.
 *
 * Проверяется то, ради чего снимки и заводились, и то, чем эта возможность
 * может навредить:
 *
 *   • чужой снимок по его идентификатору не достать;
 *   • перед возвратом делается снимок ТЕКУЩЕГО состояния — иначе «вернуть как
 *     было» само становится способом потерять работу;
 *   • о возврате узнают все устройства, включая то, с которого его сделали.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const emitToUser = vi.fn();
vi.mock("@/lib/socketEmit", () => ({ emitToUser: (...a: unknown[]) => emitToUser(...(a as [])) }));

const snapshots = {
  captureSnapshot: vi.fn(async () => undefined),
  listSnapshots: vi.fn(async () => [{ id: "s1", createdAt: new Date("2026-08-02T10:00:00Z"), size: 120 }]),
  readSnapshot: vi.fn(async () => JSON.stringify({ v: 3, boards: [] })),
};
vi.mock("@/lib/workspaceSnapshots", () => snapshots);

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

async function call(method: "GET" | "POST", body?: unknown) {
  const mod = await import("@/app/api/workspace/history/route");
  const res =
    method === "GET"
      ? await mod.GET()
      : await mod.POST(
          new Request("http://localhost/api/workspace/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
          }),
        );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
  emitToUser.mockClear();
  snapshots.captureSnapshot.mockClear();
  snapshots.readSnapshot.mockClear().mockResolvedValue(JSON.stringify({ v: 3, boards: [] }));
  prismaMock.workspaceState.findUnique.mockResolvedValue(row({ data: "{\"v\":3,\"boards\":[]}" }));
  prismaMock.workspaceState.upsert.mockResolvedValue(row({ updatedAt: new Date("2026-08-02T12:00:00Z") }));
});

describe("кто видит историю", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(401);
    expect((await call("POST", { id: "s1" })).status).toBe(401);
  });

  it("список отдаёт время и размер, но не холст", async () => {
    const res = await call("GET");
    expect(res.body.snapshots[0]).toMatchObject({ id: "s1", size: 120 });
    expect(JSON.stringify(res.body)).not.toContain("boards");
  });
});

describe("возврат к снимку", () => {
  it("без идентификатора — отказ", async () => {
    expect((await call("POST")).status).toBe(400);
  });

  it("ИНВАРИАНТ: чужой снимок не достать — владелец в запросе, а не в теле", async () => {
    /* Ключ владельца подставляется из сессии; по чужому идентификатору снимок
       просто не находится. */
    snapshots.readSnapshot.mockResolvedValue(null as never);
    const res = await call("POST", { id: "чужой" });
    expect(res.status).toBe(404);
    expect(snapshots.readSnapshot).toHaveBeenCalledWith("u1", "чужой");
    expect(prismaMock.workspaceState.upsert).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: перед возвратом сохраняется текущее состояние", async () => {
    /* Иначе «вернуть как было» само становится способом потерять работу:
       отыграл назад, понял что ошибся — а возвращаться уже некуда. */
    await call("POST", { id: "s1" });
    expect(snapshots.captureSnapshot).toHaveBeenCalledWith("u1", "{\"v\":3,\"boards\":[]}", "u1");
  });

  it("состояние записывается, ответ содержит время", async () => {
    const res = await call("POST", { id: "s1" });
    expect(res.status).toBe(200);
    expect(prismaMock.workspaceState.upsert).toHaveBeenCalled();
    expect(res.body.updatedAt).toBeTruthy();
  });

  it("ФИКСАЦИЯ: о возврате узнают ВСЕ устройства, включая это", async () => {
    /* Событие без clientId: иначе на экране, с которого нажали «вернуть»,
       остался бы прежний холст. */
    await call("POST", { id: "s1" });
    expect(emitToUser).toHaveBeenCalledWith("u1", "workspace-updated", expect.objectContaining({ clientId: null }));
  });
});
