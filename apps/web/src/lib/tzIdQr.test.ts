import { beforeEach, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
import {
  startQr,
  qrHash,
  qrSecret,
  qrForApproval,
  approveQr,
  consumeQr,
  qrStatus,
} from "./tzIdQr";
import { liveSession } from "./tzIdSessions";
vi.mock("./prisma", async () => {
  const { prismaMock } = await import("@/test/prismaMock");
  return { default: prismaMock, prisma: prismaMock };
});
vi.mock("./tzIdSessions", () => ({ liveSession: vi.fn() }));
const live = vi.mocked(liveSession);
const row = () => ({
  id: "qr1",
  clientId: "client",
  verificationCode: "123456",
  expiresAt: new Date(Date.now() + 60000),
  consumedAt: null,
  approvedUserId: "u",
  approvedSessionId: "sid",
});
beforeEach(() => {
  vi.clearAllMocks();
  live.mockResolvedValue(true);
  prismaMock.$transaction.mockImplementation(
    async (fn: unknown) =>
      (fn as (db: unknown) => unknown)(prismaMock) as never,
  );
  prismaMock.tzIdClient.findFirst.mockResolvedValue({ id: "client" } as never);
});
it("generates 256-bit secrets and stores only hashes", async () => {
  prismaMock.tzIdQrLogin.create.mockImplementation(
    async (args) => ({ id: "qr1", ...args.data }) as never,
  );
  const browser = qrSecret();
  const qr = await startQr("interaction", "client", browser);
  const data = prismaMock.tzIdQrLogin.create.mock.calls[0][0].data;
  expect(data.browserHash).toBe(qrHash(browser));
  expect(data.approvalHash).toBe(qrHash(qr.approval));
  expect(JSON.stringify(data)).not.toContain(qr.approval);
  expect(JSON.stringify(data)).not.toContain(browser);
  expect(qr.verificationCode).toMatch(/^\d{6}$/);
  expect(qr.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120000);
});
it("rejects malformed approval before querying DB", async () => {
  await expect(qrForApproval("bad")).rejects.toThrow();
  expect(prismaMock.tzIdQrLogin.findUnique).not.toHaveBeenCalled();
});
it("rejects expired approval", async () => {
  prismaMock.tzIdQrLogin.findUnique.mockResolvedValue({
    ...row(),
    expiresAt: new Date(0),
  } as never);
  await expect(qrForApproval(qrSecret())).rejects.toThrow();
});
it("rejects approval from revoked phone session", async () => {
  live.mockResolvedValue(false);
  await expect(approveQr(qrSecret(), "u", "sid", "123456")).rejects.toThrow();
  expect(prismaMock.tzIdQrLogin.updateMany).not.toHaveBeenCalled();
});
it("requires matching verification code", async () => {
  prismaMock.tzIdQrLogin.findUnique.mockResolvedValue({
    ...row(),
    approvedUserId: null,
  } as never);
  await expect(approveQr(qrSecret(), "u", "sid", "654321")).rejects.toThrow(
    "не совпадают",
  );
});
it("does not grant a login merely by scanning", async () => {
  prismaMock.tzIdQrLogin.findUnique.mockResolvedValue(row() as never);
  await qrForApproval(qrSecret());
  expect(prismaMock.tzIdQrLogin.updateMany).not.toHaveBeenCalled();
});
it("binds polling to browser and interaction", async () => {
  prismaMock.tzIdQrLogin.findFirst.mockResolvedValue(null);
  expect(await qrStatus("qr1", "interaction", "wrong")).toEqual({
    state: "expired",
  });
  expect(prismaMock.tzIdQrLogin.findFirst).toHaveBeenCalledWith({
    where: {
      id: "qr1",
      interactionUid: "interaction",
      browserHash: qrHash("wrong"),
    },
  });
});
it("rejects unapproved QR consumption", async () => {
  prismaMock.tzIdQrLogin.findFirst.mockResolvedValue({
    ...row(),
    approvedUserId: null,
  } as never);
  await expect(consumeQr("qr1", "interaction", "browser")).rejects.toThrow();
});
it("checks phone session again when consuming", async () => {
  prismaMock.tzIdQrLogin.findFirst.mockResolvedValue(row() as never);
  live.mockResolvedValue(false);
  await expect(consumeQr("qr1", "interaction", "browser")).rejects.toThrow();
  expect(prismaMock.tzIdQrLogin.updateMany).not.toHaveBeenCalled();
});
it("consumes approval atomically and rejects replay", async () => {
  prismaMock.tzIdQrLogin.findFirst.mockResolvedValue(row() as never);
  prismaMock.tzIdQrLogin.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 });
  expect(await consumeQr("qr1", "interaction", "browser")).toBe("u");
  await expect(consumeQr("qr1", "interaction", "browser")).rejects.toThrow(
    "уже использован",
  );
});
