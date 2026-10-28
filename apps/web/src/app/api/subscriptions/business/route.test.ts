import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
import { beforeEach, it, expect, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn() }));
vi.mock("@/lib/businessSubscriptionCatalog", () => ({ businessSubscriptionOffers: vi.fn() }));
import { getServerSession } from "next-auth";
import { checkBan } from "@/lib/banCheck";
import { businessSubscriptionOffers } from "@/lib/businessSubscriptionCatalog";
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); prismaMock.tzManagedConnection.findMany.mockResolvedValue([]); vi.mocked(getServerSession).mockResolvedValue({ user: { id: "customer" } } as never); vi.mocked(checkBan).mockResolvedValue(null); vi.mocked(businessSubscriptionOffers).mockResolvedValue({ VPN: null, PREMIUM: null }); });
it("requires authentication before reading available subscriptions", async () => { vi.mocked(getServerSession).mockResolvedValue(null); expect((await GET()).status).toBe(401); expect(businessSubscriptionOffers).not.toHaveBeenCalled(); });
it("does not expose checkout to a banned account", async () => { vi.mocked(checkBan).mockResolvedValue(new Response() as never); expect((await GET()).status).toBe(403); expect(businessSubscriptionOffers).not.toHaveBeenCalled(); });
it("returns no-store availability without any private metadata", async () => { const res = await GET(); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toContain("no-store"); expect(await res.json()).toEqual({ offers: { VPN: null, PREMIUM: null }, provisional: {} }); });
it("does not mistake a database outage for an unconfigured subscription", async () => { vi.mocked(businessSubscriptionOffers).mockRejectedValue(Error("synthetic-private database")); const res = await GET(); expect(res.status).toBe(503); expect(await res.text()).not.toContain("synthetic-private"); });

it("returns only the authenticated customer provisional expiry, not a paid claim", async () => { prismaMock.tzManagedConnection.findMany.mockResolvedValue([{ accessKind: "VPN", paidUntil: new Date("2099-01-01") }] as never); const data = await (await GET()).json(); expect(data.provisional.VPN).toBe("2099-01-01T00:00:00.000Z"); expect(prismaMock.tzManagedConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "customer", accessSource: "TRUST" }) })); });
