import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { USERNAME_COOLDOWN_DAYS, formatCooldownLeft, usernameCooldownLeftMs, validateUsername } from "@/lib/username";
import { hasPremium, premiumSource } from "@/lib/premium";
import { premiumDaysLeft } from "@/lib/premiumExpiry";
import { checkBan } from "@/lib/banCheck";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, username: true, email: true,
      avatar: true, role: true, emailVerified: true,
      bio: true, socialLinks: true, customStatus: true, statusEmoji: true,
      isPremium: true, showOnline: true,
      privacyOnline: true, privacyFriends: true, privacyEmail: true,
      notifySound: true, notifyPush: true,
      createdAt: true, lastSeen: true,
      _count: {
        select: {
          messages: true,
          friendsSent: true,
          friendsReceived: true,
          gamePlayers: true,
        },
      },
      badges: {
        include: { badge: true },
        orderBy: { awardedAt: "desc" },
      },
    },
  });

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Сведения о подписке для раздела «Premium». Раньше страница знала только
     флаг: премиум есть или нет — ни срока, ни того, откуда он взялся. Человек
     не мог понять, до какого числа оплачено и что будет дальше.

     Роль администратора даёт премиум сама по себе (lib/premium), записи о
     подписке при этом может не быть — тогда и срока нет. */
  const subscription = user.isPremium
    ? await prisma.premiumSubscription.findFirst({
        where: { userId: user.id, status: "active" },
        orderBy: [{ expiresAt: "desc" }, { startedAt: "desc" }],
        select: { plan: true, startedAt: true, expiresAt: true, grantedById: true },
      })
    : null;

  /* Срок подписки проверяется задачей по расписанию раз в шесть часов, и между
     тиками профиль мог бы показывать премиум у человека, у которого срок вышел
     час назад. Здесь считаем по дате, а не по флагу: экран настроек — это ровно
     то место, где человек проверяет, до какого числа у него оплачено. */
  const daysLeft = premiumDaysLeft(subscription?.expiresAt ?? null);
  const overdue = daysLeft !== null && daysLeft < 0;

  return NextResponse.json({
    ...user,
    premium: {
      active: hasPremium(user) && !overdue,
      source: overdue ? "none" : premiumSource(user),
      plan: subscription?.plan ?? null,
      startedAt: subscription?.startedAt ?? null,
      /** null при бессрочной подписке и когда премиум выдан ролью. */
      expiresAt: subscription?.expiresAt ?? null,
      /** Полных дней до конца срока; null — срока нет. Отрицательное — срок вышел. */
      daysLeft,
      /** Подписку оформил администратор, а не сам пользователь. */
      granted: !!subscription?.grantedById,
    },
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать изменять данные своего профиля.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const body = await req.json();
  const { name, username, email, currentPassword, newPassword, bio, socialLinks, showOnline } = body;
  const data: Record<string, unknown> = {};

  // Name
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50)
      return NextResponse.json({ error: "Имя должно быть от 2 до 50 символов" }, { status: 400 });
    data.name = name.trim();
  }

  // Username
  if (username !== undefined) {
    const validated = validateUsername(username);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const value = validated.value;

    /* Читаем себя один раз: нужны и тариф с ролью, и текущий ник с датой
       последней смены. */
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { username: true, usernameChangedAt: true, isPremium: true, role: true },
    });

    /* Ник не меняется — выходим молча. Раньше повторное сохранение того же
       значения проходило через все проверки: человек жал «Сохранить» на форме,
       где ник и так свой, и получал отказ про Premium или кулдаун. */
    if (!me || me.username !== value) {
      /* Ник без цифр — привилегия подписки. Проверяем ОБЩИМ правилом
         (lib/premium): администратор получает премиум по роли, и раньше это
         здесь не учитывалось — интерфейс показывал метку «Premium», а сервер
         отвечал «доступно только Premium-пользователям». */
      if (!/[0-9]/.test(value) && !hasPremium(me)) {
        return NextResponse.json(
          { error: "Юзернейм без цифр доступен только Premium-пользователям" },
          { status: 403 },
        );
      }

      const taken = await prisma.user.findUnique({ where: { username: value } });
      if (taken && taken.id !== session.user.id)
        return NextResponse.json({ error: "Юзернейм уже занят" }, { status: 409 });

      // Кулдаун: ник меняется не чаще, чем раз в 14 дней.
      const left = usernameCooldownLeftMs(me?.usernameChangedAt ?? null);
      if (left > 0) {
        return NextResponse.json(
          { error: `Ник можно менять раз в ${USERNAME_COOLDOWN_DAYS} дней — ${formatCooldownLeft(left)}` },
          { status: 429 },
        );
      }
      data.usernameChangedAt = new Date();
      data.username = value;
    }
  }

  // Email
  if (email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== session.user.id)
      return NextResponse.json({ error: "Email уже используется" }, { status: 409 });
    data.email = email;
    data.emailVerified = false; // require re-verification
  }

  // Bio
  if (bio !== undefined) {
    if (bio !== null && typeof bio === "string" && bio.length > 200) {
      return NextResponse.json({ error: "Био не должно превышать 200 символов" }, { status: 400 });
    }
    data.bio = bio || null;
  }

  // Social links
  if (socialLinks !== undefined) {
    if (socialLinks !== null && typeof socialLinks === "object") {
      data.socialLinks = JSON.stringify(socialLinks);
    } else {
      data.socialLinks = null;
    }
  }

  if (typeof showOnline === "boolean") {
    data.showOnline = showOnline;
  }

  // Password change
  if (newPassword !== undefined) {
    if (!currentPassword)
      return NextResponse.json({ error: "Введите текущий пароль" }, { status: 400 });
    if (newPassword.length < 8)
      return NextResponse.json({ error: "Новый пароль — минимум 8 символов" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    const valid = await bcrypt.compare(currentPassword, user!.password);
    if (!valid)
      return NextResponse.json({ error: "Текущий пароль неверный" }, { status: 400 });

    data.password = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, username: true, email: true, avatar: true, role: true },
  });

  return NextResponse.json(updated);
}
