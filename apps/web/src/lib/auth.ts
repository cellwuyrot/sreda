import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import prisma from "./prisma";
import { isIdentityBlocked, recordIdentities, headerValue, cookieValue, DEVICE_COOKIE } from "./identity";

const BAN_CACHE_TTL = 30_000; // 30 seconds
// FIX-REPLAY: кэш хранит и isPremium — иначе при попадании в кэш сессия отдаёт
// устаревший флаг из JWT времён логина, и выданный Premium «не появляется»
// без перелогина.
const banCache = new Map<string, { banned: boolean; bannedUntil: string | null; banReason: string | null; role: string; isPremium: boolean; ts: number }>();

/** Clear immediately after a ban/unban/role update; do not wait for the TTL. */
export function invalidateUserAuthCache(userId: string): void {
  banCache.delete(`ban:${userId}`);
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
        const fwd = headerValue(reqHeaders, "x-forwarded-for");
        const clientIp = (fwd ? fwd.split(",")[0].trim() : null) || headerValue(reqHeaders, "x-real-ip");
        const clientDevice = cookieValue(headerValue(reqHeaders, "cookie"), DEVICE_COOKIE);
        if (await isIdentityBlocked(clientIp, clientDevice)) {
          throw new Error("Действие учётной записи приостановлено");
        }

        const login = credentials.email.trim();
        const isEmail = login.includes("@");

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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { role: string; id: string; username: string; isPremium: boolean; banned: boolean; bannedUntil: string | null; banReason: string | null };
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
  },
  secret: process.env.NEXTAUTH_SECRET,
};
