import { beforeEach, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
const call = (q = "") => GET(new Request(`https://trioz.ru/api/admin/user-subscriptions${q}`));
beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN" } } as never);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.user.findMany.mockResolvedValue(row([{ id: "user-1", name: "User", username: "user", isPremium: false, vpnAccess: true, vpnAccessUntil: new Date("2099-01-01") }]));
  prismaMock.tzManagedConnection.findMany.mockResolvedValue(row([{ id: "connection-1", userId: "user-1", title: "Надёжное соединение", accessKind: "VPN", status: "ACTIVE", paidUntil: new Date("2099-01-01"), manualState: "NONE" }]));
});
it.each([null, { user: { role: "USER" } }])("rejects unauthorized reads before database access", async session => {
  vi.mocked(getServerSession).mockResolvedValue(session as never);
  expect((await call()).status).toBe(403); expect(prismaMock.user.count).not.toHaveBeenCalled();
});
it("reads central service connections in one batch and returns no-store data", async () => {
  const res = await call(); const data = await res.json();
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(data.users[0].connections[0]).toMatchObject({ title: "Надёжное соединение", accessKind: "VPN", status: "ACTIVE" });
  expect(prismaMock.tzManagedConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["user-1"] } } }));
  expect(prismaMock.user.update).not.toHaveBeenCalled(); expect(prismaMock.tzManagedConnection.update).not.toHaveBeenCalled();
  const select = prismaMock.tzManagedConnection.findMany.mock.calls[0][0]?.select;
  expect(select).not.toHaveProperty("externalId"); expect(select).not.toHaveProperty("clientId");
});
it("does not display an elapsed connection as active while expiry worker is pending", async () => {
  prismaMock.tzManagedConnection.findMany.mockResolvedValue(row([{ id: "old", userId: "user-1", status: "ACTIVE", paidUntil: new Date("2020-01-01") }]));
  expect((await (await call()).json()).users[0].connections[0].status).toBe("EXPIRED");
});
it("does not search or expose email for editors", async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { role: "EDITOR" } } as never); await call("?q=mail");
  const args = prismaMock.user.findMany.mock.calls[0][0]!;
  expect(JSON.stringify(args.where)).not.toContain("email"); expect(args.select).not.toHaveProperty("email");
});
it("limits pagination and excludes deleted users", async () => {
  await call("?page=999&perPage=100000");
  expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, skip: 0, where: { isDeleted: false } }));
});
it("distinguishes a database outage from no subscriptions without leaking details", async () => {
  prismaMock.user.count.mockRejectedValue(Error("secret database-url")); const res = await call();
  expect(res.status).toBe(503); expect(await res.text()).not.toContain("secret");
});
it("marks connection truncation explicitly instead of silently losing history", async () => {
  prismaMock.tzManagedConnection.findMany.mockResolvedValue(row(Array.from({ length: 1001 }, (_, i) => ({ id: String(i), userId: "user-1", status: "ACTIVE", paidUntil: new Date("2099-01-01") }))));
  const data = await (await call()).json(); expect(data.truncated).toBe(true); expect(data.users[0].connections).toHaveLength(1000);
});
it("does not query service connections for an empty result", async () => {
  prismaMock.user.findMany.mockResolvedValue([]); const data = await (await call()).json();
  expect(data.users).toEqual([]); expect(prismaMock.tzManagedConnection.findMany).not.toHaveBeenCalled();
});
