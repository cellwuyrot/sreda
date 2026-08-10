import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// «Профиль сервера»: ник в User — глобальный и постоянный (это идентификатор,
// на него ссылаются упоминания, ссылки в профиле и т.д.), а вот отображаемое
// имя, аватар и фон мини-профиля внутри конкретного сообщества — переменные:
// один и тот же человек может представляться по-разному в разных группах.
// Поэтому эти три поля живут на GroupMember, а не на User, и правятся этим
// отдельным маршрутом, а не общим /api/profile.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { displayName: true, avatar: true, profileBanner: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  return NextResponse.json(membership);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { displayName, avatar, profileBanner } = await req.json();
  const data: Record<string, unknown> = {};

  // displayName: пусто/null — сброс к глобальному имени пользователя.
  if (displayName !== undefined) {
    if (displayName === null || (typeof displayName === "string" && displayName.trim() === "")) {
      data.displayName = null;
    } else if (typeof displayName === "string" && displayName.trim().length >= 2 && displayName.trim().length <= 50) {
      data.displayName = displayName.trim();
    } else {
      return NextResponse.json({ error: "Имя должно быть от 2 до 50 символов" }, { status: 400 });
    }
  }

  // avatar / profileBanner: data URL, как и баннер группы в api/groups/[id]/route.ts —
  // ограничиваем размер строки ~900 Кб (≈650 Кб бинарных данных), null — сброс.
  if (avatar !== undefined) {
    if (avatar !== null) {
      if (typeof avatar !== "string" || !avatar.startsWith("data:image/") || avatar.length > 900_000) {
        return NextResponse.json(
          { error: "Некорректный аватар: ожидается data:image/* размером до ~650 КБ" },
          { status: 400 },
        );
      }
    }
    data.avatar = avatar;
  }

  if (profileBanner !== undefined) {
    if (profileBanner !== null) {
      if (typeof profileBanner !== "string" || !profileBanner.startsWith("data:image/") || profileBanner.length > 900_000) {
        return NextResponse.json(
          { error: "Некорректный фон профиля: ожидается data:image/* размером до ~650 КБ" },
          { status: 400 },
        );
      }
    }
    data.profileBanner = profileBanner;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });
  }

  const updated = await prisma.groupMember.update({
    where: { id: membership.id },
    data,
    select: { displayName: true, avatar: true, profileBanner: true },
  });

  return NextResponse.json(updated);
}
