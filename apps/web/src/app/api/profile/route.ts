import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { identityPatch, HubError } from "@/lib/tzIdHub";
import { hasPremium, premiumSource } from "@/lib/premium";
import { premiumDaysLeft } from "@/lib/premiumExpiry";
/* VPN-PLAN: вторая подписка — только тумблер VPN, без премиум-возможностей. */
import { hasActiveVpnPlan, vpnDaysLeft } from "@/lib/vpnPlan";
import { checkBan } from "@/lib/banCheck";
/* EMAIL-CHANGE: смена почты — шаг захвата аккаунта, поэтому она требует пароля,
   лимита и кода на новый адрес. */
import { rateLimit } from "@/lib/rateLimit";
import { revokeSessions } from "@/lib/tzIdSessions";
import { invalidateUserAuthCache } from "@/lib/auth";
import { generateCode, sendVerificationEmail } from "@/lib/email";
import { logAction } from "@/lib/audit";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, username: true, email: true,
      avatar: true, role: true, emailVerified: true, contactAddress: true,
      bio: true, socialLinks: true, customStatus: true, statusEmoji: true,
      isPremium: true, showOnline: true,
      vpnAccess: true, vpnAccessUntil: true, // VPN-PLAN
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
    /* VPN-PLAN: подписка «только VPN». Отдельный блок, а не поле внутри
       `premium`: раздел настроек показывает две независимые подписки, и их
       смешивание в одном объекте рано или поздно привело бы к тому, что VPN-
       подписчику показали бы метку Premium. */
    vpn: {
      /** Действует ли отдельная подписка на VPN прямо сейчас. */
      active: hasActiveVpnPlan(user),
      /** null — бессрочно. */
      expiresAt: user.vpnAccessUntil ?? null,
      daysLeft: vpnDaysLeft(user.vpnAccessUntil),
      /** Доступ есть и без отдельной подписки — его даёт Premium. */
      viaPremium: hasPremium(user) && !overdue,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать изменять данные своего профиля.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const body = await req.json();
  const { name, username, email, currentPassword, newPassword, bio, socialLinks, showOnline } = body;
  const data: Record<string, unknown> = {};

  try {
    Object.assign(data, await identityPatch(session.user.id, { name, username, contactAddress: body.contactAddress }));
  } catch (error) {
    if (error instanceof HubError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  /* EMAIL-CHANGE: смена почты.

     Раньше здесь было четыре ошибки, каждая сама по себе ломала аккаунт:

     1. Почта менялась без пароля. Кто получил чужую сессию (открытый ноутбук,
        угнанный токен), тот переводил почту на себя и через восстановление
        забирал аккаунт навсегда. Теперь нужен текущий пароль.
     2. Адрес сохранялся как набран, а проверка занятости была регистрозависимой:
        User@x.ru и user@x.ru становились разными аккаунтами, а вход искал точное
        совпадение. Теперь адрес нормализуется, а занятость сверяется без учёта регистра.
     3. Ставилось emailVerified: false, но код на новый адрес не уходил — почта
        оставалась неподтверждённой навсегда. Теперь код высылается сразу.
     4. Не было лимита: перебором адресов можно было выяснять, кто зарегистрирован
        в сервисе, по ответу 409. Теперь 5 попыток в час. */
  let emailChangedTo: string | null = null;
  if (email !== undefined) {
    if (typeof email !== "string")
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });

    const nextEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail) || nextEmail.length > 254)
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });

    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, password: true },
    });
    if (!me) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

    /* Повторное сохранение того же адреса — не смена. Пропускаем молча,
       иначе каждое нажатие «Сохранить» сбрасывало бы подтверждение почты. */
    if ((me.email || "").toLowerCase() !== nextEmail) {
      const limited = await rateLimit(req, "profile-email", { limit: 5, windowMs: 60 * 60 * 1000 });
      if (limited) return limited;

      if (!currentPassword || typeof currentPassword !== "string")
        return NextResponse.json({ error: "Введите текущий пароль, чтобы сменить почту" }, { status: 400 });

      const okPassword = await bcrypt.compare(currentPassword, me.password);
      if (!okPassword)
        return NextResponse.json({ error: "Текущий пароль неверный" }, { status: 400 });

      const taken = await prisma.user.findFirst({
        where: { email: { equals: nextEmail, mode: "insensitive" } },
        select: { id: true },
      });
      if (taken && taken.id !== session.user.id)
        return NextResponse.json({ error: "Email уже используется" }, { status: 409 });

      data.email = nextEmail;
      data.emailVerified = false; // подтверждается кодом из письма ниже
      emailChangedTo = nextEmail;
    }
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
    data.passwordChangedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    /* EMAIL-CHANGE: пользователь нажал «Сохранить», не тронув почту. Это не ошибка:
       отдаём текущие данные, чтобы интерфейс не показывал красный тост на пустом месте. */
    if (email !== undefined) {
      const current = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, username: true, email: true, avatar: true, role: true, emailVerified: true },
      });
      return NextResponse.json({ ...current, emailVerificationSent: false, emailUnchanged: true });
    }
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, username: true, email: true, avatar: true, role: true },
  });

  if (newPassword !== undefined) {
    await revokeSessions(session.user.id);
    invalidateUserAuthCache(session.user.id);
  }
  if (emailChangedTo) {
    /* Сессия на JWT держит старую почту в кэше — без сброса она живёт до перелогина. */
    invalidateUserAuthCache(session.user.id);

    /* Код идёт именно на НОВЫЙ адрес: так опечатка видна сразу, а не в момент,
       когда понадобится восстановление доступа. Тип «login» выбран осознанно:
       только он в /api/auth/verify-code выставляет emailVerified. */
    try {
      const code = generateCode();
      const verification = await prisma.verificationCode.create({
        data: {
          email: emailChangedTo,
          code,
          type: "login",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      await sendVerificationEmail(emailChangedTo, code, "login", verification.id);
    } catch (err) {
      console.error("[profile] не удалось отправить код на новый адрес:", err);
    }

    await logAction({
      userId: session.user.id,
      username: updated.username,
      action: "profile.email.changed",
      target: "User",
      targetId: session.user.id,
      details: emailChangedTo,
    });
  }

  return NextResponse.json({ ...updated, emailVerificationSent: Boolean(emailChangedTo) });
}
