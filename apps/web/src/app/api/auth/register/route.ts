import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { autoJoinMainCommunity } from "@/lib/mainCommunity";
import { getClientIp, isIdentityBlocked, recordIdentities, DEVICE_COOKIE } from "@/lib/identity";

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "register", { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  // НОВОЕ: регистрация с заблокированного IP/устройства невозможна
  const clientIp = getClientIp(req);
  const clientDevice = req.cookies.get(DEVICE_COOKIE)?.value ?? null;
  if (await isIdentityBlocked(clientIp, clientDevice)) {
    return NextResponse.json({ error: "Действие учётной записи приостановлено" }, { status: 403 });
  }
  try {
    const { email, name, username, password, verificationCode } = await req.json();

    if (!email || !name || !username || !password) {
      return NextResponse.json({ error: "Заполните все поля" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_]{6,20}$/.test(username)) {
      return NextResponse.json({ error: "Юзернейм: 6-20 символов, латиница, цифры и _" }, { status: 400 });
    }

    if (!/[0-9]/.test(username)) {
      return NextResponse.json({ error: "Юзернейм должен содержать хотя бы одну цифру" }, { status: 400 });
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Пароль должен содержать минимум 8 символов" }, { status: 400 });
    }

    if (password.length > 128) {
      return NextResponse.json({ error: "Пароль слишком длинный (максимум 128 символов)" }, { status: 400 });
    }

    if (verificationCode) {
      const record = await prisma.verificationCode.findFirst({
        where: {
          email,
          code: verificationCode,
          type: "register",
          used: true,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!record) {
        return NextResponse.json({ error: "Код подтверждения недействителен" }, { status: 400 });
      }
    }

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json({ error: "Email уже зарегистрирован" }, { status: 400 });
    }

    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return NextResponse.json({ error: "Юзернейм уже занят" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 12);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          email,
          name,
          username,
          password: hashed,
          emailVerified: !!verificationCode,
        },
      });
    } catch (e: unknown) {
      const errObj = e as Record<string, unknown>;
      const isPrismaUniqueError =
        e instanceof Error && "code" in errObj && errObj.code === "P2002";
      if (isPrismaUniqueError) {
        return NextResponse.json({ error: "Email или юзернейм уже заняты" }, { status: 409 });
      }
      throw e;
    }

    // Auto-join to main community
    try {
      await autoJoinMainCommunity(user.id);
    } catch {
      // Non-critical — don't fail registration if main community join fails
    }

    // НОВОЕ: запоминаем IP/устройство нового аккаунта (best-effort)
    try {
      await recordIdentities(user.id, clientIp, clientDevice);
    } catch {
      /* некритично */
    }

    return NextResponse.json({ id: user.id, email: user.email, name: user.name, username: user.username });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
