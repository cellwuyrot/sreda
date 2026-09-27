import nodemailer from "nodemailer";
import { randomInt } from "crypto";
import prisma from "./prisma";
import { sendFromMailbox } from "./mailSmtp";
import { mailboxAddress } from "./projectMail";
import { buildVerificationMail, type VerificationMailType } from "./verificationMail";

/**
 * Обычные системные уведомления TrioZ могут уходить через собственный
 * почтовый сервис. Коды подтверждения аккаунта — отдельный внутренний
 * mailbox-поток через noreply@trioz.ru, тот же, что используется ручной
 * отправкой из админки.
 *
 * Сервис делает то, чего у прямого подключения нет и не будет: держит список
 * relay-провайдеров с приоритетами и переключается на следующий, если первый
 * не отвечает; подписывает письма DKIM; ведёт журнал отправок; шлёт вебхуки о
 * судьбе письма. Для приложения это один HTTP-запрос вместо TCP-сессии с
 * авторизацией, а вся почтовая механика живёт там, где ей и место.
 *
 * ── Что нужно задать ──────────────────────────────────────────────────────
 *
 *   SMTP_SERVICE_URL   адрес сервиса, например https://smtp.trioz.ru
 *   SMTP_SERVICE_KEY   ключ сайта из админки сервиса (Сайты → API ключ), sm_…
 *   SMTP_FROM          необязательно: адрес отправителя для обычных системных писем
 *
 * `SMTP_FROM` относится только к обычным системным письмам через relay.
 * Коды подтверждения всегда идут через noreply@trioz.ru и не зависят от
 * SMTP_SERVICE_*.
 *
 * Ключ обязан оставаться на сервере. Попав в браузер, он позволит любому
 * посетителю рассылать письма от имени домена.
 *
 * ── Прямой SMTP остался запасным путём ────────────────────────────────────
 *
 * Если `SMTP_SERVICE_URL` и `SMTP_SERVICE_KEY` не заданы, работает прежняя
 * отправка через nodemailer по `SMTP_HOST`. Это нужно и для установок, которые
 * ещё не переехали, и на случай, когда сервис поднят как обычный SMTP-релей.
 */

const REQUEST_TIMEOUT_MS = 15000;

const serviceUrl = (process.env.SMTP_SERVICE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SMTP_SERVICE_KEY || "";
const useService = Boolean(serviceUrl && serviceKey);

/* ── Сервис: кто мы для него ─────────────────────────────────────────────── */

interface SiteInfo {
  /** Домен, от имени которого ключу разрешено отправлять. `null` у глобального ключа. */
  domain: string | null;
  senderEmail: string;
  isActive: boolean;
  hasRelay: boolean;
  dkimConfigured: boolean;
}

/**
 * `GET /api/me` — то же, что показывает экран «подключить сервис»: 401 значит
 * неверный ключ, 200 приносит домен, отправителя и состояние DKIM. Ответ
 * намеренно не содержит секретов, поэтому его можно писать в лог целиком.
 *
 * Запрос делается один раз при старте и переиспользуется: он же прогревает
 * `senderEmail`, который нужен для поля «от кого».
 */
let sitePromise: Promise<SiteInfo | null> | null = null;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name === "AbortError" ? "таймаут запроса" : error.message;
  return String(error);
}

/** FastAPI кладёт причину в `detail` — строкой либо списком ошибок валидации. */
async function readDetail(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      return JSON.stringify(detail);
    }
    return JSON.stringify(data);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

/**
 * Запрос к сервису. Таймаут обязателен: без него зависший сервис держал бы
 * запрос регистрации до таймаута самого Next, а человек всё это время смотрел
 * бы на крутящуюся кнопку.
 */
