import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/mailSmtp", () => ({ sendFromMailbox: vi.fn() }));

import { getServerSession } from "next-auth";
import { sendFromMailbox } from "@/lib/mailSmtp";
const mockSession = vi.mocked(getServerSession);
const mockSend = vi.mocked(sendFromMailbox);

const admin = { user: { id: "u1", role: "ADMIN", username: "admin" } };

function post(address: string, body: unknown) {
  const req = new Request("http://localhost/api/admin/mail/" + address + "/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return req as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/mail/[address]/send", () => {
  it("403 не-админу", async () => {
    mockSession.mockResolvedValue({ user: { id: "u2", role: "USER" } } as never);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", {}), { params: Promise.resolve({ address: "support" }) });
    expect(res.status).toBe(403);
  });

  it("404 на неизвестный ящик", async () => {
    mockSession.mockResolvedValue(admin as never);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("nobody", { to: "a@b.co", subject: "s", text: "t" }), {
      params: Promise.resolve({ address: "nobody" }),
    });
    expect(res.status).toBe(404);
  });

  it("400 при неверном адресе", async () => {
    mockSession.mockResolvedValue(admin as never);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "bad", subject: "s", text: "t" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("502 когда SMTP отклонил", async () => {
    mockSession.mockResolvedValue(admin as never);
    mockSend.mockResolvedValue({ ok: false, messageId: null, error: "SMTP не настроен" });
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "a@b.co", subject: "s", text: "t" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(502);
  });

  it("успех: отправляет и пишет outgoing в базу", async () => {
    mockSession.mockResolvedValue(admin as never);
    mockSend.mockResolvedValue({ ok: true, messageId: "<out@trioz.ru>" });
    prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "m1", localPart: "support" }));
    prismaMock.mailMessage.create.mockResolvedValue(row({ id: "msg1" }));
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "noperight81@gmail.com", subject: "Привет", text: "Текст" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledOnce();
    const createArg = prismaMock.mailMessage.create.mock.calls[0][0];
    expect(createArg.data.direction).toBe("outgoing");
    expect(createArg.data.toAddr).toBe("noperight81@gmail.com");
    expect(createArg.data.fromAddr).toBe("support@trioz.ru");
  });
});
