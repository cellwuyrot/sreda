import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { pushConfigured } from "@/lib/push";

/**
 * PUSH: регистрация устройства для доставки уведомлений в закрытое приложение.
 *
 *  POST   — привязать адрес устройства к аккаунту (зовётся оболочкой при входе).
 *  DELETE — отвязать (выход из аккаунта, отключение уведомлений).
 *
 * ── Почему привязка ПЕРЕПРИВЯЗЫВАЕТ ─────────────────────────────────────────
 *
 * Телефон один, а людей может быть двое: кто-то вошёл в свой аккаунт на чужом
 * устройстве. Адрес устройства уникален, и при повторной привязке он переходит к
 * тому, кто вошёл сейчас. Иначе прежний владелец продолжал бы получать на этот
 * телефон уведомления о своей переписке — это утечка, а не неудобство.
 *
 * ── Что считается секретом ──────────────────────────────────────────────────
 *
 * Адрес устройства не секрет, но и не публичное значение: по нему можно
 * доставить уведомление. Поэтому наружу он не отдаётся никогда — ни в ответе,
 * ни в списке устройств; маршрут только принимает.
 */

/** Адрес устройства службы доставки: длинная строка без пробелов. */
function isValidToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 40 && value.length <= 4096 && !/\s/.test(value);
}

const PLATFORMS = new Set(["android", "ios", "web"]);

export async function POST(req: NextRequest) {
  /* Предел на всякий случай: оболочка присылает адрес раз за запуск, а не пачкой.
     Частые обращения означают ошибку в клиенте, и они не должны стоить базе
     ничего. */
  const limited = await rateLimit(req, "push-device", { limit: 30, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null;
  if (!isValidToken(body?.token)) {
    return NextResponse.json({ error: "Некорректный адрес устройства" }, { status: 400 });
  }
  const platform = typeof body?.platform === "string" && PLATFORMS.has(body.platform) ? body.platform : "android";

  /* Переприязка: один адрес — один владелец, последний вошедший. */
  await prisma.pushDevice.upsert({
    where: { token: body.token },
    create: { userId: session.user.id, token: body.token, platform },
    update: { userId: session.user.id, platform, lastSeenAt: new Date() },
  });

  /* Честно сообщаем, работает ли доставка на этом сервере. Оболочке это нужно,
     чтобы не обещать человеку уведомления, которых не будет: доступы к службе
     доставки задаются на сервере и могут быть не заданы вовсе. */
  return NextResponse.json({ ok: true, delivery: pushConfigured() });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (!isValidToken(body?.token)) {
    return NextResponse.json({ error: "Некорректный адрес устройства" }, { status: 400 });
  }

  /* Снимаем только своё устройство: чужой адрес удалить нельзя даже зная его. */
  await prisma.pushDevice.deleteMany({ where: { token: body.token, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
