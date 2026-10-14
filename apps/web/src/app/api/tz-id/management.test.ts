import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { randomBytes } from "node:crypto";
import { prismaMock } from "@/test/prismaMock";
import { encryptTzData } from "@/lib/tzIdCrypto";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock } = await import("@/test/prismaMock");
  return { default: prismaMock, prisma: prismaMock };
});
const apps = await import("./applications/route");
const admin = await import("../admin/tz-id/route");
const sessionMock = vi.mocked(getServerSession);
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://trioz.ru";
  process.env.TZ_ID_STORAGE_KEY = randomBytes(32).toString("base64");
  sessionMock.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
});
function request(
  path: string,
  method: string,
  body?: unknown,
  origin = "https://trioz.ru",
) {
  return new NextRequest(`https://trioz.ru${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("applications require login", async () => {
  sessionMock.mockResolvedValue(null);
  expect((await apps.GET()).status).toBe(401);
});
it("application list only queries the current user's authorizations", async () => {
  prismaMock.tzIdAuthorization.findMany.mockResolvedValue([
    {
      clientId: "c1",
      scopes: "openid",
      lastUsedAt: new Date(),
      client: { id: "c1", name: "App", enabled: true },
    },
    {
      clientId: "c1",
      scopes: "openid email",
      lastUsedAt: new Date(),
      client: { id: "c1", name: "App", enabled: true },
    },
  ] as never);
  const data = await (await apps.GET()).json();
  expect(data).toHaveLength(1);
  expect(data[0].scopes).toEqual(["openid", "email"]);
  expect(prismaMock.tzIdAuthorization.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", revokedAt: null }),
    }),
  );
});
it("app revoke never modifies another user's grants", async () => {
  prismaMock.$transaction.mockImplementation(
    async (fn: unknown) =>
      (fn as (db: typeof prismaMock) => Promise<unknown>)(prismaMock) as never,
  );
  prismaMock.tzIdAuthorization.findMany.mockResolvedValue([
    { id: "own-grant" },
  ] as never);
  const result = await apps.DELETE(
    request("/api/tz-id/applications?clientId=c1", "DELETE"),
  );
  expect(result.status).toBe(200);
  expect(prismaMock.tzIdAuthorization.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: "u1", clientId: "c1" } }),
  );
  expect(prismaMock.tzIdArtifact.deleteMany).toHaveBeenCalledWith({
    where: { grantId: { in: ["own-grant"] } },
  });
});
it("cross-origin management action fails before touching data", async () => {
  expect(
    (
      await apps.DELETE(
        request(
          "/api/tz-id/applications?clientId=c1",
          "DELETE",
          undefined,
          "https://evil.invalid",
        ),
      )
    ).status,
  ).toBe(403);
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
});
it("admin registry rejects non-admin and anonymous access", async () => {
  expect((await admin.GET()).status).toBe(403);
  sessionMock.mockResolvedValue(null);
  expect((await admin.GET()).status).toBe(403);
});
it("admin registry never returns stored secrets or encrypted metadata", async () => {
  sessionMock.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.tzIdClient.findMany.mockResolvedValue([
    {
      id: "c1",
      name: "App",
      enabled: true,
      createdAt: new Date(),
      metadata: encryptTzData({
        redirect_uris: ["https://app.example/callback"],
        client_secret: "never-return-this",
        token_endpoint_auth_method: "client_secret_basic",
      }),
    },
  ] as never);
  const data = await (await admin.GET()).json();
  expect(JSON.stringify(data)).not.toContain("never-return-this");
  expect(data[0].metadata).toBeUndefined();
  expect(data[0].redirectUris).toEqual(["https://app.example/callback"]);
});
it("client creation checks origin and administrator role", async () => {
  expect(
    (await admin.POST(request("/api/admin/tz-id", "POST", { name: "App" })))
      .status,
  ).toBe(403);
  expect(
    (
      await admin.POST(
        request(
          "/api/admin/tz-id",
          "POST",
          { name: "App" },
          "https://evil.invalid",
        ),
      )
    ).status,
  ).toBe(403);
  expect(prismaMock.tzIdClient.create).not.toHaveBeenCalled();
});
it("admin creation returns a secret only once and persists it encrypted", async () => {
  sessionMock.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.tzIdClient.create.mockResolvedValue({} as never);
  const response = await admin.POST(
    request("/api/admin/tz-id", "POST", {
      name: "App",
      redirectUris: ["https://app.example/callback"],
    }),
  );
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.clientSecret).toHaveLength(43);
  const call = prismaMock.tzIdClient.create.mock.calls[0][0];
  expect(call.data.metadata).not.toContain(data.clientSecret);
  expect(prismaMock.user.create).not.toHaveBeenCalled();
});
it("admin invalid redirect URI is rejected without storage", async () => {
  sessionMock.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  expect(
    (
      await admin.POST(
        request("/api/admin/tz-id", "POST", {
          name: "App",
          redirectUris: ["http://evil.invalid/callback"],
        }),
      )
    ).status,
  ).toBe(400);
  expect(prismaMock.tzIdClient.create).not.toHaveBeenCalled();
});
