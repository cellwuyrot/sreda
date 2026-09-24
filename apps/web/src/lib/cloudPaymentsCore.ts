/** Pure CloudPayments validation/crypto helpers. Kept free of Prisma/Next imports for easy unit testing. */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyCloudPaymentHmac(rawBody: string, secret: string, headerValue: string | null): boolean {
  if (!headerValue || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerValue.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCloudPaymentAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

export function isSuccessfulCloudPaymentStatus(status: unknown): boolean {
  return status === "Completed";
}

export function isSupportedCloudPaymentCurrency(value: string): boolean {
  return ["RUB", "USD", "EUR", "GBP"].includes(value.toUpperCase());
}
