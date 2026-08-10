import { NextResponse } from "next/server";
import prisma from "./prisma";

/**
 * Checks if a user is currently banned. Returns a 403 NextResponse if banned, null otherwise.
 */
export async function checkBan(userId: string): Promise<NextResponse | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { banned: true, bannedUntil: true, banReason: true },
  });

  if (!user) return null;

  if (user.banned) {
    const now = new Date();
    if (!user.bannedUntil || new Date(user.bannedUntil) > now) {
      const until = user.bannedUntil
        ? new Date(user.bannedUntil).toLocaleString("ru-RU")
        : "бессрочно";
      return NextResponse.json(
        { error: `Ваш аккаунт ограничен до ${until}. Причина: ${user.banReason || "не указана"}` },
        { status: 403 }
      );
    }
  }

  return null;
}
