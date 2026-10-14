import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "./prisma";
import { authenticateCredentials } from "./tzIdCredentials";
import { liveSession, revokeSessions } from "./tzIdSessions";

const BAN_CACHE_TTL = 30_000; // 30 seconds
// FIX-REPLAY: кэш хранит и isPremium — иначе при попадании в кэш сессия отдаёт
// устаревший флаг из JWT времён логина, и выданный Premium «не появляется»
// без перелогина.
const banCache = new Map<string, { banned: boolean; bannedUntil: string | null; banReason: string | null; role: string; isPremium: boolean; ts: number }>();

/**
 * FIX-SEC: отметка смены пароля дополняет авторитетную проверку UserSession.
 *
 * JWT живёт в подписанном cookie; его доступ также проверяется по sid в базе. Ранее смена пароля сама по себе
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
    ...(process.env.TZ_ID_CLIENT_ID && process.env.TZ_ID_CLIENT_SECRET ? [{
      id: "tz-id", name: "TZ ID", type: "oauth" as const,
      wellKnown: `${process.env.TZ_ID_ISSUER || "https://id.trioz.ru"}/.well-known/openid-configuration`,
      clientId: process.env.TZ_ID_CLIENT_ID, clientSecret: process.env.TZ_ID_CLIENT_SECRET,
      authorization: { params: { scope: "openid profile email" } },
      idToken: true, checks: ["pkce", "state", "nonce"] as ("pkce" | "state" | "nonce")[],
      async profile(claims: { sub: string }) {
        // Never merge by email or trust external role claims. Same immutable User.id only.
        const user = await prisma.user.findUnique({ where: { id: claims.sub } });
        if (!user || user.isDeleted || (user.banned && (!user.bannedUntil || user.bannedUntil > new Date()))) throw new Error("Account unavailable");
        const loginSession = await prisma.userSession.create({ data: { userId: user.id,
          token: `login-${crypto.randomUUID()}`, userAgent: "TrioZ · вход через TZ ID", expiresAt: new Date(Date.now() + 2 * 86400_000) } });
        return { id: user.id, sessionId: loginSession.id, name: user.name, email: user.email, image: user.avatar,
          username: user.username, role: user.role, isPremium: user.isPremium || user.role === "ADMIN",
          banned: false, bannedUntil: user.bannedUntil?.toISOString() || null, banReason: user.banReason,
          pwdAt: user.passwordChangedAt?.toISOString() || null };
      },
    }] : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email или Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        return authenticateCredentials(credentials, (req as { headers?: Record<string, unknown> } | undefined)?.headers);
      },
    }),
  ],
  events: { async signOut({ token }) { if (token?.id && token?.sid) await revokeSessions(token.id as string, token.sid as string); } },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { role: string; id: string; username: string; isPremium: boolean; banned: boolean; bannedUntil: string | null; banReason: string | null; pwdAt?: string | null };
        token.sid = (user as { sessionId?: string | null }).sessionId ?? null;
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
        if (!await liveSession(token.id as string, token.sid as string | null)) {
          delete (session as { user?: unknown }).user;
          session.expires = new Date(0).toISOString();
          return session;
        }
        session.user.sessionId = token.sid as string;
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
