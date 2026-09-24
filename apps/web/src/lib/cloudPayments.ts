/**
 * CLOUDPAYMENTS: серверная интеграция интернет-эквайринга для Premium и
 * «Ускоренного интернета».
 *
 * API Secret никогда не покидает сервер. Публичный клиент получает только
 * признак включения, цену и статус заказа.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { invalidateUserAuthCache } from "@/lib/auth";
import { emitToUser } from "@/lib/socketEmit";
import {
  readPaymentConfig,
  type PaymentKey,
} from "@/lib/paymentSettings";
import { vpnPlanExpiry, type VpnPlan } from "@/lib/vpnPlan";
import {
  isSupportedCloudPaymentCurrency,
  isSuccessfulCloudPaymentStatus,
  parseCloudPaymentAmount,
  verifyCloudPaymentHmac,
} from "@/lib/cloudPaymentsCore";

export type CloudPaymentKind = "PREMIUM" | "VPN";
export type CloudPaymentPlan = "month";

export interface CloudPaymentConfig {
  enabled: boolean;
  publicId: string;
  apiSecret: string;
  price: number;
  currency: string;
}

export interface CloudPaymentPublicConfig {
  enabled: boolean;
  price: number | null;
  currency: string;
  plan: CloudPaymentPlan;
  recurring: boolean;
}

export interface CloudPaymentOrderSummary {
  invoiceId: string;
  status: "PENDING" | "PAID" | "FAILED";
  paymentUrl: string | null;
  amount: number;
  currency: string;
  plan: CloudPaymentPlan;
  paidAt: string | null;
  failureReason: string | null;
}

const CLOUD_API = "https://api.cloudpayments.ru";

function configKeys(kind: CloudPaymentKind): {
  enabled: PaymentKey;
  provider: PaymentKey;
  publicId: PaymentKey;
  secret: PaymentKey;
  price: PaymentKey;
  currency: PaymentKey;
} {
  if (kind === "VPN") {
    return {
      enabled: "vpnpay_acquiring_enabled",
      provider: "vpnpay_acquiring_provider",
      publicId: "vpnpay_cloudpayments_public_id",
      secret: "vpnpay_acquiring_secret",
      price: "vpn_price_month",
      currency: "vpn_currency",
    };
  }
  return {
    enabled: "pay_acquiring_enabled",
    provider: "pay_acquiring_provider",
    publicId: "pay_cloudpayments_public_id",
    secret: "pay_acquiring_secret",
    price: "premium_price_month",
    currency: "premium_currency",
  };
}

export async function readCloudPaymentConfig(kind: CloudPaymentKind): Promise<CloudPaymentConfig> {
  const config = await readPaymentConfig();
  const keys = configKeys(kind);
  const publicId = config[keys.publicId].trim();
  const apiSecret = config[keys.secret].trim();
  const price = Number.parseInt(config[keys.price], 10);
  const currency = (config[keys.currency] || "RUB").trim().toUpperCase();

  return {
    enabled:
      config[keys.enabled] === "1" &&
      config[keys.provider].trim().toLowerCase() === "cloudpayments" &&
      publicId.length > 0 &&
      apiSecret.length > 0 &&
      Number.isFinite(price) &&
      price > 0,
    publicId,
    apiSecret,
    price: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0,
    currency,
  };
}

export async function readCloudPaymentPublicConfig(kind: CloudPaymentKind): Promise<CloudPaymentPublicConfig> {
  const config = await readCloudPaymentConfig(kind);
  return {
    enabled: config.enabled,
    price: config.price > 0 ? config.price : null,
    currency: config.currency,
    plan: "month",
    recurring: true,
  };
}

function basicAuth(publicId: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${publicId}:${apiSecret}`, "utf8").toString("base64")}`;
}

function normalizeOrderStatus(value: unknown): "PENDING" | "PAID" | "FAILED" {
  if (value === "PAID") return "PAID";
  if (value === "FAILED") return "FAILED";
  return "PENDING";
}

function makeInvoiceId(kind: CloudPaymentKind, userId: string): string {
  const prefix = kind === "VPN" ? "VPN" : "PREMIUM";
  return `TRIOZ-${prefix}-${userId}-${randomUUID().replace(/-/g, "").slice(0, 20)}`.slice(0, 80);
}

function appUrl(): string {
  const raw = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL || "https://trioz.ru";
  return raw.replace(/\/+$/, "");
}

function redirectUrl(kind: CloudPaymentKind, invoiceId: string, ok: boolean): string {
  const params = new URLSearchParams({
    payment: "cloudpayments",
    order: invoiceId,
    kind,
    result: ok ? "success" : "failed",
  });
  return `${appUrl()}/settings?${params.toString()}`;
}

async function cloudRequest<T>(
  config: CloudPaymentConfig,
  path: string,
  body: Record<string, unknown>,
  requestId?: string,
): Promise<T> {
  const response = await fetch(`${CLOUD_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config.publicId, config.apiSecret),
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as
    | { Success?: boolean; Message?: string | null; Model?: T }
    | null;

  if (!response.ok || !json?.Success || !json.Model) {
    throw new Error(json?.Message || `CloudPayments API HTTP ${response.status}`);
  }
  return json.Model;
}

export async function createOrReuseCloudPaymentOrder(args: {
  userId: string;
  email: string;
  kind: CloudPaymentKind;
  origin?: string;
}): Promise<CloudPaymentOrderSummary> {
  const config = await readCloudPaymentConfig(args.kind);
  if (!config.enabled) {
    throw new Error("CloudPayments для этой подписки не настроен.");
  }
  if (!isSupportedCloudPaymentCurrency(config.currency)) {
    throw new Error(`CloudPayments не поддерживает валюту ${config.currency}.`);
  }

  const plan: CloudPaymentPlan = "month";
  const existing = await prisma.cloudPaymentOrder.findFirst({
    where: {
      userId: args.userId,
      kind: args.kind,
      plan,
      status: "PENDING",
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });

  let order = existing;
  if (!order) {
    const invoiceId = makeInvoiceId(args.kind, args.userId);
    order = await prisma.cloudPaymentOrder.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        plan,
        amount: config.price,
        currency: config.currency,
        invoiceId,
        status: "PENDING",
      },
    });
  }

  if (order.paymentUrl && order.cloudOrderId) {
    return {
      invoiceId: order.invoiceId,
      status: normalizeOrderStatus(order.status),
      paymentUrl: order.paymentUrl,
      amount: order.amount,
      currency: order.currency,
      plan: "month",
      paidAt: order.paidAt?.toISOString() ?? null,
      failureReason: order.failureReason,
    };
  }

  const returnOrigin = args.origin || appUrl();
  const success = `${returnOrigin.replace(/\/+$/, "")}/settings?${new URLSearchParams({
    payment: "cloudpayments",
    order: order.invoiceId,
    kind: args.kind,
    result: "success",
  }).toString()}`;
  const fail = `${returnOrigin.replace(/\/+$/, "")}/settings?${new URLSearchParams({
    payment: "cloudpayments",
    order: order.invoiceId,
    kind: args.kind,
    result: "failed",
  }).toString()}`;

  try {
    const model = await cloudRequest<{
      Id?: string;
      Number?: number;
      Url?: string;
      Amount?: number;
      Currency?: string;
    }>(
      config,
      "/orders/create",
      {
        Amount: order.amount,
        Currency: order.currency,
        Description: args.kind === "VPN" ? "Подписка «Ускоренный интернет»" : "Подписка Premium",
        Email: args.email,
        AccountId: args.userId,
        InvoiceId: order.invoiceId,
        RequireConfirmation: false,
        SubscriptionBehavior: "CreateMonthly",
        SuccessRedirectUrl: success,
        FailRedirectUrl: fail,
        JsonData: {
          trioz: {
            kind: args.kind,
            plan: order.plan,
            userId: args.userId,
          },
        },
      },
      order.invoiceId,
    );

    const paymentUrl = typeof model.Url === "string" ? model.Url : "";
    if (!paymentUrl) throw new Error("CloudPayments не вернул ссылку на оплату.");

    const updated = await prisma.cloudPaymentOrder.update({
      where: { id: order.id },
      data: {
        cloudOrderId: model.Id ? String(model.Id) : null,
        paymentUrl,
        status: "PENDING",
        failureReason: null,
      },
    });

    return {
      invoiceId: updated.invoiceId,
      status: "PENDING",
      paymentUrl: updated.paymentUrl,
      amount: updated.amount,
      currency: updated.currency,
      plan: "month",
      paidAt: null,
      failureReason: null,
    };
  } catch (error) {
    /* Не переводим заказ в FAILED: таймаут после принятия CloudPayments может
       означать, что счёт уже создан. Следующий клик повторит запрос с тем же
       X-Request-ID и InvoiceId. */
    console.error("[cloudpayments] create order failed:", error);
    throw error;
  }
}

