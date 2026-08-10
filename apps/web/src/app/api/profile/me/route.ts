import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasPremium } from "@/lib/premium";
import { getIO } from "@/lib/socketEmit";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // FIX-SET: если в БД ещё нет новых колонок (не выполнен `npx prisma db push`),
  // запрос со всеми полями падал с 500 — и ВСЕ настройки в интерфейсе выглядели
  // «сброшенными» (город, статус, галочки). Теперь при ошибке повторяем запрос
  // без новых полей и отдаём для них значения по умолчанию.
  const baseSelect = {
    id: true,
    name: true,
    username: true,
    email: true,
    avatar: true,
    role: true,
    avatarGlowEnabled: true,
    avatarGlowColors: true,
    profileBanner: true,
    isPremium: true,
    showOnline: true,
    tosAccepted: true,
    statusType: true,
    customStatus: true,
  } as const;

  const userId = (session.user as { id: string }).id;
  let user: Record<string, unknown> | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { ...baseSelect, city: true, activityEnabled: true /* FIX-ACT */ },
    });
  } catch {
    try {
      user = await prisma.user.findUnique({ where: { id: userId }, select: { ...baseSelect, city: true } });
      if (user) user.activityEnabled = false;
    } catch {
      user = await prisma.user.findUnique({ where: { id: userId }, select: baseSelect });
      if (user) {
        user.activityEnabled = false;
        user.city = null;
      }
    }
  }

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(user);
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать изменять оформление своего профиля.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const userId = (session.user as { id: string }).id;
  const userRole = (session.user as { role: string }).role;

  /* Оформление профиля — свечение аватара и анимированный баннер — привилегия
     Premium, а не должности. Раньше проверялась роль ADMIN, из-за чего платная
     возможность была недоступна тем, кто за неё заплатил, и доступна тем, кто
     нет. Роль читаем из базы вместе с подпиской: в JWT-сессии `isPremium` может
     быть устаревшим, если подписку оформили в этой же сессии. */
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  });
  const canDecorate = hasPremium({ isPremium: owner?.isPremium, role: userRole });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  // Оформление — Premium (и администратор, чтобы было чем проверять).
  if (canDecorate) {
    if (typeof body.avatarGlowEnabled === "boolean") {
      data.avatarGlowEnabled = body.avatarGlowEnabled;
    }
  }

  if (canDecorate && "avatarGlowColors" in body) {
    if (body.avatarGlowColors === null) {
      data.avatarGlowColors = null;
    } else if (Array.isArray(body.avatarGlowColors)) {
      const colors = body.avatarGlowColors as string[];
      if (colors.length < 2 || colors.length > 6) {
        return NextResponse.json({ error: "Укажите от 2 до 6 цветов" }, { status: 400 });
      }
      const hexRe = /^#[0-9a-fA-F]{6}$/;
      if (!colors.every((c) => hexRe.test(c))) {
        return NextResponse.json({ error: "Цвета должны быть в формате #RRGGBB" }, { status: 400 });
      }
      data.avatarGlowColors = JSON.stringify(colors);
    }
  }

  if ("profileBanner" in body) {
    if (body.profileBanner === null || body.profileBanner === "") {
      data.profileBanner = null;
    } else if (typeof body.profileBanner === "string") {
      // FIX-SEC: баннер — только относительный путь загрузки на нашем домене.
      // Раньше принимался любой URL → SSRF/утечка (запрос к внешнему ресурсу при
      // рендере <img>/background) и потенциальная CSS-инъекция.
      const b = body.profileBanner.trim();
      if (b.startsWith("/uploads/") && b.length <= 300 && !b.includes("..")) {
        data.profileBanner = b;
      } else {
        return NextResponse.json({ error: "Некорректный баннер" }, { status: 400 });
      }
    }
  }


  if ("city" in body) {
    if (body.city === null || body.city === "") {
      data.city = null;
    } else if (typeof body.city === "string") {
      // FIX-SEC: чистим город от разметки/управляющих символов перед сохранением.
      data.city = sanitizeText(body.city).slice(0, 64);
    }
  }

  if (Object.keys(data).length === 0) {
    // Non-admin users calling save() with only glow fields — return current state without error
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatar: true, avatarGlowEnabled: true, avatarGlowColors: true, profileBanner: true },
    });
    return NextResponse.json(current ?? {});
  }

  // FIX-SET: понятная ошибка вместо молчаливого 500, если нужной колонки нет в БД
  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        avatar: true,
        avatarGlowEnabled: true,
        avatarGlowColors: true,
        profileBanner: true,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось сохранить: база данных не обновлена. Выполните `npx prisma db push` в apps/web и перезапустите сервер." },
      { status: 500 },
    );
  }

  const io = getIO();
  if (io) io.emit("profile-updated", updated);

  return NextResponse.json(updated);
}
