/**
 * PROJECT-MAIL: тесты листинга и архивации писем ящика домена.
 *
 * Проверяется то, что важно для этого экрана:
 *   • читать и архивировать может только администратор;
 *   • страница истории: направление, архив, лимит, смещение и потолок лимита;
 *   • поиск и фильтр папки уходят в базу, а не режут загруженную страницу;
 *   • ответ отдаёт total/hasMore — по ним UI листает историю;
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

/** Ящик посеян, писем нет — минимум для проверки формы запроса. */
function seeded() {
  prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info" }));
  prismaMock.mailMessage.count.mockResolvedValue(row(0));
  prismaMock.mailMessage.findMany.mockResolvedValue(row([]));
}

type Contains = { contains: string; mode: "insensitive" };
type FindManyArg = {
  take: number;
  skip: number;
  orderBy: Array<Record<string, string>>;
  where: {
    mailboxId: string;
    archived: boolean;
    direction?: string;
    AND?: Array<{ OR?: Array<Record<string, Contains>> } & Record<string, Contains | unknown>>;
  };
};

/** Аргумент последнего findMany — то, что роут реально спросил у базы. */
function findManyArg(): FindManyArg {
  const calls = prismaMock.mailMessage.findMany.mock.calls;
  return calls[calls.length - 1][0] as unknown as FindManyArg;
}

beforeEach(() => {
  mockSession.mockReset();
  prismaMock.mailMessage.findMany.mockClear();
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

  it("страница по умолчанию — 25 писем с начала, фильтр по направлению", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?direction=incoming");
    const arg = findManyArg();
    expect(arg.take).toBe(25);
    expect(arg.skip).toBe(0);
    expect(arg.where.direction).toBe("incoming");
    expect(arg.where.archived).toBe(false);
    expect(arg.where.mailboxId).toBe("m-info");
  });

  it("limit и offset листают историю, лимит ограничен сверху", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?direction=incoming&limit=50&offset=75");
    expect(findManyArg().take).toBe(50);
    expect(findManyArg().skip).toBe(75);

    prismaMock.mailMessage.findMany.mockClear();
    await callGet("info", "?limit=5000");
    expect(findManyArg().take).toBe(100);
  });

  it("сортировка с добором по id — страницы не перетасовываются", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?direction=incoming");
    expect(findManyArg().orderBy).toEqual([{ sentAt: "desc" }, { id: "desc" }]);
  });

  it("?archived=1 показывает архив и умеет направление внутри архива", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?archived=1&direction=outgoing");
    expect(findManyArg().where.archived).toBe(true);
    expect(findManyArg().where.direction).toBe("outgoing");
  });

  it("поиск уходит в базу по теме, адресам и предпросмотру", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?direction=incoming&q=%D0%BE%D0%BF%D0%BB%D0%B0%D1%82%D0%B0");
    const and = findManyArg().where.AND;
    const or = and?.[0]?.OR ?? [];
    expect(or).toHaveLength(4);
    expect(or.map((c) => Object.keys(c)[0])).toEqual(["subject", "fromAddr", "toAddr", "preview"]);
    expect(or[0].subject).toEqual({ contains: "оплата", mode: "insensitive" });
  });

  it("фильтр папки уходит в базу вместе с поиском", async () => {
    asAdmin();
    seeded();
    await callGet("info", "?direction=incoming&q=%D0%B0&from=support%40&subject=%D1%81%D1%87%D1%91%D1%82");
    const and = findManyArg().where.AND ?? [];
    expect(and).toHaveLength(3);
    expect(and[1]).toEqual({ fromAddr: { contains: "support@", mode: "insensitive" } });
    expect(and[2]).toEqual({ subject: { contains: "счёт", mode: "insensitive" } });
  });

  it("отдаёт total и hasMore для пагинации", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row({ id: "m-info", localPart: "info" }));
    prismaMock.mailMessage.count.mockResolvedValue(row(42));
    prismaMock.mailMessage.findMany.mockResolvedValue(row([{ id: "x1" }]));
    const res = await callGet("info", "?direction=incoming&limit=1");
    expect(res.body).toMatchObject({ total: 42, offset: 0, limit: 1, hasMore: true });

    prismaMock.mailMessage.count.mockResolvedValue(row(2));
    prismaMock.mailMessage.findMany.mockResolvedValue(row([{ id: "x1" }, { id: "x2" }]));
    const last = await callGet("info", "?direction=incoming");
    expect(last.body.hasMore).toBe(false);
  });

  it("ящик ещё не посеян — пустой список", async () => {
    asAdmin();
    prismaMock.projectMailbox.findUnique.mockResolvedValue(row(null));
    const res = await callGet("sales");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.hasMore).toBe(false);
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
