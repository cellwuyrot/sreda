import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

async function resolveEmail(input: string): Promise<string> {
  if (input.includes("@")) return input;
  const user = await prisma.user.findUnique({ where: { username: input }, select: { email: true } });
  return user?.email ?? input;
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "verify-code", { limit: 10, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  try {
    const { email, code, type } = await req.json();

    if (!email || !code || !type) {
      return NextResponse.json({ error: "Все поля обязательны" }, { status: 400 });
    }

    const targetEmail = await resolveEmail(email);

    const record = await prisma.verificationCode.findFirst({
      where: {
        email: targetEmail,
        code,
        type,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return NextResponse.json(
        { error: "Неверный или просроченный код" },
        { status: 400 }
      );
    }

    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { used: true },
    });

    if (type === "register") {
      return NextResponse.json({ ok: true, verified: true });
    }

    if (type === "login") {
      const user = await prisma.user.findUnique({ where: { email: targetEmail } });
      if (!user) {
        return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });

      return NextResponse.json({
        ok: true,
        verified: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
        },
      });
    }

    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    console.error("[verify-code] Error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
