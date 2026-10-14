import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { anonymizeUser } from "@/lib/deletedUser";
import { revokeSessions } from "@/lib/tzIdSessions";
import { invalidateUserAuthCache } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { password } = await req.json();
  if (!password) return NextResponse.json({ error: "Введите пароль для подтверждения" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return NextResponse.json({ error: "Неверный пароль" }, { status: 403 });

  // Revoke identity access, then anonymize without cascading away community content.
  await revokeSessions(session.user.id);
  await anonymizeUser(session.user.id);
  invalidateUserAuthCache(session.user.id);

  return NextResponse.json({ ok: true, message: "Аккаунт удалён" });
}
