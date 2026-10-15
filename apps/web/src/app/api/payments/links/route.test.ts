import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/test/prismaMock";
import { getServerSession } from "next-auth";
import { activatePaymentLink, reportPaymentLinkPaid } from "@/lib/paymentLinks";
import { POST } from "./route";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/paymentSettings", () => ({ readPaymentConfig: vi.fn(async () => ({ paylink_auto_activate: "1" })), readPublicPaymentMethods: vi.fn(), readVpnPaymentMethods: vi.fn() }));
vi.mock("@/lib/paymentLinks", () => ({ PAYMENT_LINK_KIND_LABELS: { PREMIUM: "Premium" }, PAYMENT_LINK_PLAN_LABELS: {}, activatePaymentLink: vi.fn(), reportPaymentLinkPaid: vi.fn(), findActiveReservation: vi.fn(), isPaymentLinkKind: vi.fn(), isPaymentLinkPlan: vi.fn(), releaseExpiredReservations: vi.fn(), reservePaymentLink: vi.fn(), reserveMinutesFrom: vi.fn() }));
beforeEach(() => {
 vi.clearAllMocks(); vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", role: "USER", name: "User" } } as never);
 prismaMock.user.findMany.mockResolvedValue([]);
 vi.mocked(reportPaymentLinkPaid).mockResolvedValue({ ok: true, offer: { kind: "PREMIUM", planLabel: "Месяц", amount: 299, currency: "RUB" } } as never);
});
it("self-reported payment is awaiting manual reconciliation even if legacy auto activation was enabled", async () => {
 const res = await POST(new NextRequest("https://trioz.ru/api/payments/links", { method: "POST", body: JSON.stringify({ action: "paid", linkId: "link1" }) }));
 expect(res.status).toBe(200); expect((await res.json()).status).toBe("awaiting");
 expect(activatePaymentLink).not.toHaveBeenCalled(); expect(prismaMock.user.update).not.toHaveBeenCalled();
 expect(prismaMock.premiumSubscription.create).not.toHaveBeenCalled();
});
