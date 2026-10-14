import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { prisma } from "../../web/src/lib/prisma";
import { authenticateCredentials } from "../../web/src/lib/tzIdCredentials";
import { liveSession, revokeSessions } from "../../web/src/lib/tzIdSessions";
import { decryptTzData, encryptTzData } from "../../web/src/lib/tzIdCrypto";
import {
  hubSnapshot,
  updateHub,
  HubError,
  TZ_ID_SCOPE_LABELS,
} from "../../web/src/lib/tzIdHub";
import {
  startQr,
  qrForApproval,
  approveQr,
  qrStatus,
  consumeQr,
  qrSecret,
  qrHash,
} from "../../web/src/lib/tzIdQr";
import { isRateLimited } from "../../web/src/lib/rateLimit";
import { bodyOf, cookie, setCookie, checkCsrf, json } from "./http";
import { escape } from "./views.mjs";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const sections = {
  profile: "Профиль",
  security: "Безопасность",
  subscriptions: "Подписки",
  applications: "Сервисы и сайты",
  addresses: "Адреса",
  notifications: "Уведомления",
  cooperation: "Сотрудничество",
};
type Session = { userId: string; sessionId: string };
export function qrSvg(url: string) {
  return renderToStaticMarkup(
    createElement(QRCodeSVG, {
      value: url,
      size: 220,
      level: "M",
      marginSize: 4,
    }),
  );
}
export function qrWidget(csrf: string, start: string, finish: string) {
  return `<section class="qr-widget" data-start="${escape(start)}" data-finish="${escape(finish)}" data-csrf="${csrf}"><h2>Вход по QR-коду</h2><p>Откройте QR на телефоне, где вы вошли в TZ ID. Сверьте код и подтвердите вход только на своём устройстве.</p><button type="button" class="secondary qr-start">Показать QR-код</button><div class="qr-result" aria-live="polite"></div></section><script src="/portal.js" defer></script>`;
}
export function makePortal({
  issuer,
  webOrigin,
  ipOf,
}: {
  issuer: string;
  webOrigin: string;
  ipOf(req: IncomingMessage): string;
}) {
  const secure = issuer.startsWith("https:");
  const prefix = secure ? "__Host-" : "";
  const sessionCookie = prefix + "tzid-portal";
  const csrfCookie = prefix + "tzid-csrf";
  const qrCookie = prefix + "tzid-qr";
  async function sessionOf(req: IncomingMessage): Promise<Session | null> {
    const secret = cookie(req, sessionCookie);
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const row = await prisma.tzIdArtifact.findUnique({
      where: { key: hash(`PortalSession:${secret}`) },
    });
    if (!row || row.model !== "PortalSession" || row.expiresAt <= new Date())
      return null;
    const session = decryptTzData<Session>(row.payload);
    return (await liveSession(session.userId, session.sessionId))
      ? session
      : null;
  }
  async function establish(
    userId: string,
    res: ServerResponse,
    req: IncomingMessage,
    sessionId?: string,
  ) {
    if (!sessionId) {
      const row = await prisma.userSession.create({
        data: {
          userId,
          token: `portal:${qrSecret()}`,
          ip: ipOf(req),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 1000),
          expiresAt: new Date(Date.now() + 2 * 86400_000),
        },
      });
      sessionId = row.id;
    }
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { token: `portal:${qrSecret()}` },
    });
    const secret = qrSecret();
    await prisma.tzIdArtifact.create({
      data: {
        key: hash(`PortalSession:${secret}`),
        model: "PortalSession",
        payload: encryptTzData({ userId, sessionId }),
        expiresAt: new Date(Date.now() + 2 * 86400_000),
      },
    });
    setCookie(res, sessionCookie, secret, "/", 172800, secure);
  }
  const redirect = (res: ServerResponse, location: string) => {
    res.statusCode = 303;
    res.setHeader("Location", location);
    res.end();
  };
  const frame = (title: string, content: string, sidebar = "") =>
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · TZ ID</title><link rel="stylesheet" href="/style.css"></head><body class="portal-body"><div class="portal-shell"><header class="portal-header"><a class="brand" href="/"><img src="/logo.png" alt="TrioZ" width="40" height="40"> TZ <strong>ID</strong></a><a href="${escape(webOrigin)}/tz-id">Открыть в TrioZ</a></header><div class="portal-layout">${sidebar}<main class="portal-main"><h1>${escape(title)}</h1>${content}</main></div><footer>Один аккаунт. Ваши проекты.</footer></div></body></html>`;
  return async function handlePortal(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) {
    const path = url.pathname;
    if (
      ![
        "/",
        "/login",
        "/qr",
        "/api/portal/hub",
        "/api/portal/action",
        "/api/portal/qr/start",
        "/api/portal/qr/status",
        "/api/portal/qr/inspect",
        "/api/portal/qr/approve",
        "/api/portal/qr/finish",
      ].includes(path)
    )
      return false;
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; img-src 'self' ${new URL(webOrigin).origin}; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    try {
      const session = await sessionOf(req);
      if (req.method !== "GET" && req.method !== "POST")
        throw new HubError("Метод не поддерживается", 405);
      if (req.method === "POST") {
        const body = await bodyOf(req);
        checkCsrf(req, body.csrf, csrfCookie, new URL(issuer).origin);
        if (
          await isRateLimited("tz-id-portal", ipOf(req), {
            limit: 60,
            windowMs: 60_000,
          })
        )
          throw new HubError("Слишком много запросов", 429);
        if (path === "/login") {
          const user = await authenticateCredentials(
            {
              email: String(body.email || ""),
              password: String(body.password || ""),
            },
            req.headers,
          );
          if (!user?.sessionId)
            throw new HubError("Неверный логин или пароль", 401);
          await establish(user.id, res, req, user.sessionId);
          redirect(res, body.next === "/qr" ? "/qr" : "/");
          return true;
        }
        if (path === "/api/portal/qr/start") {
          if (
            await isRateLimited("tz-id-qr-create", ipOf(req), {
              limit: 10,
              windowMs: 60_000,
            })
          )
            throw new HubError("Слишком много QR-кодов", 429);
          let browser = cookie(req, qrCookie);
          if (!/^[A-Za-z0-9_-]{43}$/.test(browser)) browser = qrSecret();
          const qr = await startQr(`portal:${qrHash(browser)}`, null, browser);
          setCookie(res, qrCookie, browser, "/", 120, secure);
          json(res, {
            id: qr.id,
            verificationCode: qr.verificationCode,
            expiresAt: qr.expiresAt,
            svg: qrSvg(`${issuer}/qr#code=${qr.approval}`),
          });
          return true;
        }
        if (
          path === "/api/portal/qr/status" ||
          path === "/api/portal/qr/finish"
        ) {
          const browser = cookie(req, qrCookie);
          if (!/^[A-Za-z0-9_-]{43}$/.test(browser))
            throw new HubError("QR-код истёк", 410);
          if (path.endsWith("status"))
            json(
              res,
              await qrStatus(
                String(body.id || ""),
                `portal:${qrHash(browser)}`,
                browser,
              ),
            );
          else {
            const userId = await consumeQr(
              String(body.id || ""),
              `portal:${qrHash(browser)}`,
              browser,
            );
            await establish(userId, res, req);
            setCookie(res, qrCookie, "", "/", 0, secure);
            redirect(res, "/");
          }
          return true;
        }
        if (!session) throw new HubError("Войдите в TZ ID", 401);
        if (path === "/api/portal/qr/inspect") {
          const qr = await qrForApproval(String(body.code || ""));
          const client = qr.clientId
            ? await prisma.tzIdClient.findUnique({ where: { id: qr.clientId } })
            : null;
          const metadata = client
            ? decryptTzData<{ redirect_uris: string[] }>(client.metadata)
            : null;
          json(res, {
            project: client?.name || "Кабинет TZ ID",
            domains: metadata?.redirect_uris.map((u) => new URL(u).origin) || [
              issuer,
            ],
            verificationCode: qr.verificationCode,
            expiresAt: qr.expiresAt,
          });
          return true;
        }
        if (path === "/api/portal/qr/approve") {
          await approveQr(
            String(body.code || ""),
            session.userId,
            session.sessionId,
            String(body.verificationCode || ""),
            body.deny === true,
          );
          json(res, { ok: true });
          return true;
        }
        if (path === "/api/portal/action") {
          if (body.action === "logout") {
            await revokeSessions(session.userId, session.sessionId);
            setCookie(res, sessionCookie, "", "/", 0, secure);
            redirect(res, "/login");
          } else {
            await updateHub(session.userId, {
              ...body,
              ...(body.action === "notifications"
                ? { enabled: body.enabled === "true" || body.enabled === true }
                : {}),
            });
            redirect(
              res,
              `/?section=${Object.hasOwn(sections, String(body.section)) ? body.section : "profile"}`,
            );
          }
          return true;
        }
        throw new HubError("Маршрут не найден", 404);
      }
      const csrf = randomBytes(32).toString("hex");
      setCookie(res, csrfCookie, csrf, "/", 600, secure);
      const field = `<input type="hidden" name="csrf" value="${csrf}">`;
      if (path === "/api/portal/hub") {
        if (!session) throw new HubError("Войдите в TZ ID", 401);
        json(res, await hubSnapshot(session.userId));
        return true;
      }
      if (path === "/qr") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          frame(
            "Подтверждение входа",
            `<section id="qr-approve" data-csrf="${csrf}" data-authenticated="${Boolean(session)}"><p>Подтверждайте вход только если сами открыли QR-код на другом устройстве. После подтверждения приложение отдельно запросит разрешение на данные.</p><div class="qr-result" aria-live="polite"></div><a class="button secondary" href="/login?next=qr">Войти в TZ ID на этом телефоне</a></section><script src="/portal.js" defer></script>`,
          ),
        );
        return true;
      }
      if (!session || path === "/login") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          frame(
            "Вход в TZ ID",
            `<section class="panel"><p>Используйте существующий аккаунт TrioZ. Регистрация в TrioZ уже создаёт ваш TZ ID.</p><form method="post" action="/login">${field}<input type="hidden" name="next" value="${url.searchParams.get("next") === "qr" ? "/qr" : "/"}"><label>Email или ник<input name="email" autocomplete="username" required maxlength="254"></label><label>Пароль<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button>Войти</button></form><a class="text-link" href="${escape(webOrigin)}/auth/signin">Регистрация и восстановление доступа</a></section>${qrWidget(csrf, "/api/portal/qr/start", "/api/portal/qr/finish")}`,
          ),
        );
        return true;
      }
      const snapshot = await hubSnapshot(session.userId);
      const user = snapshot.profile;
      if (!user) throw new HubError("Профиль не найден", 404);
      const section = Object.hasOwn(
        sections,
        url.searchParams.get("section") || "",
      )
        ? (url.searchParams.get("section") as keyof typeof sections)
        : "profile";
      const form = (action: string, content: string) =>
        `<form method="post" action="/api/portal/action">${field}<input type="hidden" name="action" value="${action}"><input type="hidden" name="section" value="${section}">${content}</form>`;
      const subscriptions = snapshot.subscriptions
        .map(
          (s) =>
            `<article class="panel"><p class="eyebrow">${escape(s.projectName)}${s.projectEnabled ? "" : " · проект отключён"}</p><h2>${escape(s.title)}</h2><p>${escape(({ active: "Активна", inactive: "Не подключена", expired: "Истекла", canceled: "Отменена" } as Record<string, string>)[s.status] || s.status)}${s.expiresAt ? " · до " + new Date(s.expiresAt).toLocaleDateString("ru-RU") : s.status === "active" ? " · без указанного срока" : ""}</p></article>`,
        )
        .join("");
      const project = url.searchParams.get("project") || "";
      const notifications =
        snapshot.notifications
          .filter((n) => !project || n.projectId === project)
          .map(
            (n) =>
              `<article class="panel"><p class="eyebrow">${escape(n.projectName)} · ${new Date(n.createdAt).toLocaleString("ru-RU")}</p><h2>${escape(n.title)}</h2><p class="pre-wrap">${escape(n.body)}</p>${n.url ? `<a href="${escape(n.url)}" rel="noopener noreferrer">Открыть проект</a>` : ""}${n.read ? "<p>Прочитано</p>" : form("read", `<input type="hidden" name="id" value="${n.id}"><button class="secondary">Отметить прочитанным</button>`)}</article>`,
          )
          .join("") || "<div class=panel><p>Уведомлений пока нет.</p></div>";
      const applications =
        snapshot.applications
          .map(
            (a) =>
              `<article class="panel"><h2>${escape(a.name)}</h2><p>${a.scopes.map((s) => escape(TZ_ID_SCOPE_LABELS[s] || s)).join(" · ")}</p>${form("notifications", `<input type="hidden" name="clientId" value="${a.id}"><input type="hidden" name="enabled" value="${!a.notificationsEnabled}"><button class="secondary">${a.notificationsEnabled ? "Отключить" : "Включить"} уведомления</button>`)}${form("disconnect", `<input type="hidden" name="clientId" value="${a.id}"><label class="check"><input type="checkbox" required> Подтверждаю отзыв доступа</label><button class="secondary">Отключить проект</button>`)}</article>`,
          )
          .join("") ||
        "<div class=panel><p>Проекты появятся после входа через TZ ID и вашего согласия.</p></div>";
      let avatar = "";
      if (user.avatar) {
        try {
          const u = new URL(user.avatar, webOrigin);
          if (
            u.origin === new URL(webOrigin).origin &&
            ["http:", "https:"].includes(u.protocol)
          )
            avatar = `<img class="profile-avatar" src="${escape(u.href)}" alt="Аватар пользователя" width="64" height="64">`;
        } catch {
          /* Legacy avatar fallback. */
        }
      }
      const content =
        section === "profile"
          ? `<section class="panel"><p class="eyebrow">Один аккаунт · TrioZ</p>${avatar}<h2>${escape(user.name)}</h2><p>@${escape(user.username)}</p><p class="identifier">TZ ID: ${escape(user.id)}</p><p>${escape(user.email)} · ${user.emailVerified ? "Email подтверждён" : "Email не подтверждён"}</p></section><section class="panel"><h2>Имя и ник</h2>${form("profile", `<label>Имя<input name="name" value="${escape(user.name)}" minlength="2" maxlength="50" required></label><label>Ник<input name="username" value="${escape(user.username)}" maxlength="50" required></label><p>Действуют текущие правила TrioZ для смены ника. Все проекты получают данные одного профиля.</p><button>Сохранить</button>`)}<a class="text-link" href="${escape(webOrigin)}/settings?section=tzid">Изменить аватар и email в TrioZ</a></section>`
          : section === "addresses"
            ? `<section class="panel"><h2>Контактный адрес</h2><p>Необязательно. Укажите удобный способ связи или адрес. Передача проектам — только с отдельным разрешением.</p>${form("profile", `<label>Контактный адрес<textarea name="contactAddress" maxlength="500" rows="4">${escape(user.contactAddress || "")}</textarea></label><button>Сохранить</button>`)}</section>`
            : section === "subscriptions"
              ? `<p>Подписки внешних проектов не включают Premium или VPN в TrioZ. Оплата остаётся в соответствующем проекте.</p><div class="cards">${subscriptions}</div><a class="button secondary" href="${escape(webOrigin)}/settings?section=premium">Управлять подписками TrioZ</a>`
              : section === "applications"
                ? applications
                : section === "notifications"
                  ? `<p>Последние 100 уведомлений от подключённых проектов. Это центр уведомлений, не замена переписке.</p><form method="get"><input type="hidden" name="section" value="notifications"><label>Проект<select name="project"><option value="">Все проекты</option>${[...new Map(snapshot.notifications.map((n) => [n.projectId, n.projectName])).entries()].map(([id, name]) => `<option value="${id}"${project === id ? " selected" : ""}>${escape(name)}</option>`).join("")}</select></label><button class="secondary">Показать</button></form>${notifications}`
                  : section === "security"
                    ? `<section class="panel"><h2>Вход по QR-коду</h2><p>При входе в подключённый проект выберите QR-код и подтвердите запрос на телефоне. Всегда сверяйте название проекта и шестизначный код.</p></section><section class="panel"><h2>Двухфакторная аутентификация</h2><p>Пока недоступна. Защита 2FA не включена; раздел подготовлен для следующего этапа.</p></section><a class="button secondary" href="${escape(webOrigin)}/settings?section=security">Пароль и сеансы в TrioZ</a>`
                    : `<section class="panel"><h2>Сотрудничество с TrioZ</h2><p>Та же форма заявки, что в главном сообществе TZ.Connect. Заявка попадёт в существующие обращения и деловой чат.</p><a class="button" href="${escape(webOrigin)}/tz-id?section=cooperation">Открыть форму сотрудничества</a></section>`;
      const sidebar = `<aside class="portal-nav"><p class="eyebrow">Ваш TZ ID</p><nav>${Object.entries(
        sections,
      )
        .map(
          ([key, title]) =>
            `<a href="/?section=${key}"${section === key ? ' aria-current="page"' : ""}>${title}</a>`,
        )
        .join(
          "",
        )}</nav>${form("logout", "<button class=secondary>Выйти из TZ ID</button>")}</aside>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(frame(sections[section], content, sidebar));
    } catch (e) {
      if (
        path.startsWith("/api/") &&
        req.headers["content-type"]?.startsWith("application/json")
      )
        json(
          res,
          {
            error:
              e instanceof HubError ? e.message : "Сервис временно недоступен",
          },
          e instanceof HubError ? e.status : 500,
        );
      else {
        res.statusCode = e instanceof HubError ? e.status : 500;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          frame(
            "Не удалось выполнить запрос",
            `<section class="panel"><p role="alert">${escape(e instanceof HubError ? e.message : "Сервис временно недоступен")}</p><a class="button secondary" href="${path === "/login" ? "/login" : "/"}">Вернуться</a></section>`,
          ),
        );
      }
    }
    return true;
  };
}
