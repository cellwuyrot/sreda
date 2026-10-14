import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import prisma from "./prisma";
import {
  isIdentityBlocked,
  recordIdentities,
  headerValue,
  cookieValue,
  DEVICE_COOKIE,
} from "./identity";
import { isRateLimited } from "./rateLimit";
import { clientIpFromHeaders } from "./clientIp";

/** One credential verifier for existing NextAuth and the TZ ID issuer. */
export async function authenticateCredentials(
  credentials: { email?: string; password?: string } | undefined,
  reqHeaders?: Record<string, unknown>,
  createSession = true,
) {
  if (
    !credentials?.email ||
    !credentials?.password ||
    credentials.email.length > 254 ||
    credentials.password.length > 128
  )
    return null;

  // НОВОЕ: остановка учётной записи по IP/устройству (MAC): вход с
  // заблокированного IP или устройства невозможен даже с другим аккаунтом.

  /* FIX-SEC: адрес берём из доверенного hop, а не из первого значения
           X-Forwarded-For: его присылает сам клиент, и одной строкой в запросе
           снималась и блокировка устройства, и лимит попыток (см. lib/clientIp.ts). */
  const clientIp = clientIpFromHeaders((name) => headerValue(reqHeaders, name));
  const clientDevice = cookieValue(
    headerValue(reqHeaders, "cookie"),
    DEVICE_COOKIE,
  );
  if (await isIdentityBlocked(clientIp, clientDevice)) {
    throw new Error("Действие учётной записи приостановлено");
  }

  const login = credentials.email.trim();
  const isEmail = login.includes("@");

  /* FIX-SEC: лимит на попытки входа в самом приложении.

           Раньше перебор пароля сдерживал только nginx. Любой запуск без него
           (локальный, другой балансировщик, обращение в порт приложения напрямую)
           оставался без лимита вовсе. Счёт двойной: по адресу — от перебора разных
           аккаунтов с одного источника, по логину — от перебора одного аккаунта
           с разных адресов. Окно 15 минут и десятки попыток — человеку, который
           забыл пароль, хватает с запасом. */
  const tooManyByIp = await isRateLimited("login-ip", clientIp, {
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  const tooManyByLogin = await isRateLimited(
    "login-account",
    login.toLowerCase(),
    {
      limit: 10,
      windowMs: 15 * 60 * 1000,
    },
  );
  if (tooManyByIp || tooManyByLogin) {
    throw new Error("Слишком много попыток входа. Попробуйте позже.");
  }

  const user = await prisma.user.findUnique({
    where: isEmail ? { email: login } : { username: login },
  });

  if (!user || user.isDeleted) return null;

  const isValid = await bcrypt.compare(credentials.password, user.password);
  if (!isValid) return null;

  const isBanned =
    user.banned &&
    (!user.bannedUntil || new Date(user.bannedUntil) > new Date());

  if (isBanned) {
    throw new Error(
      user.banReason
        ? `Вы заблокированы: ${user.banReason}`
        : "Ваш аккаунт заблокирован",
    );
  }

  // НОВОЕ: запоминаем IP/устройство — по ним сработает блокировка при бане
  void recordIdentities(user.id, clientIp, clientDevice).catch(() => undefined);

  // FIX-ADM2: фиксируем вход — сессия с IP и user-agent для админ-панели
  // (последние входы, IP устройства, активные сессии)
  const clientUa = headerValue(reqHeaders, "user-agent");
  const loginSession = createSession
    ? await prisma.userSession.create({
        data: {
          userId: user.id,
          ip: clientIp,
          userAgent: clientUa,
          token: `login-${randomBytes(32).toString("hex")}`,
          expiresAt: new Date(Date.now() + 2 * 86400_000),
        },
      })
    : null;

  return {
    id: user.id,
    sessionId: loginSession?.id ?? null,
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
    isPremium: user.isPremium || user.role === "ADMIN",
    image: user.avatar,
    banned: false,
    bannedUntil: user.bannedUntil?.toISOString() || null,
    banReason: user.banReason || null,
    /* FIX-SEC: слепок отметки смены пароля на момент входа: по нему сессия
             поймёт, что пароль сменили уже после выдачи токена. */
    pwdAt:
      (
        user as { passwordChangedAt?: Date | null }
      ).passwordChangedAt?.toISOString() || null,
  };
}
