import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
import {
  contactAddress,
  projectSubscription,
  projectUrl,
  identityPatch,
  updateHub,
} from "./tzIdHub";
import { validateClient } from "./tzIdClients";
vi.mock("./prisma", async () => {
  const { prismaMock } = await import("@/test/prismaMock");
  return { default: prismaMock, prisma: prismaMock };
});
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TZ_ID_DEV_ALLOW_HTTP;
});
describe("TZ ID contact and delegated data", () => {
  it.each(["", null])("allows absent contact %s", (value) =>
    expect(contactAddress(value)).toBeNull(),
  );
  it("trims optional contact", () =>
    expect(contactAddress("  Город, улица  ")).toBe("Город, улица"));
  it.each([123, {}, "x".repeat(501), "x\u0000y"])(
    "rejects invalid contact",
    (value) => expect(() => contactAddress(value)).toThrow(),
  );
  it.each([
    "javascript:alert(1)",
    "https://evil.example/",
    "https://u:p@app.example/a",
    "http://app.example/a",
  ])("rejects untrusted notification link %s", (value) =>
    expect(() => projectUrl(value, ["https://app.example"])).toThrow(),
  );
  it("accepts only registered project origin", () =>
    expect(
      projectUrl("https://app.example/news?a=1", ["https://app.example"]),
    ).toBe("https://app.example/news?a=1"));
  it("accepts notifications without a link", () =>
    expect(projectUrl(null, [])).toBeNull());
  it("validates external subscriptions without granting local Premium", () =>
    expect(
      projectSubscription({
        externalId: "order-1",
        title: "Plan",
        status: "active",
        expiresAt: null,
      }),
    ).toEqual({
      externalId: "order-1",
      title: "Plan",
      status: "active",
      expiresAt: null,
    }));
  it.each(["bad", "2026-99-99T00:00:00Z", 123])(
    "rejects invalid subscription expiry",
    (value) =>
      expect(() =>
        projectSubscription({
          externalId: "a",
          title: "b",
          status: "active",
          expiresAt: value,
        }),
      ).toThrow(),
  );
  it("rejects unknown status", () =>
    expect(() =>
      projectSubscription({ externalId: "a", title: "b", status: "admin" }),
    ).toThrow());
  it("rejects unknown client API scopes", () =>
    expect(() =>
      validateClient({
        name: "A",
        redirectUris: ["https://app.example/cb"],
        apiScopes: ["admin"],
      }),
    ).toThrow());
  it.each(["notifications:write", "subscriptions:write"])(
    "rejects write scope on public client",
    (scope) =>
      expect(() =>
        validateClient({
          name: "A",
          redirectUris: ["https://app.example/cb"],
          publicClient: true,
          apiScopes: [scope],
        }),
      ).toThrow(),
  );
  it("accepts scoped confidential client", () =>
    expect(
      validateClient({
        name: "A",
        redirectUris: ["https://app.example/cb"],
        apiScopes: ["contact:read", "subscriptions:write"],
      }).apiScopes,
    ).toEqual(["contact:read", "subscriptions:write"]));
  it("profile patch ignores user/role/entitlement injection", async () =>
    expect(
      await identityPatch("u", {
        name: " Name ",
        contactAddress: "",
        role: "ADMIN",
        isPremium: true,
        userId: "other",
      }),
    ).toEqual({ name: "Name", contactAddress: null }));
  it("read action is scoped to current user", async () => {
    prismaMock.tzIdProjectNotification.updateMany.mockResolvedValue({
      count: 0,
    });
    await updateHub("u", { action: "read", id: "other-notice" });
    expect(prismaMock.tzIdProjectNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "other-notice", userId: "u", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
  it("rejects preference changes for unconnected project", async () => {
    prismaMock.tzIdAuthorization.findFirst.mockResolvedValue(null);
    await expect(
      updateHub("u", {
        action: "notifications",
        clientId: "other",
        enabled: false,
      }),
    ).rejects.toThrow("Проект не подключён");
    expect(prismaMock.tzIdNotificationPreference.upsert).not.toHaveBeenCalled();
  });
});
it("TrioZ notification read state is scoped to current user", async () => {
  prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
  await updateHub("u", { action: "read", id: "trioz:notice1" });
  expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
    where: { id: "notice1", userId: "u", read: false },
    data: { read: true },
  });
  expect(prismaMock.tzIdProjectNotification.updateMany).not.toHaveBeenCalled();
});
