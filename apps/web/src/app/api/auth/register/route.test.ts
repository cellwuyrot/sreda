import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/test/prismaMock";
import { POST } from "./route";
vi.mock("@/lib/prisma", async () => { const { prismaMock } = await import("@/test/prismaMock"); return { default: prismaMock }; });
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/emailWhitelist", () => ({ isRegistrationEmailAllowed: vi.fn().mockResolvedValue(true), REGISTRATION_BLOCKED: "blocked" }));
vi.mock("@/lib/mainCommunity", () => ({ autoJoinMainCommunity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/identity", () => ({ getClientIp: () => "127.0.0.1", isIdentityBlocked: vi.fn().mockResolvedValue(false), recordIdentities: vi.fn().mockResolvedValue(undefined), DEVICE_COOKIE: "device" }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hash") } }));
const req = (username: string) => new NextRequest("http://localhost/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.org", name: "Андрей", username, password: "Secret123", verificationCode: "123456" }) });
beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.verificationCode.findFirst.mockResolvedValue({ id: "verification" } as never);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({ id: "u1", email: "test@example.org", name: "Андрей", username: "новый-ник" } as never);
});
describe("registration usernames", () => {
  it("accepts Unicode and no digit after verification", async () => {
    const response = await POST(req("новый-ник"));
    expect(response.status).toBe(200);
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ username: "новый-ник", emailVerified: true }) }));
  });
  it("rejects ambiguous identifiers before creating a user", async () => {
    const response = await POST(req("abc@example.org"));
    expect(response.status).toBe(400); expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
  it("rejects a username already used with different casing", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "other" } as never);
    const response = await POST(req("USERNAME"));
    expect(response.status).toBe(400); expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
  it("still requires a verified code", async () => {
    prismaMock.verificationCode.findFirst.mockResolvedValue(null);
    const response = await POST(req("безцифр"));
    expect(response.status).toBe(400); expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
