import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  applyCloudPayment,
  markCloudPaymentFailed,
  readCloudPaymentConfig,
  updateCloudPaymentRecurrentStatus,
  verifyCloudPaymentHmac,
} from "@/lib/cloudPayments";

export async function rawCloudWebhook(req: Request) {
  const raw = await req.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw, payload: null, error: NextResponse.json({ code: 13 }, { status: 400 }) };
  }

  const invoiceId = typeof payload.InvoiceId === "string" ? payload.InvoiceId : null;
  const subscriptionId = typeof payload.SubscriptionId === "string" ? payload.SubscriptionId : null;

  let order =
    invoiceId
      ? await prisma.cloudPaymentOrder.findUnique({ where: { invoiceId } })
      : null;

  if (!order && subscriptionId) {
    order = await prisma.cloudPaymentOrder.findFirst({
      where: { cloudSubscriptionId: subscriptionId },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!order) {
    /* Не наш заказ: сообщаем CloudPayments, что обработка не требуется. */
    return { raw, payload, error: NextResponse.json({ code: 0 }) };
  }

  const kind = order.kind === "VPN" ? "VPN" : "PREMIUM";
  const config = await readCloudPaymentConfig(kind);
  const signature =
    req.headers.get("X-Content-HMAC") ||
    req.headers.get("Content-HMAC");

  if (!verifyCloudPaymentHmac(raw, config.apiSecret, signature)) {
    return {
      raw,
      payload,
      error: NextResponse.json({ code: 13 }, { status: 401 }),
    };
  }

  return { raw, payload, order, kind, error: null };
}

export async function ok() {
  return NextResponse.json({ code: 0 });
}

export async function processPayPayload(payload: Record<string, unknown>) {
  const invoiceId = typeof payload.InvoiceId === "string" ? payload.InvoiceId : "";
  const accountId = typeof payload.AccountId === "string" ? payload.AccountId : "";
  const transactionId = typeof payload.TransactionId === "number" ? String(payload.TransactionId) : "";
  const amount = typeof payload.Amount === "number" ? payload.Amount : Number(payload.Amount);
  const currency = typeof payload.Currency === "string" ? payload.Currency : "";
  const status = typeof payload.Status === "string" ? payload.Status : "";
  const subscriptionId =
    typeof payload.SubscriptionId === "string" ? payload.SubscriptionId : null;

  let order = invoiceId
    ? await prisma.cloudPaymentOrder.findUnique({ where: { invoiceId } })
    : null;

  if (!order && subscriptionId) {
    order = await prisma.cloudPaymentOrder.findFirst({
      where: { cloudSubscriptionId: subscriptionId },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!order) return { code: 0, ignored: true };
  if (accountId !== order.userId) return { code: 11 };

  const expectedAmount = Number(order.amount);
  if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.01) return { code: 12 };
  if (currency.toUpperCase() !== order.currency.toUpperCase()) return { code: 12 };
  if (!transactionId) return { code: 13 };

  try {
    await applyCloudPayment({
      invoiceId: order.invoiceId,
      amount,
      currency,
      transactionId,
      cloudSubscriptionId: subscriptionId,
      status,
    });
    return { code: 0 };
  } catch (error) {
    console.error("[cloudpayments] pay webhook processing failed:", error);
    return { code: 13 };
  }
}

export async function processFailPayload(payload: Record<string, unknown>) {
  const invoiceId = typeof payload.InvoiceId === "string" ? payload.InvoiceId : "";
  const subscriptionId = typeof payload.SubscriptionId === "string" ? payload.SubscriptionId : "";
  const reason = typeof payload.Reason === "string" ? payload.Reason : null;

  if (invoiceId) {
    await markCloudPaymentFailed(invoiceId, reason);
  } else if (subscriptionId) {
    const order = await prisma.cloudPaymentOrder.findFirst({
      where: { cloudSubscriptionId: subscriptionId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (order) await markCloudPaymentFailed(order.invoiceId, reason);
  }
  return { code: 0 };
}

export async function processRecurrentPayload(payload: Record<string, unknown>) {
  const subscriptionId = typeof payload.Id === "string"
    ? payload.Id
    : typeof payload.SubscriptionId === "string"
      ? payload.SubscriptionId
      : "";
  const status = typeof payload.Status === "string" ? payload.Status : null;
  if (subscriptionId) await updateCloudPaymentRecurrentStatus(subscriptionId, status);
  return { code: 0 };
}
