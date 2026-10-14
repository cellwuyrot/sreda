import { beforeEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { prismaMock } from "@/test/prismaMock";
import { encryptTzData } from "./tzIdCrypto";
import { projectApi } from "../../../id/src/api";
vi.mock("./prisma", async () => {
  const { prismaMock } = await import("@/test/prismaMock");
  return { default: prismaMock, prisma: prismaMock };
});
vi.mock("./rateLimit", () => ({ isRateLimited: vi.fn(async () => false) }));
const token = {
  accountId: "u1",
  clientId: "c1",
  scope:
    "contact:read subscriptions:read subscriptions:write notifications:write",
};
const find = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ_ID_STORAGE_KEY = randomBytes(32).toString("base64");
  find.mockResolvedValue(token);
  prismaMock.tzIdClient.findFirst.mockResolvedValue({
    id: "c1",
    enabled: true,
    metadata: encryptTzData({
      redirect_uris: ["https://app.example/callback"],
      scope: token.scope,
      token_endpoint_auth_method: "client_secret_basic",
    }),
  } as never);
  prismaMock.tzIdNotificationPreference.findUnique.mockResolvedValue(null);
  prismaMock.tzIdProjectNotification.findUnique.mockResolvedValue(null);
});
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  bearer = "Bearer opaque",
) {
  const req = Object.assign(
    Readable.from(body === undefined ? [] : [JSON.stringify(body)]),
    {
      method,
      headers: { authorization: bearer, "content-type": "application/json" },
    },
  );
  let payload = "";
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: (value: string) => {
      payload = value;
    },
  };
  await projectApi(
    req as never,
    res as never,
    { AccessToken: { find } },
    `/api/v1/${path}`,
  );
  return { status: res.statusCode, body: JSON.parse(payload) };
}
it("rejects absent bearer", async () => {
  expect((await call("contact", "GET", undefined, "")).status).toBe(401);
  expect(find).not.toHaveBeenCalled();
});
it("rejects expired/revoked/ID token", async () => {
  find.mockResolvedValue(undefined);
  expect((await call("contact")).status).toBe(401);
});
it("rejects disabled client", async () => {
  prismaMock.tzIdClient.findFirst.mockResolvedValue(null);
  expect((await call("contact")).status).toBe(403);
});
it("requires contact consent", async () => {
  find.mockResolvedValue({ ...token, scope: "openid" });
  expect((await call("contact")).status).toBe(403);
  expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
});
it("rejects scope not allowed by client registration", async () => {
  prismaMock.tzIdClient.findFirst.mockResolvedValue({
    id: "c1",
    metadata: encryptTzData({
      redirect_uris: ["https://app.example/callback"],
      scope: "openid",
      token_endpoint_auth_method: "client_secret_basic",
    }),
  } as never);
  expect((await call("contact")).status).toBe(403);
});
it("never returns account secrets in contact response", async () => {
  prismaMock.user.findUnique.mockResolvedValue({
    contactAddress: "Адрес",
  } as never);
  expect(await call("contact")).toEqual({
    status: 200,
    body: { sub: "u1", contactAddress: "Адрес" },
  });
  expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
    where: { id: "u1" },
    select: { contactAddress: true },
  });
});
it.each(["userId", "clientId", "sub"])("rejects injected %s", async (key) => {
  expect(
    (
      await call("subscriptions", "PUT", {
        externalId: "e",
        title: "Plan",
        status: "active",
        [key]: "other",
      })
    ).status,
  ).toBe(400);
  expect(prismaMock.tzIdProjectSubscription.upsert).not.toHaveBeenCalled();
});
it("public clients cannot write even with a forged scope", async () => {
  prismaMock.tzIdClient.findFirst.mockResolvedValue({
    id: "c1",
    metadata: encryptTzData({
      redirect_uris: ["https://app.example/callback"],
      scope: token.scope,
      token_endpoint_auth_method: "none",
    }),
  } as never);
  expect((await call("subscriptions", "PUT", {})).status).toBe(403);
});
it("subscription upsert derives user and project from token", async () => {
  prismaMock.tzIdProjectSubscription.upsert.mockResolvedValue({
    id: "s",
    updatedAt: new Date(),
  } as never);
  expect(
    (
      await call("subscriptions", "PUT", {
        externalId: "e",
        title: "Plan",
        status: "active",
      })
    ).status,
  ).toBe(200);
  expect(prismaMock.tzIdProjectSubscription.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        clientId_userId_externalId: {
          clientId: "c1",
          userId: "u1",
          externalId: "e",
        },
      },
    }),
  );
  expect(prismaMock.user.update).not.toHaveBeenCalled();
});
it("muted notifications are not persisted", async () => {
  prismaMock.tzIdNotificationPreference.findUnique.mockResolvedValue({
    enabled: false,
  } as never);
  expect(
    await call("notifications", "POST", {
      externalId: "n",
      title: "Title",
      body: "Body",
    }),
  ).toEqual({
    status: 200,
    body: { accepted: false, reason: "notifications_disabled" },
  });
  expect(prismaMock.tzIdProjectNotification.upsert).not.toHaveBeenCalled();
});
it("duplicate notification preserves first content and read state", async () => {
  prismaMock.tzIdProjectNotification.findUnique.mockResolvedValue({
    id: "n",
  } as never);
  expect(
    (
      await call("notifications", "POST", {
        externalId: "n",
        title: "Title",
        body: "Body",
      })
    ).body,
  ).toEqual({ accepted: true, id: "n", duplicate: true });
  expect(prismaMock.tzIdProjectNotification.upsert).not.toHaveBeenCalled();
});
it("rejects arbitrary foreign notification URLs", async () => {
  expect(
    (
      await call("notifications", "POST", {
        externalId: "n",
        title: "Title",
        body: "Body",
        url: "https://evil.example/",
      })
    ).status,
  ).toBe(400);
});
it("rejects malformed subscription request without DB changes", async () => {
  expect(
    (
      await call("subscriptions", "PUT", {
        externalId: "e",
        title: "Plan",
        status: "ADMIN",
      })
    ).status,
  ).toBe(400);
  expect(prismaMock.tzIdProjectSubscription.upsert).not.toHaveBeenCalled();
});
