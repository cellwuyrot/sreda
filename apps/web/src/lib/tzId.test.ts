import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptTzData, decryptTzData, storageKey } from "./tzIdCrypto";
import { validateClient } from "./tzIdClients";
import { prismaMock } from "@/test/prismaMock";
import { liveSession, revokeSessions } from "./tzIdSessions";
vi.mock("./prisma", async () => {
  const { prismaMock } = await import("@/test/prismaMock");
  return { default: prismaMock, prisma: prismaMock };
});
vi.mock("./socketEmit", () => ({ getIO: () => null }));
describe("TZ ID crypto", () => {
  beforeEach(() => {
    process.env.TZ_ID_STORAGE_KEY = randomBytes(32).toString("base64");
  });
  it("encrypts and authenticates, fresh nonce on every write", () => {
    const data = { email: "private@example.invalid", secret: "private" };
    const a = encryptTzData(data),
      b = encryptTzData(data);
    expect(a).not.toEqual(b);
    expect(a).not.toContain(data.email);
    expect(decryptTzData(a)).toEqual(data);
  });
  it("rejects changed ciphertext", () => {
    const a = encryptTzData({ sub: "u1" }).split(".");
    const bytes = Buffer.from(a[2], "base64url");
    bytes[0] ^= 1;
    a[2] = bytes.toString("base64url");
    expect(() => decryptTzData(a.join("."))).toThrow();
  });
  it("rejects missing or wrong storage key", () => {
    delete process.env.TZ_ID_STORAGE_KEY;
    expect(() => storageKey()).toThrow();
    process.env.TZ_ID_STORAGE_KEY = "bad";
    expect(() => storageKey()).toThrow();
  });
});
describe("TZ ID clients", () => {
  beforeEach(() => {
    delete process.env.TZ_ID_DEV_ALLOW_HTTP;
  });
  it("allows exact HTTPS callbacks and removes duplicates", () => {
    expect(
      validateClient({
        name: " App ",
        redirectUris: [
          "https://app.example/callback",
          "https://app.example/callback",
        ],
      }),
    ).toEqual({
      name: "App",
      redirectUris: ["https://app.example/callback"],
      publicClient: false,
      offlineAccess: false,
    });
  });
  it.each([
    "http://app.example/callback",
    "javascript:alert(1)",
    "https://app.example/*",
    "https://app.example/callback#fragment",
    "https://user:pass@app.example/callback",
    "https://app.example",
  ])("rejects unsafe / noncanonical callback %s", (url) => {
    expect(() =>
      validateClient({ name: "App", redirectUris: [url] }),
    ).toThrow();
  });
  it("only loopback HTTP permitted in explicit development mode", () => {
    process.env.TZ_ID_DEV_ALLOW_HTTP = "1";
    expect(
      validateClient({
        name: "App",
        redirectUris: ["http://127.0.0.1:3200/callback"],
      }),
    ).toBeTruthy();
    expect(() =>
      validateClient({
        name: "App",
        redirectUris: ["http://evil.example/callback"],
      }),
    ).toThrow();
  });
  it("requires name and callback", () => {
    expect(() => validateClient({ name: "", redirectUris: [] })).toThrow();
    expect(() => validateClient({ name: "App", redirectUris: [] })).toThrow();
  });
});
describe("TZ ID live server sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("legacy JWT without sid fails closed", async () => {
    expect(await liveSession("u1", null)).toBe(false);
    expect(prismaMock.userSession.findFirst).not.toHaveBeenCalled();
  });
  it("checks ownership, active and expiry in the database", async () => {
    prismaMock.userSession.findFirst.mockResolvedValue({
      id: "s1",
      createdAt: new Date(),
      user: { isDeleted: false, banned: false, passwordChangedAt: null },
    } as never);
    expect(await liveSession("u1", "s1")).toBe(true);
    expect(prismaMock.userSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "s1",
          userId: "u1",
          active: true,
        }),
      }),
    );
  });
  it.each([
    { isDeleted: true, banned: false, passwordChangedAt: null },
    {
      isDeleted: false,
      banned: true,
      bannedUntil: null,
      passwordChangedAt: null,
    },
    {
      isDeleted: false,
      banned: false,
      passwordChangedAt: new Date("2030-01-01"),
    },
  ])("denies deleted / banned / password-changed account", async (user) => {
    prismaMock.userSession.findFirst.mockResolvedValue({
      createdAt: new Date("2026-01-01"),
      user,
    } as never);
    expect(await liveSession("u1", "s1")).toBe(false);
  });
  it("missing session denied", async () => {
    prismaMock.userSession.findFirst.mockResolvedValue(null);
    expect(await liveSession("u1", "s1")).toBe(false);
  });
  it("revoke all other sessions preserves only the current owned session", async () => {
    prismaMock.$transaction.mockImplementation(
      async (fn: unknown) =>
        (fn as (db: typeof prismaMock) => Promise<unknown>)(
          prismaMock,
        ) as never,
    );
    await revokeSessions("u1", undefined, "current");
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { not: "current" } },
      data: { active: false },
    });
    expect(prismaMock.tzIdAuthorization.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", sessionId: { not: "current" } },
      }),
    );
  });
});
