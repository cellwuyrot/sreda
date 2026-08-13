import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import prisma from "./prisma";
import { isIdentityBlocked, recordIdentities, headerValue, cookieValue, DEVICE_COOKIE } from "./identity";
import { isRateLimited } from "./rateLimit";
import { clientIpFromHeaders } from "./clientIp";

const BAN_CACHE_TTL = 30_000; // 30 seconds
// FIX-REPLAY: кэш хранит и isPremium — иначе при попадании в кэш сессия отдаёт
// устаревший флаг из JWT времён логина, и выданный Premium «не появляется»
// без перелогина.
const banCache = new Map<string, { banned: boolean; bannedUntil: string | null; banReason: string | null; role: string; isPremium: boolean; ts: number }>();

/**
 * FIX-SEC: отметка «пароль сменён» — единственный способ обесценить выданный JWT.
 *
 * Сессия живёт в подписанном cookie, а не в базе, поэтому смена пароля сама по себе
 * НИЧЕГО не меняла: украденный токен оставался рабочим до своего срока, и смысл
 * восстановления пароля терялся. Теперь в токен попадает момент последней смены
 * пароля, и если в базе она стала другой — сессия отдаётся пустой, и все проверки
 * вида `if (!session?.user)` на роутах дают 401.
 *
 * `undefined` от проверки означает «колонки ещё нет» (миграция не применена) — тогда
 * проверка просто не работает, вместо того чтобы выбить всех из аккаунтов.
 */
const PWD_CACHE_TTL = 30_000;
const pwdCache = new Map<string, { at: string | null; ts: number }>();

async function passwordChangedAtOf(userId: string): Promise<string | null | undefined> {
  const cached = pwdCache.get(userId);
  if (cached && Date.now() - cached.ts < PWD_CACHE_TTL) return cached.at;
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });
    const at = row?.passwordChangedAt ? row.passwordChangedAt.toISOString() : null;
    pwdCache.set(userId, { at, ts: Date.now() });
    return at;
  } catch {
    return undefined;
  }
}