async function createSubscriptionForInitialPayment(tx: Prisma.TransactionClient, order: {
  userId: string;
  kind: CloudPaymentKind;
  plan: CloudPaymentPlan;
  amount: number;
  currency: string;
  invoiceId: string;
  localSubscriptionId: string | null;
}, now: Date, transactionId: string | null, cloudSubscriptionId: string | null) {
  if (order.localSubscriptionId) return order.localSubscriptionId;

  if (order.kind === "VPN") {
    const user = await tx.user.findUnique({
      where: { id: order.userId },
      select: { vpnAccess: true, vpnAccessUntil: true },
    });
    if (!user) throw new Error("Пользователь не найден.");

    const base =
      user.vpnAccess && user.vpnAccessUntil && user.vpnAccessUntil > now
        ? user.vpnAccessUntil
        : now;
    const expiresAt = vpnPlanExpiry("month" as VpnPlan, base);

    const sub = await tx.vpnSubscription.create({
      data: {
        userId: order.userId,
        plan: order.plan,
        paymentMethod: "acquiring",
        amount: order.amount,
        currency: order.currency,
        reference: `CloudPayments:${order.invoiceId}${transactionId ? `:${transactionId}` : ""}`,
        note: cloudSubscriptionId ? `CloudPayments subscription ${cloudSubscriptionId}` : "CloudPayments",
        status: "active",
        startedAt: now,
        expiresAt,
      },
      select: { id: true },
    });

    await tx.user.update({
      where: { id: order.userId },
      data: { vpnAccess: true, vpnAccessUntil: expiresAt },
    });
    return sub.id;
  }

  const active = await tx.premiumSubscription.findFirst({
    where: { userId: order.userId, status: "active", expiresAt: { not: null, gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  const base = active?.expiresAt ?? now;
  const d = new Date(base);
  d.setMonth(d.getMonth() + 1);

  const sub = await tx.premiumSubscription.create({
    data: {
      userId: order.userId,
      plan: order.plan,
      paymentMethod: "acquiring",
      amount: order.amount,
      currency: order.currency,
      reference: `CloudPayments:${order.invoiceId}${transactionId ? `:${transactionId}` : ""}`,
      note: cloudSubscriptionId ? `CloudPayments subscription ${cloudSubscriptionId}` : "CloudPayments",
      status: "active",
      startedAt: now,
      expiresAt: d,
    },
    select: { id: true },
  });

  await tx.user.update({
    where: { id: order.userId },
    data: { isPremium: true },
  });
  return sub.id;
}

async function extendExistingSubscription(tx: Prisma.TransactionClient, localSubscriptionId: string, kind: CloudPaymentKind, amount: number, currency: string, invoiceId: string, transactionId: string, now: Date) {
  if (kind === "VPN") {
    const sub = await tx.vpnSubscription.findUnique({ where: { id: localSubscriptionId } });
    if (!sub) throw new Error("VPN-подписка для CloudPayments не найдена.");

    const base = sub.expiresAt && sub.expiresAt > now ? sub.expiresAt : now;
    const expiresAt = vpnPlanExpiry("month" as VpnPlan, base);
    await tx.vpnSubscription.update({
      where: { id: sub.id },
      data: {
        status: "active",
        expiresAt,
        amount,
        currency,
        reference: `CloudPayments:${invoiceId}:${transactionId}`,
      },
    });
    await tx.user.update({
      where: { id: sub.userId },
      data: { vpnAccess: true, vpnAccessUntil: expiresAt },
    });
    return expiresAt;
  }

  const sub = await tx.premiumSubscription.findUnique({ where: { id: localSubscriptionId } });
  if (!sub) throw new Error("Premium-подписка для CloudPayments не найдена.");

  const base = sub.expiresAt && sub.expiresAt > now ? sub.expiresAt : now;
  const expiresAt = new Date(base);
  expiresAt.setMonth(expiresAt.getMonth() + 1);
  await tx.premiumSubscription.update({
    where: { id: sub.id },
    data: {
      status: "active",
      expiresAt,
      amount,
      currency,
      reference: `CloudPayments:${invoiceId}:${transactionId}`,
    },
  });
  await tx.user.update({
    where: { id: sub.userId },
    data: { isPremium: true },
  });
  return expiresAt;
}

export async function applyCloudPayment(args: {
  invoiceId: string;
  amount: number;
  currency: string;
  transactionId: string;
  cloudSubscriptionId?: string | null;
  status?: string;
}): Promise<{ ok: true; userId: string; kind: CloudPaymentKind; alreadyProcessed: boolean }> {
  const transactionId = String(args.transactionId);
  const order = await prisma.cloudPaymentOrder.findUnique({
    where: { invoiceId: args.invoiceId },
  });
  if (!order) throw new Error("CloudPayments order not found.");

  const knownTransaction = await prisma.cloudPaymentTransaction.findUnique({
    where: { transactionId },
    select: { orderId: true },
  });
  if (knownTransaction) {
    if (knownTransaction.orderId !== order.id) {
      throw new Error("CloudPayments transaction already связан с другим заказом.");
    }
    return {
      ok: true,
      userId: order.userId,
      kind: order.kind === "VPN" ? "VPN" : "PREMIUM",
      alreadyProcessed: true,
    };
  }

  const kind: CloudPaymentKind = order.kind === "VPN" ? "VPN" : "PREMIUM";
  const status = args.status || "Completed";

  if (!isSuccessfulCloudPaymentStatus(status)) {
    throw new Error("Платёж ещё не завершён.");
  }

  const actualAmount = parseCloudPaymentAmount(args.amount);
  if (actualAmount === null || Math.abs(actualAmount - order.amount) > 0.01) {
    throw new Error("Сумма CloudPayments не совпадает с заказом.");
  }
  if (args.currency.toUpperCase() !== order.currency.toUpperCase()) {
    throw new Error("Валюта CloudPayments не совпадает с заказом.");
  }

  let expiresAt: Date | null = null;
  let localSubscriptionId = order.localSubscriptionId;
  let duplicateTransaction = false;

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.cloudPaymentOrder.findUnique({ where: { id: order.id } });
      if (!current) throw new Error("CloudPayments order vanished.");

      try {
        await tx.cloudPaymentTransaction.create({
          data: {
            orderId: current.id,
            transactionId,
            amount: current.amount,
            currency: current.currency,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          duplicateTransaction = true;
          return;
        }
        throw error;
      }

      if (current.localSubscriptionId) {
        expiresAt = await extendExistingSubscription(
          tx,
          current.localSubscriptionId,
          kind,
          current.amount,
          current.currency,
          current.invoiceId,
          transactionId,
          new Date(),
        );
        localSubscriptionId = current.localSubscriptionId;
      } else {
        localSubscriptionId = await createSubscriptionForInitialPayment(
          tx,
          {
            userId: current.userId,
            kind,
            plan: current.plan as CloudPaymentPlan,
            amount: current.amount,
            currency: current.currency,
            invoiceId: current.invoiceId,
            localSubscriptionId: current.localSubscriptionId,
          },
          new Date(),
          transactionId,
          args.cloudSubscriptionId ? String(args.cloudSubscriptionId) : null,
        );
      }

      await tx.cloudPaymentOrder.update({
        where: { id: current.id },
        data: {
          status: "PAID",
          cloudTransactionId: transactionId,
          cloudSubscriptionId: args.cloudSubscriptionId ? String(args.cloudSubscriptionId) : current.cloudSubscriptionId,
          localSubscriptionId,
          paidAt: new Date(),
          lastCheckedAt: new Date(),
          failureReason: null,
        },
      });
    });
  } catch (error) {
    console.error("[cloudpayments] payment transaction failed:", error);
    throw error;
  }

  if (duplicateTransaction) {
    return {
      ok: true,
      userId: order.userId,
      kind,
      alreadyProcessed: true,
    };
  }

  invalidateUserAuthCache(order.userId);
  if (kind === "VPN") {
    emitToUser(order.userId, "account-vpn-updated", { vpnAccess: true, vpnAccessUntil: expiresAt });
  } else {
    emitToUser(order.userId, "account-premium-updated", { isPremium: true });
  }

  return { ok: true, userId: order.userId, kind, alreadyProcessed: false };
}

export async function findCloudPaymentStatus(args: {
  invoiceId: string;
  userId: string;
}): Promise<{
  status: "PENDING" | "PAID" | "FAILED" | "NOT_FOUND";
  order: CloudPaymentOrderSummary | null;
}> {
  const order = await prisma.cloudPaymentOrder.findFirst({
    where: { invoiceId: args.invoiceId, userId: args.userId },
  });
  if (!order) return { status: "NOT_FOUND", order: null };

  if (order.status === "PAID") {
    return {
      status: "PAID",
      order: {
        invoiceId: order.invoiceId,
        status: "PAID",
        paymentUrl: order.paymentUrl,
        amount: order.amount,
        currency: order.currency,
        plan: "month",
        paidAt: order.paidAt?.toISOString() ?? null,
        failureReason: null,
      },
    };
  }

  if (order.status === "FAILED") {
    return {
      status: "FAILED",
      order: {
        invoiceId: order.invoiceId,
        status: "FAILED",
        paymentUrl: order.paymentUrl,
        amount: order.amount,
        currency: order.currency,
        plan: "month",
        paidAt: null,
        failureReason: order.failureReason,
      },
    };
  }

  const config = await readCloudPaymentConfig(order.kind === "VPN" ? "VPN" : "PREMIUM");
  if (!config.enabled) {
    return {
      status: "PENDING",
      order: {
        invoiceId: order.invoiceId,
        status: "PENDING",
        paymentUrl: order.paymentUrl,
        amount: order.amount,
        currency: order.currency,
        plan: "month",
        paidAt: null,
        failureReason: null,
      },
    };
  }

  try {
    const model = await cloudRequest<{
      TransactionId?: number;
      Amount?: number;
      Currency?: string;
      InvoiceId?: string;
      AccountId?: string;
      Status?: string;
      SubscriptionId?: string | null;
    }>(config, "/v2/payments/find", { InvoiceId: order.invoiceId }, `status-${order.invoiceId}`);

    const accountId = typeof model.AccountId === "string" ? model.AccountId : "";
    const invoiceId = typeof model.InvoiceId === "string" ? model.InvoiceId : "";
    const amount = parseCloudPaymentAmount(model.Amount);
    const identityMatches =
      invoiceId === order.invoiceId &&
      accountId === order.userId &&
      amount !== null &&
      Math.abs(amount - order.amount) <= 0.01 &&
      (model.Currency || "").toUpperCase() === order.currency.toUpperCase() &&
      typeof model.TransactionId === "number";

    if (identityMatches && isSuccessfulCloudPaymentStatus(model.Status)) {
      await applyCloudPayment({
        invoiceId: order.invoiceId,
        amount,
        currency: model.Currency || order.currency,
        transactionId: String(model.TransactionId),
        cloudSubscriptionId: model.SubscriptionId ? String(model.SubscriptionId) : null,
        status: model.Status,
      });
      const paid = await prisma.cloudPaymentOrder.findUnique({ where: { id: order.id } });
      return {
        status: "PAID",
        order: paid
          ? {
              invoiceId: paid.invoiceId,
              status: "PAID",
              paymentUrl: paid.paymentUrl,
              amount: paid.amount,
              currency: paid.currency,
              plan: "month",
              paidAt: paid.paidAt?.toISOString() ?? null,
              failureReason: null,
            }
          : null,
      };
    }

    if (identityMatches && (model.Status === "Declined" || model.Status === "Cancelled")) {
      const reason = typeof model.Status === "string" ? `CloudPayments: ${model.Status}` : "Платёж отклонён.";
      await prisma.cloudPaymentOrder.update({
        where: { id: order.id },
        data: { status: "FAILED", failureReason: reason, lastCheckedAt: new Date() },
      });
      const failed = await prisma.cloudPaymentOrder.findUnique({ where: { id: order.id } });
      return {
        status: "FAILED",
        order: failed
          ? {
              invoiceId: failed.invoiceId,
              status: "FAILED",
              paymentUrl: failed.paymentUrl,
              amount: failed.amount,
              currency: failed.currency,
              plan: "month",
              paidAt: null,
              failureReason: failed.failureReason,
            }
          : null,
      };
    }

    await prisma.cloudPaymentOrder.update({
      where: { id: order.id },
      data: { lastCheckedAt: new Date() },
    });
  } catch (error) {
    console.warn("[cloudpayments] status reconciliation failed:", error);
    await prisma.cloudPaymentOrder.update({
      where: { id: order.id },
      data: { lastCheckedAt: new Date() },
    });
  }

  return {
    status: "PENDING",
    order: {
      invoiceId: order.invoiceId,
      status: "PENDING",
      paymentUrl: order.paymentUrl,
      amount: order.amount,
      currency: order.currency,
      plan: "month",
      paidAt: null,
      failureReason: null,
    },
  };
}

export async function markCloudPaymentFailed(invoiceId: string, reason: string | null): Promise<void> {
  await prisma.cloudPaymentOrder.updateMany({
    where: { invoiceId, status: "PENDING" },
    data: {
      status: "FAILED",
      failureReason: reason ? reason.slice(0, 1000) : "Платёж отклонён.",
      lastCheckedAt: new Date(),
    },
  });
}

export async function updateCloudPaymentRecurrentStatus(subscriptionId: string, status: string | null): Promise<void> {
  const order = await prisma.cloudPaymentOrder.findFirst({
    where: { cloudSubscriptionId: subscriptionId },
    orderBy: { createdAt: "desc" },
  });
  if (!order) return;

  await prisma.cloudPaymentOrder.update({
    where: { id: order.id },
    data: {
      lastCheckedAt: new Date(),
      failureReason:
        status === "PastDue" ? "CloudPayments: подписка просрочена." : status === "Cancelled" ? "CloudPayments: рекуррентная подписка отменена." : null,
    },
  });
}

export async function configureCloudPaymentNotifications(
  kind: CloudPaymentKind,
  baseUrl: string,
): Promise<{ updated: string[] }> {
  const config = await readCloudPaymentConfig(kind);
  if (!config.enabled) throw new Error("CloudPayments не настроен: включите эквайринг, укажите Public ID и API Secret.");

  const normalized = baseUrl.replace(/\/+$/, "");
  const updated: string[] = [];
  for (const type of ["check", "pay", "fail", "recurrent"] as const) {
    if (type === "check") {
      /* CloudPayments API не позволяет обновлять Check-уведомление через
         /site/notifications/{Type}/update; его нужно один раз включить/проверить
         в личном кабинете. */
      continue;
    }
    const response = await fetch(`${CLOUD_API}/site/notifications/${type}/update`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(config.publicId, config.apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        IsEnabled: true,
        Address: `${normalized}/api/webhooks/cloudpayments/${type}`,
        HttpMethod: "POST",
        Encoding: "UTF8",
        Format: "CloudPayments",
      }),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as { Success?: boolean; Message?: string | null } | null;
    if (!response.ok || !json?.Success) {
      throw new Error(json?.Message || `CloudPayments не настроил ${type}-уведомление.`);
    }
    updated.push(type);
  }
  return { updated };
}

export function cloudPaymentSuccessRedirectUrl(invoiceId: string, kind: CloudPaymentKind): string {
  return redirectUrl(kind, invoiceId, true);
}
