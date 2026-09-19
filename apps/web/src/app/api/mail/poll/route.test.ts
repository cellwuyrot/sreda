import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mailImap", () => ({ fetchRecent: vi.fn() }));

import { getServerSession } from "next-auth";
import { fetchRecent } from "@/lib/mailImap";
const mockSession = vi.mocked(getServerSession);
const mockFetch = vi.mocked(fetchRecent);

function post(body: unknown, headers: Record<string, string> = {}) {
  const req = new Request("http://localhost/api/mail/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return req as unknown as import("next/server").NextRequest;
}

function incoming(id: string, messageId: string) {
  return {
    direction: "incoming" as const,
    fromAddr: "client@example.com",
    toAddr: "support@trioz.ru",
    subject: "S " + id,
    preview: "p",
    bodyText: "b",
    bodyHtml: null,
    messageId,
    sentAt: new Date("2026-09-11T09:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MAIL_CRON_SECRET;
});

describe("POST /api/mail/poll", () => {
  it("401 без админа и без cron-секрета", async () => {
    mockSession.mockResolvedValue(null as never);
    const mod = await import("@/app/api/mail/poll/route");
    const res = await mod.POST(post({}));
    expect(res.status).toBe(401);
  });

  it("404 на неизвестный ящик", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as never);
    const mod = await import("@/app/api/mail/poll/route");
    const res = await mod.POST(post({ address: "nobody" }));
    expect(res.status).toBe(404);
  });

  it("cron-секрет пускает без сессии и сохраняет входящие с дедупом", async () => {
    process.env.MAIL_CRON_SECRET = "topsecret";
    mockSession.mockResolvedValue(null as never);
    mockFetch.mockResolvedValue([incoming("1", "<a@x>"), incoming("2", "<b@x>")]);
    prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "m1", localPart: "support" }));
    // Первое письмо уже есть (дубль), второе — новое.
    prismaMock.mailMessage.findFirst
      .mockResolvedValueOnce(row({ id: "exists" }))
      .mockResolvedValueOnce(row(null));
    prismaMock.mailMessage.create.mockResolvedValue(row({ id: "new" }));

    const mod = await import("@/app/api/mail/poll/route");
    const res = await mod.POST(post({ address: "support" }, { "x-cron-secret": "topsecret" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.stored).toBe(1);
    expect(json.duplicates).toBe(1);
    expect(json.fetched).toBe(2);
    expect(prismaMock.mailMessage.create).toHaveBeenCalledOnce();
  });

  it("дедуп ищет письмо в пределах ящика, а не по всей таблице", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as never);
    mockFetch.mockResolvedValue([incoming("1", "<a@x>")]);
    prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "m1", localPart: "support" }));
    prismaMock.mailMessage.findFirst.mockResolvedValue(row(null));
    prismaMock.mailMessage.create.mockResolvedValue(row({ id: "new" }));

    const mod = await import("@/app/api/mail/poll/route");
    await mod.POST(post({ address: "support" }));
    expect(prismaMock.mailMessage.findFirst).toHaveBeenCalledWith({
      where: { mailboxId: "m1", messageId: "<a@x>" },
      select: { id: true },
    });
  });

  it("гонка двух опросов: P2002 — это дубль, а не сбой ящика", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as never);
    mockFetch.mockResolvedValue([incoming("1", "<a@x>")]);
    prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "m1", localPart: "support" }));
    prismaMock.mailMessage.findFirst.mockResolvedValue(row(null));
    prismaMock.mailMessage.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const mod = await import("@/app/api/mail/poll/route");
    const res = await mod.POST(post({ address: "support" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.stored).toBe(0);
    expect(json.duplicates).toBe(1);
    expect(json.errors).toEqual([]);
  });

  it("502 когда все ящики дали ошибку", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as never);
    mockFetch.mockRejectedValue(new Error("IMAP не настроен"));
    const mod = await import("@/app/api/mail/poll/route");
    const res = await mod.POST(post({ address: "support" }));
    expect(res.status).toBe(502);
  });
});