/** Clear immediately after a ban/unban/role update; do not wait for the TTL. */
export function invalidateUserAuthCache(userId: string): void {
  banCache.delete(`ban:${userId}`);
  pwdCache.delete(userId);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email или Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // НОВОЕ: остановка учётной записи по IP/устройству (MAC): вход с
        // заблокированного IP или устройства невозможен даже с другим аккаунтом.
        const reqHeaders = (req as { headers?: Record<string, unknown> } | undefined)?.headers;
        /* FIX-SEC: адрес берём из доверенного hop, а не из первого значения
           X-Forwarded-For: его присылает сам клиент, и одной строкой в запросе
           снималась и блокировка устройства, и лимит попыток (см. lib/clientIp.ts). */
        const clientIp = clientIpFromHeaders((name) => headerValue(reqHeaders, name));
        const clientDevice = cookieValue(headerValue(reqHeaders, "cookie"), DEVICE_COOKIE);
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
        const tooManyByLogin = await isRateLimited("login-account", login.toLowerCase(), {
          limit: 10,
          windowMs: 15 * 60 * 1000,
        });
        if (tooManyByIp || tooManyByLogin) {
          throw new Error("Слишком много попыток входа. Попробуйте позже.");
        }

        const user = await prisma.user.findUnique({
          where: isEmail ? { email: login } : { username: login },
        });

        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        const isBanned = user.banned && (!user.bannedUntil || new Date(user.bannedUntil) > new Date());

        if (isBanned) {
          throw new Error(user.banReason ? `Вы заблокированы: ${user.banReason}` : "Ваш аккаунт заблокирован");
        }

        // НОВОЕ: запоминаем IP/устройство — по ним сработает блокировка при бане
        void recordIdentities(user.id, clientIp, clientDevice).catch(() => undefined);

        // FIX-ADM2: фиксируем вход — сессия с IP и user-agent для админ-панели
        // (последние входы, IP устройства, активные сессии)
        const clientUa = headerValue(reqHeaders, "user-agent");
        void prisma.userSession
          .create({
            data: {
              userId: user.id,
              ip: clientIp,
              userAgent: clientUa,
              // FIX-SEC: криптостойкий идентификатор сессии вместо Math.random().
              token: `login-${user.id}-${randomBytes(24).toString("hex")}`,
            },
          })
          .catch(() => undefined);

        return {
          id: user.id,
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
          pwdAt: (user as { passwordChangedAt?: Date | null }).passwordChangedAt?.toISOString() || null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { role: string; id: string; username: string; isPremium: boolean; banned: boolean; bannedUntil: string | null; banReason: string | null; pwdAt?: string | null };
        token.pwdAt = u.pwdAt ?? null;
        token.role = u.role;
        token.id = u.id;
        token.username = u.username;
        token.isPremium = u.isPremium;
        token.banned = u.banned;
        token.bannedUntil = u.bannedUntil;
        token.banReason = u.banReason;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        /* FIX-SEC: смена пароля завершает все старые сессии. Пустая сессия с
           истёкшим сроком — это ровно то, как выглядит выход из аккаунта: клиент
           удаляет cookie сам, а все роуты видят отсутствие пользователя и отвечают 401. */
        const currentPwdAt = await passwordChangedAtOf(token.id as string);
        if (currentPwdAt !== undefined && currentPwdAt !== ((token.pwdAt as string | null | undefined) ?? null)) {
          delete (session as { user?: unknown }).user;
          session.expires = new Date(0).toISOString();
          return session;
        }
        const u = session.user as { role: string; id: string; username: string; isPremium: boolean; banned: boolean; bannedUntil: string | null; banReason: string | null };
        u.role = token.role as string;
        u.id = token.id as string;
        u.username = token.username as string;
        u.isPremium = (token.isPremium as boolean | undefined) ?? false;

        // Fetch fresh ban status — use lightweight cache to avoid DB hit per request
        const cacheKey = `ban:${token.id}`;
        const cached = banCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < BAN_CACHE_TTL) {
          u.banned = cached.banned;
          u.bannedUntil = cached.bannedUntil;
          u.banReason = cached.banReason;
          u.role = cached.role;
          token.role = cached.role;
          u.isPremium = cached.isPremium; // FIX-REPLAY: свежий флаг из БД, а не из старого токена
          token.isPremium = cached.isPremium;
        } else {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { banned: true, bannedUntil: true, banReason: true, isPremium: true, role: true },
          });
          if (dbUser) {
            const isBanned = dbUser.banned && (!dbUser.bannedUntil || new Date(dbUser.bannedUntil) > new Date());
            u.banned = isBanned;
            u.bannedUntil = dbUser.bannedUntil?.toISOString() || null;
            u.banReason = dbUser.banReason || null;
            u.isPremium = dbUser.isPremium || dbUser.role === "ADMIN";
            u.role = dbUser.role;
            token.role = dbUser.role;
            token.isPremium = u.isPremium;
            banCache.set(cacheKey, { banned: isBanned, bannedUntil: u.bannedUntil, banReason: u.banReason, role: dbUser.role, isPremium: u.isPremium, ts: Date.now() });
          } else {
            u.banned = token.banned as boolean;
            u.bannedUntil = token.bannedUntil as string | null;
            u.banReason = token.banReason as string | null;
          }
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
    /* FIX-SEC: раньше работал срок по умолчанию — 30 дней. Для мессенджера с
       личной перепиской это слишком долго: украденный токен живёт месяц.
       Два дня с продлением раз в час — активный человек не заметит выхода,
       а забытая сессия перестанет быть ключом к аккаунту. */
    maxAge: 60 * 60 * 24 * 2,
    updateAge: 60 * 60,
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 2,
  },
  /* FIX-SEC: под HTTPS cookie сессии получает признак Secure и префикс __Secure-.
     NextAuth решает это по NODE_ENV, а за прокси бывает и production без TLS, и
     HTTPS в не-production. Надёжнее смотреть на сам адрес установки. */
  useSecureCookies: (process.env.NEXTAUTH_URL || "").startsWith("https://"),
  secret: process.env.NEXTAUTH_SECRET,
};
