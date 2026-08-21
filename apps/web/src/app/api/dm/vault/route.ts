import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isRateLimited, rateLimit } from "@/lib/rateLimit";

/* FIX-VAULTPW: «Сейф» — переписка с самим собой, куда складывают документы и
   пароли. Раньше это были просто «избранные»: любой, кто дотянулся до уже
   открытой сессии, читал их одним кликом.

   Пароль хранится только как bcrypt-хеш. Вся проверка на сервере — клиент не
   получает ни хеш, ни сам пароль.

   FIX-VAULTFORGOT: забытый пароль больше не запирает Сейф навсегда. Раньше
   единственным ключом был сам пароль Сейфа, и человек терял доступ к своим же
   документам без всякой возможности вернуться. Содержимое Сейфа этим паролем
   не шифруется — он только замок на входе, поэтому запасной вход возможен без
   потери данных: подтверждаем пароль ОТ АККАУНТА и сразу требуем задать новый
   пароль Сейфа.

   Осознанный размен: открытая сессия плюс известный пароль аккаунта теперь
   дают доступ к Сейфу. Поэтому запасной вход ограничен по числу попыток
   (и по адресу, и по пользователю), а сам вход без смены пароля Сейф не
   открывает — иначе замок тихо остался бы с прежним, забытым паролем. */

const MIN_LENGTH = 4;

/* Попыток мало намеренно: это подбор пароля аккаунта, а не пароля Сейфа.
   Человеку, который его помнит, пяти попыток за 15 минут достаточно. */
const ACCOUNT_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };

/** Проверка пароля от аккаунта для запасного входа.
 *  Возвращает готовый отказ или null, если пароль верный. */
async function checkAccountPassword(
  req: NextRequest,
  userId: string,
  passwordHash: string,
  password: string
): Promise<NextResponse | null> {
  const limitedByIp = await rateLimit(req, "vault-account", ACCOUNT_LIMIT);
  if (limitedByIp) return limitedByIp;

  /* Счёт двойной: по адресу — от перебора разных аккаунтов с одного источника,
     по пользователю — от перебора одного аккаунта с разных адресов. */
  const limitedByUser = await isRateLimited("vault-account-user", userId, ACCOUNT_LIMIT);
  if (limitedByUser) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429 }
    );
  }

  if (!password) {
    return NextResponse.json({ error: "Введите пароль от аккаунта" }, { status: 400 });
  }

  const ok = await bcrypt.compare(password, passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Пароль от аккаунта неверный" }, { status: 401 });
  }

  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true },
  });

  return NextResponse.json({ hasPassword: !!user?.vaultPasswordHash });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { password?: unknown; mode?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const mode = body?.mode === "account" ? "account" : "vault";
  if (!password) return NextResponse.json({ error: "Введите пароль" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true, password: true },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  /* FIX-VAULTFORGOT: «Не помню пароль» — сверяем пароль аккаунта. Сейф при этом
     ещё не открывается: клиент обязан задать новый пароль Сейфа через PUT. */
  if (mode === "account") {
    const denied = await checkAccountPassword(req, session.user.id, user.password, password);
    if (denied) return denied;
    return NextResponse.json({ ok: true, resetRequired: true });
  }

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

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { current?: unknown; password?: unknown; accountPassword?: unknown }
    | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const accountPassword =
    typeof body?.accountPassword === "string" ? body.accountPassword : "";

  if (password.length < MIN_LENGTH) {
    return NextResponse.json({ error: `Минимум ${MIN_LENGTH} символа` }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vaultPasswordHash: true, password: true },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  if (user.vaultPasswordHash) {
    /* FIX-VAULTFORGOT: два равноправных способа доказать право на смену —
       текущий пароль Сейфа либо пароль аккаунта. Пустой accountPassword в
       запасной путь не проваливается: пустую строку bcrypt всё равно
       отвергнет, но лучше не доводить до сравнения вообще. */
    if (accountPassword) {
      const denied = await checkAccountPassword(
        req,
        session.user.id,
        user.password,
        accountPassword
      );
      if (denied) return denied;
    } else {
      const ok = await bcrypt.compare(current, user.vaultPasswordHash);
      if (!ok) return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 401 });
    }
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { vaultPasswordHash: hash },
  });
  return NextResponse.json({ ok: true });
}
