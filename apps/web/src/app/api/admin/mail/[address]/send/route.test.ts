import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { getServerSession } from "next-auth";
import { sendEmail } from "@/lib/email";
const mockSession = vi.mocked(getServerSession);
const mockSend = vi.mocked(sendEmail);

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

  it("400 при неверном адресе получателя", async () => {
    mockSession.mockResolvedValue(admin as never);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "bad", subject: "s", text: "t" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("400 когда пустая тема", async () => {
    mockSession.mockResolvedValue(admin as never);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "a@b.co", subject: "  ", text: "t" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(400);
  });

  it("502 когда сервис отклонил письмо", async () => {
    mockSession.mockResolvedValue(admin as never);
    mockSend.mockResolvedValue(false);
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(post("support", { to: "a@b.co", subject: "s", text: "t" }), {
      params: Promise.resolve({ address: "support" }),
    });
    expect(res.status).toBe(502);
  });

  it("успех: шлёт от адреса ящика и пишет outgoing в базу", async () => {
    mockSession.mockResolvedValue(admin as never);
    mockSend.mockResolvedValue(true);
    prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "m1", localPart: "support" }));
    prismaMock.mailMessage.create.mockResolvedValue(row({ id: "msg1" }));
    const mod = await import("@/app/api/admin/mail/[address]/send/route");
    const res = await mod.POST(
      post("support", { to: "noperight81@gmail.com", subject: "Привет", text: "Текст" }),
      { params: Promise.resolve({ address: "support" }) },
    );
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledOnce();
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe("support@trioz.ru");
    expect(arg.to).toBe("noperight81@gmail.com");
    const createArg = prismaMock.mailMessage.create.mock.calls[0][0];
    expect(createArg.data.direction).toBe("outgoing");
    expect(createArg.data.fromAddr).toBe("support@trioz.ru");
    expect(createArg.data.toAddr).toBe("noperight81@gmail.com");
  });
});
