import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import "dotenv/config";
import { liveSession } from "../../web/src/lib/tzIdSessions";
import { prisma } from "../../web/src/lib/prisma";
import { authenticateCredentials } from "../../web/src/lib/tzIdCredentials";
import {
  encryptTzData,
  decryptTzData,
  storageKey,
} from "../../web/src/lib/tzIdCrypto";
import { connectRedis, redis } from "../../web/src/lib/redis";
import { clientIpFromHeaders } from "../../web/src/lib/clientIp";
import { createProvider } from "./provider.mjs";
import { page, styles, portalStyles, escape } from "./views.mjs";
import { makePortal, qrSvg, qrWidget } from "./portal";
import { projectApi } from "./api";
import { bodyOf, checkCsrf, cookie, setCookie, json } from "./http";
import { startQr, qrStatus, consumeQr, qrSecret } from "../../web/src/lib/tzIdQr";
import { HubError, TZ_ID_SCOPE_LABELS } from "../../web/src/lib/tzIdHub";
import { isRateLimited } from "../../web/src/lib/rateLimit";

void connectRedis();
const issuer = process.env.TZ_ID_ISSUER || "https://id.trioz.ru";
const webOrigin = process.env.TZ_ID_WEB_ORIGIN || "https://trioz.ru";
if (
  issuer !== "https://id.trioz.ru" &&
  !(
    process.env.TZ_ID_DEV_ALLOW_HTTP === "1" &&
    new URL(issuer).protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(new URL(issuer).hostname)
  )
)
  throw new Error("Production issuer must be https://id.trioz.ru");
const cookieKeys = (process.env.TZ_ID_COOKIE_KEYS || "")
  .split(",")
  .filter(Boolean);
if (!cookieKeys.length || cookieKeys.some((key) => key.length < 32))
  throw new Error("Set strong TZ_ID_COOKIE_KEYS");
