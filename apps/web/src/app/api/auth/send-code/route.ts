import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateCode, sendVerificationEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rateLimit";

/**
 * FIX-RESET: строгая связка «логин ↔ почта».
 * Принимает email или username (допускается ведущий @). Логин всегда
 * резолвится в привязанную к аккаунту почту через БД; если пользователь не
 * найден — письмо не отправляется вовсе. Раньше ненайденный логин подставлялся
 * в поле email как есть, и код «отправлялся на логин», а не на почту.
 */
async function resolveEmail(rawInput: string): Promise<{ email: string | null; exists: boolean }> {
  const input = rawInput.trim().replace(/^@+/, "");
  if (input.includes("@")) {
    const user = await prisma.user.findUnique({ where: { email: input }, select: { id: true } });
    return { email: user ? input : null, exists: !!user };
  }
  // Логин → привязанная почта (та самая проверка связки «логин ↔ почта»).
  const user = await prisma.user.findUnique({ where: { username: input }, select: { email: true } });
  return { email: user?.email ?? null, exists: !!user };
}

/** Маскирует адрес для ответа клиенту: ab*****@domain.ru */
function maskEmail(addr: string): string {
  const [name, domain] = addr.split("@");
  if (!domain) return addr;
  return `${name.slice(0, 2)}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

const GENERIC_MESSAGE = "Если аккаунт существует, код отправлен на привязанную почту";

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "send-code", { limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  try {
    const { email, type } = await req.json();

    if (!email || !type) {
      return NextResponse.json({ error: "Email и тип обязательны" }, { status: 400 });
    }

    if (type !== "register" && type !== "login" && type !== "reset") {
      return NextResponse.json({ error: "Неверный тип" }, { status: 400 });
    }

    const rawInput = String(email);
    const resolved = await resolveEmail(rawInput);

    let targetEmail: string;
    if (type === "register") {
      // Регистрация: код уходит на новый адрес, он обязан быть email-ом.
      if (!rawInput.includes("@")) {
        return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
      }
      if (resolved.exists) {
        // Не раскрываем, что адрес уже занят.
        return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
      }
      targetEmail = rawInput.trim();
    } else {
      // login / reset: код отправляется ТОЛЬКО на почту, привязанную к аккаунту.
      if (!resolved.exists || !resolved.email) {
        return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
      }
      targetEmail = resolved.email;
    }

    const recentCode = await prisma.verificationCode.findFirst({
      where: {
        email: targetEmail,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recentCode) {
      return NextResponse.json(
        { error: "Подождите минуту перед повторной отправкой" },
        { status: 429 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const created = await prisma.verificationCode.create({
      data: { email: targetEmail, code, type, expiresAt },
    });

    const sent = await sendVerificationEmail(targetEmail, code, type);

    if (!sent) {
      /* FIX-SMTP: неотправленный код не должен занимать минутный интервал.
         Запись создаётся до отправки, а «Подождите минуту перед повторной
         отправкой» смотрит именно на неё — поэтому после сбоя почты человек
         получал сначала «не удалось отправить», а следом ещё и запрет
         повторить, не получив ни одного письма. */
      await prisma.verificationCode.delete({ where: { id: created.id } }).catch(() => {});
      return NextResponse.json(
        { error: "Не удалось отправить письмо. Проверьте настройки SMTP." },
        { status: 500 }
      );
    }

    // При регистрации пользователь сам ввёл адрес — показываем его полностью;
    // при login/reset показываем маскированную привязанную почту.
    const target = type === "register" ? targetEmail : maskEmail(targetEmail);
    return NextResponse.json({ ok: true, target, message: "Код отправлен на " + target });
  } catch (err) {
    console.error("[send-code] Error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
