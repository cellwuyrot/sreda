import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isSupportedCloudPaymentCurrency,
  isSuccessfulCloudPaymentStatus,
  parseCloudPaymentAmount,
  verifyCloudPaymentHmac,
} from "@/lib/cloudPaymentsCore";

describe("CloudPayments core helpers", () => {
  it("verifies CloudPayments HMAC from the raw request body", () => {
    const body = JSON.stringify({ InvoiceId: "TRIOZ-1", Amount: 499 });
    const secret = "test-api-secret";
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64");

    expect(verifyCloudPaymentHmac(body, secret, signature)).toBe(true);
    expect(verifyCloudPaymentHmac(body, secret, "invalid")).toBe(false);
    expect(verifyCloudPaymentHmac(`${body}!`, secret, signature)).toBe(false);
  });

  it("accepts only completed payments as successful", () => {
    expect(isSuccessfulCloudPaymentStatus("Completed")).toBe(true);
    expect(isSuccessfulCloudPaymentStatus("Authorized")).toBe(false);
    expect(isSuccessfulCloudPaymentStatus("Declined")).toBe(false);
    expect(isSuccessfulCloudPaymentStatus(undefined)).toBe(false);
  });

  it("normalizes monetary values to two decimals", () => {
    expect(parseCloudPaymentAmount(499)).toBe(499);
    expect(parseCloudPaymentAmount("499.995")).toBe(500);
    expect(parseCloudPaymentAmount("not-a-number")).toBeNull();
  });

  it("accepts only currencies supported by the CloudPayments orders API", () => {
    expect(isSupportedCloudPaymentCurrency("RUB")).toBe(true);
    expect(isSupportedCloudPaymentCurrency("usd")).toBe(true);
    expect(isSupportedCloudPaymentCurrency("KZT")).toBe(false);
  });
});
