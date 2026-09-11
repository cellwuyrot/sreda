/**
 * PROJECT-MAIL: тесты листинга и архивации писем ящика домена.
 *
 * Проверяется то, что важно для этого экрана:
 *   • читать и архивировать может только администратор;
 *   • листинг ограничен 10 письмами и фильтруется по направлению;
 *   • неизвестный ящик — 404;
 *   • архивация трогает только письмо своего ящика.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));

import { getServerSession } from "next-auth";

const mockSession = vi.mocked(getServerSession);

function asAdmin() {
  mockSession.mockResolvedValue(row({ user: { id: "a1", role: "ADMIN", username: "admin" } }));
}
function asUser() {
  mockSession.mockResolvedValue(row({ user: { id: "u1", role: "USER", username: "user" } }));
}

async function callGet(address: string, query = "") {
  const mod = await import("@/app/api/admin/mail/[address]/route");
  const req = new Request(`http://localhost/api/admin/mail/${address}${query}`);
  const res = await mod.GET(req as never, { params: Promise.resolve({ address }) });
  return { status: res.status, body: await res.json() };
}

async function callPatch(address: string, body: unknown) {
  const mod = await import("@/app/api/admin/mail/[address]/route");
  const req = new Request(`http://localhost/api/admin/mail/${address}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req as never, { params: Promise.resolve({ address }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockReset();
});

describe("GET /api/admin/mail/[address]", () => {
  it("отказывает не-админу (403)", async () => {
    asUser();
    const res = await callGet("info");
    expect(res.status).toBe(403);
  });

  it("неизвестный ящик — 404", async () => {
    asAdmin();
    const res = await callGet("ceo");
    expect(res.status).toBe(404);
  });

  it("ограничивает выборку 10 письмами и фильтрует incoming", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info" }));
    prismaMock.mailMessage.findMany.mockResolvedValue(row([]));
    await callGet("info", "?direction=incoming");
    const arg = prismaMock.mailMessage.findMany.mock.calls[0][0] as {
      take: number;
      where: { direction?: string; archived: boolean; mailboxId: string };
    };
    expect(arg.take).toBe(10);
    expect(arg.where.direction).toBe("incoming");
    expect(arg.where.archived).toBe(false);
    expect(arg.where.mailboxId).toBe("m-info");
  });

  it("?archived=1 показывает архив", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info" }));
    prismaMock.mailMessage.findMany.mockResolvedValue(row([]));
    await callGet("info", "?archived=1");
    const arg = prismaMock.mailMessage.findMany.mock.calls[0][0] as { where: { archived: boolean } };
    expect(arg.where.archived).toBe(true);
  });

  it("ящик ещё не посеян — пустой список", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row(null));
    const res = await callGet("sales");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });
});

describe("PATCH /api/admin/mail/[address]", () => {
  it("отказывает не-админу (403)", async () => {
    asUser();
    const res = await callPatch("info", { id: "x1", archived: true });
    expect(res.status).toBe(403);
  });

  it("требует id и archived:boolean (400)", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info", address: "info@trioz.ru" }));
    const res = await callPatch("info", { id: "x1" });
    expect(res.status).toBe(400);
  });

  it("не трогает письмо чужого ящика (404)", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info", address: "info@trioz.ru" }));
    prismaMock.mailMessage.findFirst.mockResolvedValue(row(null));
    const res = await callPatch("info", { id: "foreign", archived: true });
    expect(res.status).toBe(404);
    expect(prismaMock.mailMessage.update).not.toHaveBeenCalled();
  });

  it("архивирует своё письмо", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info", address: "info@trioz.ru" }));
    prismaMock.mailMessage.findFirst.mockResolvedValue(row({ id: "x1", mailboxId: "m-info" }));
    prismaMock.mailMessage.update.mockResolvedValue(row({ id: "x1", archived: true }));
    const res = await callPatch("info", { id: "x1", archived: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: "x1", archived: true });
    expect(prismaMock.mailMessage.update).toHaveBeenCalledWith({ where: { id: "x1" }, data: { archived: true } });
  });
});
