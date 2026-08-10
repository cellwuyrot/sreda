import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

/**
 * FIX-RESET: строгая связка «логин ↔ почта». Логин (в т.ч. с ведущим @)
 * резолвится только в привязанную к аккаунту почту; если пользователь не
 * найден — возвращается null, и введённая строка никогда не используется как
 * адрес почты.
 */
async function resolveEmail(rawInput: string): Promise<string | null> {
  const input = rawInput.trim().replace(/^@+/, "");
  if (input.includes("@")) return input;
  const user = await prisma.user.findUnique({ where: { username: input }, select: { email: true } });
  return user?.email ?? null;
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "reset-password", { limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  try {
    const { email, code, newPassword } = await req.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Все поля обязательны" }, { status: 400 });
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json({ error: "Пароль должен содержать минимум 8 символов" }, { status: 400 });
    }

    if (newPassword.length > 128) {
      return NextResponse.json({ error: "Пароль слишком длинный (максимум 128 символов)" }, { status: 400 });
    }

    const targetEmail = await resolveEmail(String(email));
    if (!targetEmail) {
      // Не раскрываем, существует ли аккаунт с таким логином.
      return NextResponse.json({ error: "Неверный или просроченный код" }, { status: 400 });
    }

    const record = await prisma.verificationCode.findFirst({
      where: {
        email: targetEmail,
        code,
        type: "reset",
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return NextResponse.json({ error: "Неверный или просроченный код" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: targetEmail } });
    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashed },
      }),
    ]);

    return NextResponse.json({ ok: true, message: "Пароль успешно изменён" });
  } catch (err) {
    console.error("[reset-password] Error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