storageKey();
const info = new AsyncLocalStorage<{
  ip: string | null;
  userAgent: string | null;
}>();
const provider = createProvider({
  db: prisma,
  issuer,
  webOrigin,
  jwks: JSON.parse(
    readFileSync(process.env.TZ_ID_JWKS_FILE || "./secrets/jwks.json", "utf8"),
  ),
  cookieKeys,
  seal: encryptTzData,
  open: decryptTzData,
  requestInfo: () => info.getStore() || {},
});
provider.on("server_error", () =>
  console.error("TZ ID provider request failed"),
);
const secure = issuer.startsWith("https:");
function csrfCookie(uid: string) {
  return `${secure ? "__Secure-" : ""}tzid-csrf-${uid}`;
}
const scopeLabels = TZ_ID_SCOPE_LABELS;
const portal = makePortal({ issuer, webOrigin, ipOf: () => info.getStore()?.ip || "unknown" });
const callback = provider.callback();
const server = createServer((req, res) => {
  const ip =
    clientIpFromHeaders((name) => String(req.headers[name] ?? "")) ||
    req.socket.remoteAddress ||
    null;
  info.run({ ip, userAgent: req.headers["user-agent"] || null }, () => {
    void (async () => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("Cache-Control", "no-store");

      const url = new URL(req.url || "/", issuer);
      if (url.pathname === "/style.css") {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.end(styles + portalStyles);
        return;
      }
      if (url.pathname === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === "/logo.png") {
        res.setHeader("Content-Type", "image/png");
        res.end(readFileSync(new URL("../../web/public/logo.png", import.meta.url)));
        return;
      }
      if (url.pathname === "/portal.js") {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(readFileSync(new URL("./portal-browser.js", import.meta.url)));
        return;
      }
      if (await projectApi(req, res, provider, url.pathname)) return;
      if (await portal(req, res, url)) return;
      const match = /^\/interaction\/([A-Za-z0-9_-]+)(\/qr)?$/.exec(url.pathname);
      if (!match) {
        await callback(req, res);
        return;
      }
      const details = await provider.interactionDetails(req, res);
      if (details.uid !== match[1]) throw new Error("Interaction mismatch");
      const client = await prisma.tzIdClient.findUnique({
        where: { id: String(details.params.client_id) },
      });
      if (!client?.enabled) {
        res.statusCode = 400;
        res.end("Приложение недоступно");
        return;
      }
      // Chromium applies form-action to redirects after POST: allow only the validated RP origin.
      const rpOrigin = new URL(String(details.params.redirect_uri)).origin;
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; style-src 'self'; form-action 'self' ${rpOrigin}; frame-ancestors 'none'; base-uri 'none'`,
      );
      const uid = details.uid;
      let error = "";
      const qrCookie = `${secure ? "__Secure-" : ""}tzid-qr-${uid}`;
      if (match[2]) {
        try {
          if (req.method !== "POST" || details.prompt.name !== "login") throw new HubError("Запрос недоступен", 400);
          const input = await bodyOf(req);
          checkCsrf(req, input.csrf, csrfCookie(uid), new URL(issuer).origin);
          if (await isRateLimited("tz-id-interaction-qr", uid, { limit: 90, windowMs: 60_000 })) throw new HubError("Слишком много запросов", 429);
          const browser = cookie(req, qrCookie);
          if (input.action === "status") {
            if (!/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new HubError("QR-код истёк", 410);
            json(res, await qrStatus(String(input.id || ""), uid, browser));
          } else if (input.action === "start") {
            if (await isRateLimited("tz-id-qr-create", info.getStore()?.ip, { limit: 10, windowMs: 60_000 })) throw new HubError("Слишком много QR-кодов", 429);
            const proof = /^[A-Za-z0-9_-]{43}$/.test(browser) ? browser : qrSecret();
            const qr = await startQr(uid, client.id, proof);
            setCookie(res, qrCookie, proof, `/interaction/${uid}`, 120, secure);
            json(res, { id: qr.id, verificationCode: qr.verificationCode, expiresAt: qr.expiresAt, svg: qrSvg(`${issuer}/qr#code=${qr.approval}`) });
          } else throw new HubError("Неизвестное действие");
        } catch (e) { json(res, { error: e instanceof HubError ? e.message : "Не удалось создать QR-код" }, e instanceof HubError ? e.status : 500); }
        return;
      }
      if (req.method === "POST") {
        if (req.headers.origin !== new URL(issuer).origin) {
          res.statusCode = 403;
          res.end("Неверный источник запроса");
          return;
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 16384) {
            res.statusCode = 413;
            res.end();
            return;
          }
        }
        const body = new URLSearchParams(raw);
        const csrfValue =
          (req.headers.cookie || "")
            .split(";")
            .map((p) => p.trim())
            .find((p) => p.startsWith(csrfCookie(uid) + "="))
            ?.split("=")[1] || "";
        const token = body.get("csrf") || "";
        if (
          token.length !== 64 ||
          csrfValue.length !== token.length ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(csrfValue))
        ) {
          res.statusCode = 403;
          res.end("Запрос устарел. Обновите страницу.");
          return;
        }
        // Consume the form nonce before performing any mutating action.
        res.setHeader(
          "Set-Cookie",
          `${csrfCookie(uid)}=; Path=/interaction/${uid}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
        );
        if (body.get("action") === "qr-finish") {
          if (details.prompt.name !== "login") throw new Error("Invalid QR prompt");
          const browser = cookie(req, qrCookie);
          const userId = await consumeQr(body.get("id") || "", uid, browser);
          setCookie(res, qrCookie, "", `/interaction/${uid}`, 0, secure);
          await provider.interactionFinished(req, res, { login: { accountId: userId, amr: ["qr"] } }, { mergeWithLastSubmission: false });
          return;
        }
        if (body.get("action") === "deny") {
          await provider.interactionFinished(
            req,
            res,
            {
              error: "access_denied",
              error_description: "Пользователь отказал в доступе",
            },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        if (details.prompt.name === "login") {
          try {
            const user = await authenticateCredentials(
              {
                email: body.get("email") || "",
                password: body.get("password") || "",
              },
              req.headers,
              false,
            );
            if (!user) error = "Неверный логин или пароль";
            else {
              await provider.interactionFinished(
                req,
                res,
                { login: { accountId: user.id, amr: ["pwd"] } },
                { mergeWithLastSubmission: false },
              );
              return;
            }
          } catch {
            error =
              "Вход недоступен или превышен лимит попыток. Попробуйте позже.";
          }
        } else if (details.prompt.name === "consent") {
          const userId = details.session?.accountId;
          const session = await prisma.userSession.findUnique({
            where: { token: `oidc:${details.session?.uid}` },
          });
          if (!userId || !session || !(await liveSession(userId, session.id))) {
            res.statusCode = 401;
            res.end("Сеанс завершён. Начните вход заново.");
            return;
          }
          const grant = details.grantId
            ? await provider.Grant.find(details.grantId)
            : new provider.Grant({ accountId: userId, clientId: client.id });
          if (!grant) throw new Error("Grant unavailable");
          const missing = details.prompt.details;
          if (missing.missingOIDCScope)
            grant.addOIDCScope(missing.missingOIDCScope.join(" "));
          if (missing.missingOIDCClaims)
            grant.addOIDCClaims(missing.missingOIDCClaims);
          const grantId = await grant.save();
          await prisma.tzIdAuthorization.upsert({
            where: { id: grantId },
            create: {
              id: grantId,
              userId,
              clientId: client.id,
              sessionId: session.id,
              scopes: grant.getOIDCScope(),
            },
            update: {
              revokedAt: null,
              lastUsedAt: new Date(),
              scopes: grant.getOIDCScope(),
            },
          });
          await provider.interactionFinished(
            req,
            res,
            { consent: { grantId } },
            { mergeWithLastSubmission: true },
          );
          return;
        }
      }
      const csrf = randomBytes(32).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `${csrfCookie(uid)}=${csrf}; Path=/interaction/${uid}; Max-Age=600; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      );
      const field = `<input type="hidden" name="csrf" value="${csrf}">`;
      const content =
        details.prompt.name === "login"
          ? `<p>Вход для приложения <strong>${escape(client.name)}</strong>. Используйте ваш существующий аккаунт TrioZ.</p>${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}<form method="post">${field}<label for="email">Email или username</label><input id="email" name="email" autocomplete="username" required maxlength="254"><label for="password">Пароль</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="128"><button>Войти через TZ ID</button><button name="action" value="deny" class="secondary" formnovalidate>Отмена</button></form><p><a href="${escape(webOrigin)}/auth/signin">Регистрация и восстановление доступа</a></p>`
          : `<p><strong>${escape(client.name)}</strong> запрашивает доступ к вашему аккаунту:</p><p class="domain">${escape(rpOrigin)}</p><ul>${String(
              details.params.scope || "openid",
            )
              .split(" ")
              .map((scope) => `<li>${escape(scopeLabels[scope] || scope)}</li>`)
              .join(
                "",
              )}</ul><p>Пароль, переписка, платежи и VPN-ключи приложению не передаются.</p><form method="post">${field}<button>Разрешить доступ</button><button name="action" value="deny" class="secondary">Отказать</button></form>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        page(
          details.prompt.name === "login"
            ? "Вход в TZ ID"
            : "Разрешение доступа",
          content + (details.prompt.name === "login" ? qrWidget(csrf, `/interaction/${uid}/qr`, `/interaction/${uid}`) : ""),
        ),
      );
    })().catch(() => {
      console.error("TZ ID interaction request failed");
      if (!res.headersSent) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          page(
            "Запрос недоступен",
            "<p>Ссылка истекла или запрос некорректен. Вернитесь в приложение и начните вход заново.</p>",
          ),
        );
      } else res.end();
    });
  });
});
const cleanup = setInterval(() => {
  void prisma.tzIdQrLogin.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => console.error("TZ ID QR cleanup failed"));
  void prisma.tzIdArtifact
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => console.error("TZ ID cleanup failed"));
}, 3600_000);
cleanup.unref();
server.listen(Number(process.env.PORT || 3100), "127.0.0.1", () =>
  console.log(`TZ ID listening on loopback, issuer ${issuer}`),
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => {
    clearInterval(cleanup);
    server.close(() => {
      redis.disconnect();
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
