import { beforeEach, expect, it, vi } from "vitest";
import { prismaMock as db, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {}, invalidateUserAuthCache: vi.fn() }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
import { getServerSession } from "next-auth";
import { POST } from "./route";
const requestId = "12345678-1234-1234-1234-123456789abc";
const call = (extra = {}, origin = "https://trioz.ru") => POST(new Request("https://trioz.ru/api/admin/access-grants", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ action: "grant", kind: "VPN", userId: "customer", months: 1, reason: "Ручное назначение поддержки", requestId, ...extra }) }));
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://trioz.ru");
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN", username: "admin" } } as never);
  db.$transaction.mockImplementation(row(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)));
  db.user.findFirst.mockResolvedValue(row({ id: "customer", role: "USER", isPremium: false, vpnAccess: false }));
  for (const model of [db.vpnSubscription, db.premiumSubscription]) { model.findUnique.mockResolvedValue(null); model.findFirst.mockResolvedValue(null); model.findMany.mockResolvedValue([{ expiresAt: new Date(Date.now() + 86400000) }] as never); }
});
it.each([null, { user: { role: "EDITOR" } }, { user: { role: "USER" } }])("requires global main-project admin, not client-controlled role", async session => {
  vi.mocked(getServerSession).mockResolvedValue(session as never); expect((await call()).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
});
it("requires same-origin browser mutation", async () => { expect((await call({}, "https://attacker.invalid")).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled(); });
it.each([2, -1, 100, "1"])("rejects invalid duration %s", async months => { expect((await call({ months })).status).toBe(409); expect(db.$transaction).not.toHaveBeenCalled(); });
it("requires an auditable reason", async () => { expect((await call({ reason: "" })).status).toBe(409); });
it.each(["VPN", "PREMIUM"])("creates a zero-amount %s manual entitlement and an audit entry, without a payment", async kind => {
  expect((await call({ kind })).status).toBe(200);
  const model = kind === "VPN" ? db.vpnSubscription : db.premiumSubscription;
  expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentMethod: "manual-admin", amount: 0, grantedById: "admin", note: "Ручное назначение поддержки", userId: "customer" }) }));
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "subscription.manual.grant" }) }));
  expect(db.user.update.mock.calls[0][0]?.data).not.toHaveProperty("role");
});
it("replaying the same grant does not extend access twice", async () => {
  db.vpnSubscription.findUnique.mockResolvedValue(row({ userId: "customer", paymentMethod: "manual-admin" })); const res = await call();
  expect(await res.json()).toMatchObject({ ok: true, reused: true }); expect(db.vpnSubscription.create).not.toHaveBeenCalled();
});
it("does not revoke managed bank entitlements through the manual endpoint", async () => { expect((await call({ action: "revoke", id: "managed-connection" })).status).toBe(409); expect(db.vpnSubscription.update).not.toHaveBeenCalled(); });
it("cannot revoke another customer's grant", async () => {
  db.vpnSubscription.findUnique.mockResolvedValue(row({ userId: "other", paymentMethod: "manual-admin" }));
  expect((await call({ action: "revoke", id: `admin-grant-${requestId}` })).status).toBe(409); expect(db.vpnSubscription.update).not.toHaveBeenCalled();
});
it("revoking one manual grant preserves a separate paid or unlimited right", async () => {
  db.vpnSubscription.findUnique.mockResolvedValue(row({ userId: "customer", paymentMethod: "manual-admin" }));
  db.vpnSubscription.findMany.mockResolvedValue([{ expiresAt: null }] as never);
  expect((await call({ action: "revoke", id: `admin-grant-${requestId}` })).status).toBe(200);
  expect(db.user.update).toHaveBeenCalledWith({ where: { id: "customer" }, data: { vpnAccess: true, vpnAccessUntil: null } });
});
it("does not preserve a stale expired ledger flag as a new lifetime right", async () => {
  db.user.findFirst.mockResolvedValue(row({ id: "customer", vpnAccess: true, vpnAccessUntil: null }));
  db.vpnSubscription.findMany.mockResolvedValue([]); db.vpnSubscription.findFirst.mockResolvedValue(row({ id: "expired-ledger" }));
  await call(); expect(db.vpnSubscription.create).toHaveBeenCalledTimes(1); expect(db.vpnSubscription.create.mock.calls[0][0]?.data.id).toBe(`admin-grant-${requestId}`);
});
