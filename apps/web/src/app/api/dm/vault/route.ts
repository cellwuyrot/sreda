import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/* FIX-VAULTPW: «Сейф» — переписка с самим собой, куда складывают документы и
   пароли. Раньше это были просто «избранные»: любой, кто дотянулся до уже
   открытой сессии, читал их одним кликом.

   Пароль хранится только как bcrypt-хеш и не связан с паролем аккаунта: смысл
   именно в том, чтобы открытая сессия сама по себе не давала доступа. Вся
   проверка на сервере — клиент не получает ни хеш, ни сам пароль. */

const MIN_LENGTH = 4;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true },
  });

  return NextResponse.json({ hasPassword: !!user?.vaultPasswordHash });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "Введите пароль" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  // Первый вход: пароля ещё нет — значит человек его задаёт.
  if (!user.vaultPasswordHash) {
    if (password.length < MIN_LENGTH) {
      return NextResponse.json({ error: `Минимум ${MIN_LENGTH} символа` }, { status: 400 });
    }
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { vaultPasswordHash: hash },
    });
    return NextResponse.json({ ok: true, created: true });
  }

  const ok = await bcrypt.compare(password, user.vaultPasswordHash);
  if (!ok) return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { current?: unknown; password?: unknown }
    | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (password.length < MIN_LENGTH) {
    return NextResponse.json({ error: `Минимум ${MIN_LENGTH} символа` }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  if (user.vaultPasswordHash) {
    const ok = await bcrypt.compare(current, user.vaultPasswordHash);
    if (!ok) return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 401 });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { vaultPasswordHash: hash },
  });
  return NextResponse.json({ ok: true });
}
