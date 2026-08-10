import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import {
  PAYMENT_KEYS,
  PAYMENT_SECRET_KEYS,
  PAYMENT_DEFAULTS,
  readPaymentConfig,
  encodePaymentValue,
  type PaymentKey,
} from "@/lib/paymentSettings";

/**
 * PREMIUM-PAY: конфигурация платёжных реквизитов (СБП + интернет-эквайринг).
 * Доступно только администраторам (ADMIN). Секретный ключ эквайринга наружу
 * отдаётся замаскированным, но хранится зашифрованным.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await readPaymentConfig();
  const masked: Record<string, string> = { ...config };
  for (const key of PAYMENT_SECRET_KEYS) {
    const val = config[key];
    masked[key] = val ? val.slice(0, 3) + "•••" + val.slice(-2) : "";
  }
  // Флаг: задан ли секрет вообще (чтобы UI отличал «пусто» от «скрыто»).
  masked.pay_acquiring_secret_set = config.pay_acquiring_secret ? "1" : "0";
  return NextResponse.json(masked);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const changed: string[] = [];

  for (const key of PAYMENT_KEYS as readonly PaymentKey[]) {
    if (body[key] === undefined) continue;
    // Пустая строка секрета = «не менять» (иначе замаскированное значение из GET
    // затёрло бы реальный ключ). Явную очистку делаем отдельной кнопкой в UI.
    if (PAYMENT_SECRET_KEYS.includes(key) && body[key] === "") continue;

    const raw = typeof body[key] === "string" ? body[key] : String(body[key] ?? PAYMENT_DEFAULTS[key]);
    const value = encodePaymentValue(key, raw);
    await prisma.siteConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    changed.push(key);
  }

  // Явная очистка секрета эквайринга.
  if (body.pay_acquiring_secret_clear === true) {
    await prisma.siteConfig.upsert({
      where: { key: "pay_acquiring_secret" },
      create: { key: "pay_acquiring_secret", value: "" },
      update: { value: "" },
    });
    changed.push("pay_acquiring_secret(clear)");
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "PaymentSettings",
    details: `Изменение платёжных реквизитов: ${changed.join(", ") || "—"}`,
  });

  return NextResponse.json({ success: true });
}