async function request(path: string, body?: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { Authorization: `Bearer ${serviceKey}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(`${serviceUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSiteInfo(): Promise<SiteInfo | null> {
  try {
    const res = await request("/api/me");
    if (res.status === 401) {
      console.error("[email] сервис не принял ключ — проверьте SMTP_SERVICE_KEY (Сайты → API ключ)");
      return null;
    }
    if (!res.ok) {
      console.error(`[email] сервис ответил ${res.status} на /api/me: ${await readDetail(res)}`);
      return null;
    }
    const data = (await res.json()) as {
      type?: string;
      site?: {
        domain?: string;
        sender_email?: string;
        is_active?: boolean;
        has_relay?: boolean;
        dkim_configured?: boolean;
      } | null;
    };
    const site = data.site;
    const info: SiteInfo = {
      domain: site?.domain ?? null,
      senderEmail: site?.sender_email ?? "",
      isActive: site?.is_active ?? true,
      hasRelay: site?.has_relay ?? false,
      dkimConfigured: site?.dkim_configured ?? false,
    };

    if (data.type === "global") {
      /* Глобальный ключ не привязан к сайту, поэтому отправителя вывести
         неоткуда — его обязан задать SMTP_FROM, иначе сервис ответит 403. */
      console.log(`[email] сервис ${serviceUrl}: глобальный ключ, домен берётся из SMTP_FROM`);
      if (!process.env.SMTP_FROM) {
        console.error("[email] глобальный ключ без SMTP_FROM — сервис не поймёт, от какого домена слать");
      }
      return info;
    }

    console.log(
      `[email] сервис ${serviceUrl}: домен ${info.domain}, отправитель ${info.senderEmail}, ` +
        `DKIM ${info.dkimConfigured ? "настроен" : "не настроен"}, ` +
        `relay ${info.hasRelay ? "свой" : "общий"}`,
    );
    if (!info.isActive) {
      console.error(`[email] сайт ${info.domain} в сервисе отключён — письма отправляться не будут`);
    }

    /* Ключ сайта отправляет письма только от своего домена. Несовпадение —
       это 403 на каждом письме, и узнать причину иначе можно только по ответу
       на первую же попытку регистрации. */
    const configuredFrom = process.env.SMTP_FROM;
    const fromDomain = configuredFrom?.split("@")[1]?.toLowerCase();
    if (fromDomain && info.domain && fromDomain !== info.domain.toLowerCase()) {
      console.error(
        `[email] SMTP_FROM=${configuredFrom} не совпадает с доменом ключа (@${info.domain}) — сервис отклонит письма`,
      );
    }
    return info;
  } catch (error) {
    console.error("[email] сервис недоступен:", describeError(error));
    return null;
  }
}

function siteInfo(): Promise<SiteInfo | null> {
  if (!sitePromise) sitePromise = fetchSiteInfo();
  return sitePromise;
}

/* ── Прямой SMTP: прежний путь, если сервис не задан ─────────────────────── */

/**
 * FIX-SMTP: пароль читается из `SMTP_PASSWORD`.
 *
 * Так он называется везде, где его задают: в `apps/web/.env.example`, в
 * `docker-compose.yml`, в `.gitlab-ci.yml` и в инструкции по установке в
 * README. А здесь читалось `SMTP_PASS` — имя, которого нет ни в одном из этих
 * файлов. Пароль до транспорта не доезжал, письмо уходило с пустым паролем,
 * почтовый сервер отвечал `535 Authentication credentials invalid`, и это
 * читалось как неверные учётные данные, хотя данные были верные — их просто не
 * брали. Старое имя оставлено запасным, чтобы не погасить установку, где в
 * .env уже лежит `SMTP_PASS`.
 */
const smtpUser = process.env.SMTP_USER || "";
const smtpPassSource = process.env.SMTP_PASSWORD
  ? "SMTP_PASSWORD"
  : process.env.SMTP_PASS
    ? "SMTP_PASS"
    : null;
const smtpPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || "";
const smtpPort = parseInt(process.env.SMTP_PORT || "25");

/**
 * Порт 465 — implicit TLS: канал шифруется с первого байта, и `secure: false`
 * на нём не даёт внятной ошибки, а вешает соединение. `SMTP_SECURE` при этом
 * не документирован и не пробрасывается ни compose, ни CI, поэтому режим
 * выводится из порта, а переменная нужна только чтобы переопределить вывод.
 */
const smtpSecure = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === "true"
  : smtpPort === 465;

function createLegacyTransport(): nodemailer.Transporter {
  const transportConfig: nodemailer.TransportOptions = {
    host: process.env.SMTP_HOST || "localhost",
    port: smtpPort,
    secure: smtpSecure,
    // FIX-SEC: по умолчанию проверяем TLS-сертификат SMTP (раньше проверка была
    // жёстко отключена — MitM мог перехватывать письма с кодами входа). Отключить
    // можно только явно, для локальной разработки: SMTP_TLS_REJECT_UNAUTHORIZED=false.
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false" },
  } as nodemailer.TransportOptions;

  if (smtpUser) {
    (transportConfig as Record<string, unknown>).auth = {
      user: smtpUser,
      pass: smtpPass,
    };
  }

  console.log("[email] прямой SMTP:", {
    host: process.env.SMTP_HOST || "localhost",
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUser ? "***" : "(none)",
    /* Имя переменной в логе — чтобы следующий такой случай был виден сразу:
       «(none)» при заданном логине означает не отвергнутый пароль, а ненайденный. */
    pass: smtpPass ? `*** (${smtpPassSource})` : "(none)",
    from: process.env.SMTP_FROM || "(none)",
  });

  /* Логин без пароля — самая незаметная поломка почты: сервер отвечает
     «неверные учётные данные», и по его ответу не догадаться, что пароля
     вообще не было. Поэтому случай назван вслух. */
  if (smtpUser && !smtpPass) {
    console.error(
      "[email] SMTP_USER задан, а пароль пуст — укажите SMTP_PASSWORD в .env, иначе сервер ответит 535",
    );
  }

  const created = nodemailer.createTransport(transportConfig);
  created.verify((err) => {
    if (err) console.error("[email] SMTP verify FAILED:", err.message);
    else console.log("[email] SMTP verify OK — ready to send");
  });
  return created;
}

const legacyTransporter = useService ? null : createLegacyTransport();

if (useService) {
  // Проверяем ключ на старте, а не на первом письме: неверный ключ должен
  // быть виден в логе запуска, а не в жалобе пользователя на регистрацию.
  void siteInfo();
} else if (!process.env.SMTP_HOST) {
  console.error("[email] почта не настроена: задайте SMTP_SERVICE_URL и SMTP_SERVICE_KEY");
}

/* ── Письма ──────────────────────────────────────────────────────────────── */

export function generateCode(): string {
  // FIX-SEC: криптостойкий генератор вместо Math.random() (коды подтверждения
  // не должны быть предсказуемыми). Диапазон 100000–999999.
  return randomInt(100000, 1000000).toString();
}

type EmailType = VerificationMailType;

/**
 * Адрес отправителя для собственного почтового сервиса.
 * Приоритет: явный SMTP_FROM → адрес, разрешённый ключом сервиса → SMTP_USER → noreply TrioZ.
 */
function fromAddress(info: SiteInfo | null): string {
  return process.env.SMTP_FROM || info?.senderEmail || process.env.SMTP_USER || "noreply@trioz.ru";
}

async function sendViaService(
  email: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  const info = await siteInfo();
  try {
    const res = await request("/api/emails", {
      from_email: fromAddress(info),
      to: email,
      subject,
      html,
      text,
    });
    if (!res.ok) {
      /* Причину сервис пишет словами: чужой домен отправителя, отключённый
         сайт, отвергнутые креды relay. Её и логируем — иначе останется
         бесполезное «не удалось отправить». */
      console.error(`[email] сервис отклонил письмо (${res.status}): ${await readDetail(res)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] сервис недоступен:", describeError(error));
    return false;
  }
}

async function sendViaSmtp(
  email: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  if (!legacyTransporter) return false;
  try {
    await legacyTransporter.sendMail({
      from: {
        name: "TrioZ",
        address: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@trioz.ru",
      },
      to: email,
      subject,
      text,
      html,
      headers: {
        "X-Mailer": "TrioZ Ecosystem",
        "X-Priority": "1",
      },
      encoding: "quoted-printable",
    });
    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

/**
 * Отправить готовое письмо — не код подтверждения, а обычное уведомление.
 *
 * Путь для обычных системных уведомлений: сервис, если он задан, иначе прямой
 * SMTP. Коды подтверждения идут отдельно через mailbox noreply@trioz.ru.
 *
 * О теме письма: у кодов подтверждения темы записаны латиницей
 * («Kod dlya vhoda - TrioZ»), и это не случайность — так обходили порчу
 * кириллицы в заголовках. Проверить на этой установке я не могу, поэтому и в
 * уведомлениях темы латиницей: тело письма кириллическое, как и у кодов, — там
 * это заведомо работает.
 *
 * Возвращает false вместо исключения: письмо — не причина ронять действие,
 * которое человек только что совершил.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(mail: OutgoingEmail): Promise<boolean> {
  if (!mail.to) return false;
  return useService
    ? sendViaService(mail.to, mail.subject, mail.html, mail.text)
    : sendViaSmtp(mail.to, mail.subject, mail.html, mail.text);
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  type: EmailType,
  verificationCodeId?: string,
): Promise<boolean> {
  const content = buildVerificationMail(code, type);
  const localPart = "noreply";
  const from = mailboxAddress(localPart);

  if (!verificationCodeId) {
    console.error("[email] для verification-письма не передан verificationCodeId");
    return false;
  }

  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart },
    update: {},
    create: {
      address: from,
      localPart,
      label: "Подтверждения",
      purpose: "Коды регистрации, входа и восстановления аккаунта",
      order: 9,
    },
  });

  const pendingKey = `pending:verification:${verificationCodeId}`;

  const message = await prisma.$transaction(async (tx) => {
    await tx.verificationCode.update({
      where: { id: verificationCodeId },
      data: { sendStatus: "pending", sendError: null },
    });
    return tx.mailMessage.create({
      data: {
        mailboxId: mailbox.id,
        direction: "outgoing",
        fromAddr: from,
        fromName: "TrioZ",
        toAddr: email,
        subject: content.subject,
        preview: content.text.slice(0, 160),
        bodyText: content.text,
        bodyHtml: content.html,
        messageId: pendingKey,
        verificationCodeId,
        deliveryStatus: "pending",
        sentAt: new Date(),
      },
    });
  });

  let result;
  try {
    // ВАЖНО: используем тот же путь, что и ручная отправка из админки:
    // sendFromMailbox -> MAIL_ACCOUNTS / MAIL_ACCOUNT_PASSWORD -> SMTP.
    result = await sendFromMailbox(localPart, {
      fromName: "TrioZ",
      to: [email],
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch (error) {
    result = { ok: false, messageId: null, error: error instanceof Error ? error.message : String(error) };
  }

  if (!result.ok) {
    const error = result.error || "Отправка кода не удалась";
    await prisma.$transaction(async (tx) => {
      await tx.mailMessage.update({
        where: { id: message.id },
        data: { deliveryStatus: "failed", deliveryError: error },
      });
      await tx.verificationCode.update({
        where: { id: verificationCodeId },
        data: { sendStatus: "failed", sendError: error.slice(0, 2000) },
      });
    }).catch(() => {});
    console.error("[email] verification mail failed:", error);
    return false;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.mailMessage.update({
        where: { id: message.id },
        data: {
          deliveryStatus: "sent",
          deliveryError: null,
          messageId: result.messageId || pendingKey,
          sentAt: new Date(),
        },
      });
      await tx.verificationCode.update({
        where: { id: verificationCodeId },
        data: { sendStatus: "sent", sendError: null },
      });
    });
  } catch (error) {
    // SMTP уже принял письмо — не считаем доставку неуспешной и не провоцируем повторную отправку.
    console.error("[email] verification mail accepted but history update failed:", error);
  }

  return true;
}
