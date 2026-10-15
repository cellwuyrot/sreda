import Provider from "oidc-provider";
import { makeAdapter } from "./adapter.mjs";
import { page } from "./views.mjs";
/** Only identity claims. Application roles, VPN and private social data never become claims. */
export function accountClaims(user, origin) {
  let picture;
  if (user.avatar) {
    try {
      const avatar = new URL(user.avatar, origin);
      if (["https:", "http:"].includes(avatar.protocol)) picture = avatar.href;
    } catch {
      /* A legacy bad avatar must not break authentication. */
    }
  }
  return {
    sub: user.id,
    name: user.name,
    preferred_username: user.username,
    picture,
    email: user.email,
    email_verified: !!user.emailVerified,
  };
}
export function createProvider({
  db,
  issuer,
  jwks,
  cookieKeys,
  seal,
  open,
  requestInfo,
  webOrigin,
}) {
  const provider = new Provider(issuer, {
    adapter: makeAdapter(db, { seal, open, requestInfo }),
    clients: [],
    jwks,
    cookies: {
      keys: cookieKeys,
      long: {
        secure: issuer.startsWith("https:"),
        httpOnly: true,
        sameSite: "lax",
      },
      short: {
        secure: issuer.startsWith("https:"),
        httpOnly: true,
        sameSite: "lax",
      },
    },

    clientBasedCORS(ctx, origin, client) {
      return (
        origin !== "null" &&
        (ctx.oidc.route === "userinfo" || client.clientAuthMethod === "none") &&
        client.redirectUris.some((uri) => new URL(uri).origin === origin)
      );
    },
    claims: {
      openid: ["sub"],
      profile: ["name", "preferred_username", "picture"],
      email: ["email", "email_verified"],
    },
    scopes: ["openid", "profile", "email", "offline_access", "roles:read", "contact:read", "subscriptions:read", "subscriptions:write", "notifications:write"],
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        logoutSource(ctx, form) {
          ctx.type = "html";
          ctx.body = page(
            "Выйти из TZ ID?",
            `<p>Завершить этот сеанс TZ ID и отозвать связанный доступ приложений?</p>${form}<button type="submit" form="op.logoutForm" name="logout" value="yes">Выйти из TZ ID</button><button class="secondary" type="submit" form="op.logoutForm">Отмена</button>`,
          );
        },
        postLogoutSuccessSource(ctx) {
          ctx.type = "html";
          ctx.body = page(
            "Сеанс завершён",
            "<p>Вы вышли из TZ ID. Сеансы самих внешних приложений управляются этими приложениями.</p>",
          );
        },
      },
    },
    pkce: { required: () => true },
    rotateRefreshToken: true,
    ttl: {
      AccessToken: 300,
      AuthorizationCode: 60,
      IdToken: 300,
      Interaction: 600,
      RefreshToken: 30 * 86400,
      Session: 2 * 86400,
      Grant: 30 * 86400,
    },
    routes: {
      authorization: "/authorize",
      token: "/token",
      userinfo: "/userinfo",
      jwks: "/jwks",
      revocation: "/revoke",
      introspection: "/introspect",
    },
    renderError(ctx) {
      ctx.type = "html";
      ctx.body = page(
        "Не удалось выполнить вход",
        "<p>Запрос истёк или некорректен. Вернитесь в приложение и начните вход заново.</p>",
      );
    },
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    async findAccount(_ctx, id) {
      const user = await db.user.findUnique({ where: { id } });
      if (
        !user ||
        user.isDeleted ||
        (user.banned && (!user.bannedUntil || user.bannedUntil > new Date()))
      )
        return undefined;
      return {
        accountId: id,
        async claims() {
          return accountClaims(user, webOrigin);
        },
      };
    },
  });
  provider.use(async (ctx, next) => {
    await next();
    // The library destroys the session only for full RP-initiated logout, not cookie rotation.
    const session = ctx.oidc?.session;
    if (session?.destroyed && session.uid && session.accountId) {
      await db.userSession.updateMany({
        where: { userId: session.accountId, token: `oidc:${session.uid}` },
        data: { active: false },
      });
      await db.tzIdAuthorization.updateMany({
        where: {
          userId: session.accountId,
          session: { token: `oidc:${session.uid}` },
        },
        data: { revokedAt: new Date() },
      });
    }
  });
  provider.proxy = true;
  return provider;
}
