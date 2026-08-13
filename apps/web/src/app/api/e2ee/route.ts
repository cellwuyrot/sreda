import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createHash } from "crypto";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { logAction } from "@/lib/audit";

/**
 * Публичные ключи для сквозного шифрования личных переписок.
 *
 * Сервер — просто справочник открытых частей ключей. Отсюда два следствия,
 * которые раньше не были учтены:
 *
 * 1. Запись надо проверять поле за полем. Раньше проверялись только `kty` и
 *    `crv`, а всё остальное содержимое сохранялось как пришло — включая поле `d`
 *    (приватная часть), если клиент ошибочно прислал полную пару. Приватный ключ
 *    в базе, который выдаётся в GET любому авторизованному — полный провал
 *    шифрования. Теперь в базу попадают ровно четыре поля открытого ключа.
 *
 * 2. Подмена ключа — единственный способ читать чужую переписку без взлома
 *    шифра. Запретить её нельзя (люди меняют устройства), но каждая замена
 *    теперь попадает в журнал действий, а отпечаток ключа отдаётся клиенту,
 *    чтобы собеседники могли сверить его вручную.
 */

type PublicJwk = { kty: string; crv: string; x: string; y: string };

function normalizeJwk(input: unknown): PublicJwk | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const jwk = input as Record<string, unknown>;

  // Приватная часть не должна покидать устройство ни при каких обстоятельствах.
  if ("d" in jwk) return null;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;
  // base64url координаты P-256 — ровно 43 символа без выравнивания.
  if (!/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) return null;

  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

/** Короткий отпечаток для сверки ключа глазами. */
function fingerprint(jwk: PublicJwk): string {
  const hash = createHash("sha256").update(`${jwk.crv}.${jwk.x}.${jwk.y}`).digest("hex");
  return hash.slice(0, 32).replace(/(.{4})(?=.)/g, "$1 ");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Справочник ключей — заодно и справочник существующих учётных записей:
     без лимита по нему можно перебирать идентификаторы. */
  const limited = await rateLimit(req, "e2ee-get", { limit: 120, windowMs: 60 * 1000 });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, e2eePublicKey: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let publicKey: PublicJwk | null = null;
  if (user.e2eePublicKey) {
    try {
      publicKey = normalizeJwk(JSON.parse(user.e2eePublicKey));
    } catch {
      /* Мусор в поле равносилен отсутствию ключа. Раньше разбор без try
         ронял роут в 500 и личная переписка переставала открываться вообще. */
      publicKey = null;
    }
  }

  return NextResponse.json({
    userId: user.id,
    publicKey,
    fingerprint: publicKey ? fingerprint(publicKey) : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimit(req, "e2ee-post", { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { publicKey, confirmReplace } = (body ?? {}) as {
    publicKey?: unknown;
    confirmReplace?: unknown;
  };

  const jwk = normalizeJwk(publicKey);
  if (!jwk) {
    return NextResponse.json(
      { error: "Ожидается открытый ключ ECDH P-256 (без приватной части)" },
      { status: 400 },
    );
  }

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { e2eePublicKey: true },
  });

  const serialized = JSON.stringify(jwk);
  if (current?.e2eePublicKey && current.e2eePublicKey !== serialized) {
    /* Замена ключа допустима, но требует явного признака: случайный повторный
       вызов не должен тихо обесценивать всю переписку человека. */
    if (confirmReplace !== true) {
      return NextResponse.json(
        {
          error:
            "На аккаунте уже есть другой ключ. Замена сделает нечитаемой переписку, " +
            "зашифрованную для прежнего ключа. Подтвердите замену явно.",
          needsConfirmation: true,
        },
        { status: 409 },
      );
    }
    try {
      await logAction({
        userId: session.user.id,
        username: session.user.username || session.user.name || "user",
        action: "update",
        target: "E2EEKey",
        targetId: session.user.id,
        details: `Ключ шифрования заменён, отпечаток: ${fingerprint(jwk)}`,
      });
    } catch {
      /* журнал — не повод отказывать в смене ключа */
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { e2eePublicKey: serialized },
  });

  return NextResponse.json({ ok: true, fingerprint: fingerprint(jwk) });
}
