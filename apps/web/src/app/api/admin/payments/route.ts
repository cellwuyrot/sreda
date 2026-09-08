import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { hasEncryptionSecret } from "@/lib/encryption";
import {
  PAYMENT_KEYS,
  PAYMENT_SECRET_KEYS,
  readPaymentConfig,
  encodePaymentValue,
  type PaymentKey,
} from "@/lib/paymentSettings";

/**
 * PREMIUM-PAY: конфигурация платёжных реквизитов (СБП + интернет-эквайринг).
 * Доступно только администраторам (ADMIN). Секретный ключ эквайринга наружу
 * отдаётся замаскированным, но хранится зашифрованным.
 *
 * FIX-PAY-SAVE: раньше сохранение шло построчными upsert без обработки ошибок.
 * Любое исключение (например, шифрование секрета при незаданном ENCRYPTION_SECRET
 * или отказ базы) обрывало цикл на середине: часть ключей уже записана, часть —
 * нет, а наружу уходил безымянный 500, который форма молча игнорировала. Теперь
 * запрос проверяется целиком до записи, пишется одной транзакцией и в ответе
 * всегда есть текст ошибки.
 */

/* Ответ читаем из базы на каждый запрос: настройки меняются в админке, кэш
   отдавал бы старые реквизиты сразу после сохранения. */
export const dynamic = "force-dynamic";

/** Разумный предел на значение: реквизиты — короткие строки, а не документы. */
const MAX_VALUE_LENGTH = 4000;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    return code ? `${code}: ${e.message}` : e.message;
  }
  return String(e);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: fail("Сессия истекла. Войдите в аккаунт администратора заново.", 401) };
  if (session.user.role !== "ADMIN") return { error: fail("Доступно только администратору.", 403) };
  return { session };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  try {
    const config = await readPaymentConfig();
    const masked: Record<string, string> = { ...config };
    for (const key of PAYMENT_SECRET_KEYS) {
      const val = config[key];
      masked[key] = val ? val.slice(0, 3) + "•••" + val.slice(-2) : "";
    }
    /* Флаги: задан ли секрет вообще (чтобы UI отличал «пусто» от «скрыто»).
       BUSINESS-SUB: секретов теперь два — терминал Premium и терминал бизнеса,
       и в большинстве банков это разные магазины с разными ключами. */
    for (const key of PAYMENT_SECRET_KEYS) {
      masked[`${key}_set`] = config[key] ? "1" : "0";
    }
    return NextResponse.json(masked);
  } catch (e) {
    console.error("[payments] чтение реквизитов не удалось:", e);
    return fail(`Не удалось прочитать реквизиты из базы: ${errorText(e)}`, 500);
  }
}

export async function PUT(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return fail("Запрос пришёл без данных формы (не разобран как JSON).", 400);
  }

  /* Шаг 1 — разбор и проверка. Ни одной записи в базу, пока весь запрос не
     признан корректным: половина сохранённых реквизитов хуже, чем ни одного. */
  const updates: { key: PaymentKey; value: string }[] = [];
  const changed: string[] = [];
  let secretsInRequest = 0;

  for (const key of PAYMENT_KEYS as readonly PaymentKey[]) {
    const raw = body[key];
    if (raw === undefined || raw === null) continue;

    if (typeof raw === "object") {
      return fail(`Поле «${key}» пришло не строкой — сохранение отменено.`, 400);
    }
    const value = typeof raw === "string" ? raw : String(raw);
    if (value.length > MAX_VALUE_LENGTH) {
      return fail(`Поле «${key}» длиннее ${MAX_VALUE_LENGTH} символов — сохранение отменено.`, 400);
    }
    // Пустая строка секрета = «не менять» (иначе замаскированное значение из GET
    // затёрло бы реальный ключ). Явную очистку делаем отдельной кнопкой в UI.
    if (PAYMENT_SECRET_KEYS.includes(key)) {
      if (value === "") continue;
      secretsInRequest += 1;
    }

    updates.push({ key, value });
    changed.push(key);
  }

  // Явная очистка секретов эквайринга — каждый своей кнопкой в UI.
  for (const key of PAYMENT_SECRET_KEYS) {
    if (body[`${key}_clear`] !== true) continue;
    updates.push({ key, value: "" });
    changed.push(`${key}(clear)`);
  }

  if (updates.length === 0) {
    return fail("В запросе нет ни одного известного реквизита — нечего сохранять.", 400);
  }

  /* Шифрование секретов остаётся обязательным. Но если ключа шифрования на
     сервере нет, честно говорим об этом вместо падения посреди записи. */
  if (secretsInRequest > 0 && !hasEncryptionSecret()) {
    return fail(
      "Секретный ключ эквайринга нельзя сохранить: на сервере не задана переменная окружения ENCRYPTION_SECRET (или NEXTAUTH_SECRET). Остальные реквизиты тоже не сохранены — задайте переменную и повторите сохранение.",
      500,
    );
  }

  let encoded: { key: PaymentKey; value: string }[];
  try {
    encoded = updates.map(({ key, value }) => ({ key, value: encodePaymentValue(key, value) }));
  } catch (e) {
    console.error("[payments] шифрование секрета не удалось:", e);
    return fail(`Не удалось зашифровать секретный ключ: ${errorText(e)}`, 500);
  }

  /* Шаг 2 — одна транзакция на все ключи: либо сохраняются все реквизиты, либо
     в базе не меняется ничего и админ видит причину. */
  try {
    await prisma.$transaction(
      encoded.map(({ key, value }) =>
        prisma.siteConfig.upsert({ where: { key }, create: { key, value }, update: { value } }),
      ),
    );
  } catch (e) {
    console.error("[payments] запись реквизитов не удалась:", e);
    return fail(`База данных отклонила сохранение: ${errorText(e)}`, 500);
  }

  /* Шаг 3 — контрольное чтение. «Сохранено» не показываем на веру: сверяем
     то, что вернула база, с тем, что просили записать. */
  try {
    const saved = await readPaymentConfig();
    const mismatched = updates
      .filter(({ key, value }) => saved[key] !== value)
      .map(({ key }) => key);
    if (mismatched.length > 0) {
      return fail(
        `База вернула другие значения для: ${mismatched.join(", ")}. Реквизиты могли не сохраниться.`,
        500,
      );
    }
  } catch (e) {
    console.error("[payments] контрольное чтение не удалось:", e);
    return fail(`Реквизиты записаны, но проверить их не удалось: ${errorText(e)}`, 500);
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "PaymentSettings",
    details: `Изменение платёжных реквизитов: ${changed.join(", ") || "—"}`,
  });

  return NextResponse.json({ success: true, changed });
}
