import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const order = {
  id: "order-1",
  invoiceId: "TRIOZ-PREMIUM-user-1-abc",
  userId: "user-1",
  kind: "PREMIUM",
  amount: 499,
  currency: "RUB",
  status: "PENDING",
  createdAt: new Date("2026-09-24T00:00:00.000Z"),
  cloudSubscriptionId: "sub-123",
};

const findUnique = vi.fn();
const findFirst = vi.fn();
const applyCloudPayment = vi.fn();
const readCloudPaymentConfig = vi.fn();
const verifyCloudPaymentHmac = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    cloudPaymentOrder: {
      findUnique,
      findFirst,
    },
  },
}));

vi.mock("@/lib/cloudPayments", () => ({
  applyCloudPayment,
  markCloudPaymentFailed: vi.fn(),
  readCloudPaymentConfig,
  updateCloudPaymentRecurrentStatus: vi.fn(),
  verifyCloudPaymentHmac,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

import { processPayPayload, rawCloudWebhook } from "@/app/api/webhooks/cloudpayments/_utils";

describe("CloudPayments webhook helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCloudPaymentConfig.mockResolvedValue({ apiSecret: "secret" });
    verifyCloudPaymentHmac.mockReturnValue(true);
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(order);
    applyCloudPayment.mockResolvedValue({ ok: true, alreadyProcessed: false, userId: order.userId, kind: "PREMIUM" });
  });

  it("resolves recurring Pay by SubscriptionId when InvoiceId is absent", async () => {
    const payload = {
      SubscriptionId: "sub-123",
      AccountId: "user-1",
      Amount: 499,
      Currency: "RUB",
      TransactionId: 12345,
      Status: "Completed",
    };
    const result = await processPayPayload(payload);

    expect(result).toEqual({ code: 0 });
    expect(applyCloudPayment).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: order.invoiceId,
      transactionId: "12345",
      cloudSubscriptionId: "sub-123",
    }));
  });

  it("verifies webhook authenticity before returning the order", async () => {
    const raw = JSON.stringify({ InvoiceId: order.invoiceId });
    const signature = createHmac("sha256", "secret").update(raw, "utf8").digest("base64");
    verifyCloudPaymentHmac.mockImplementation((body: string, secret: string, header: string | null) => {
      return body === raw && secret === "secret" && header === signature;
    });

    const request = new Request("https://example.test/api/webhooks/cloudpayments/pay", {
      method: "POST",
      headers: { "X-Content-HMAC": signature },
      body: raw,
    });

    const result = await rawCloudWebhook(request);
    expect(result.order).toEqual(order);
    expect(result.error).toBeNull();
  });
});
