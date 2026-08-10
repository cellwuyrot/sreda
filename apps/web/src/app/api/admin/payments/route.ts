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
  /* Флаги: задан ли секрет вообще (чтобы UI отличал «пусто» от «скрыто»).
     BUSINESS-SUB: секретов теперь два — терминал Premium и терминал бизнеса,
     и в большинстве банков это разные магазины с разными ключами. */
  for (const key of PAYMENT_SECRET_KEYS) {
    masked[`${key}_set`] = config[key] ? "1" : "0";
  }
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

  // Явная очистка секретов эквайринга — каждый своей кнопкой в UI.
  for (const key of PAYMENT_SECRET_KEYS) {
    if (body[`${key}_clear`] !== true) continue;
    await prisma.siteConfig.upsert({
      where: { key },
      create: { key, value: "" },
      update: { value: "" },
    });
    changed.push(`${key}(clear)`);
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
