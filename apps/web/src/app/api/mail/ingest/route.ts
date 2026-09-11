import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";
import {
  findMailbox,
  isMailDirection,
  mailboxAddress,
  previewFromText,
} from "@/lib/projectMail";

/**
 * PROJECT-MAIL: приём писем от почтового сервиса (github.com/acoulbot/smtp).
 *
 * Почта проекта ходит через этот сервис (lib/email.ts). Он же шлёт вебхуки:
 * входящие (на ящики домена) и исходящие (отправленные с ящиков) письма
 * попадают в админку. Шлюз клиентского общения — отдельный от кодов входа,
 * поэтому в отправке кодов ничего не меняется.
 *
 * ── Аутентификация вебхука ──────────────────────────────────────────
 * Поддерживаются два способа, чтобы подойти к любой конфигурации сервиса:
 *
 * 1. Подпись Standard Webhooks / Svix (РЕКОМЕНДУЕТСЯ). В админке сервиса у
 *    вебхука есть "signing secret" вида whsec_xxxx. Сервис на каждый запрос
 *    считает HMAC-SHA256 от строки `${id}.${timestamp}.${body}` ключом
 *    (base64-часть после whsec_) и присылает заголовки webhook-id,
 *    webhook-timestamp, webhook-signature ("v1,<base64> ..."). Секрет кладём
 *    в MAIL_WEBHOOK_SECRET. Так тело нельзя подделать и нельзя переиграть
 *    старый запрос (проверяем свежесть timestamp).
 *
 * 2. Простой общий секрет в заголовке X-Mail-Secret (запасной путь) —
 *    переменная MAIL_INGEST_SECRET. На случай, если сервис не умеет подпись.
 *
 * Если не задан ни один секрет — эндпоинт закрыт (503), чтобы не принимать
 * письма без аутентификации.
 */

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** Заголовок в нотации webhook-* или его svix-* синоним. */
function sigHeader(req: NextRequest, name: "id" | "timestamp" | "signature"): string | null {
  return req.headers.get(`webhook-${name}`) || req.headers.get(`svix-${name}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Проверка подписи Standard Webhooks (whsec_...). */
function verifySignedWebhook(req: NextRequest, rawBody: string, secret: string): boolean {
  const id = sigHeader(req, "id");
  const timestamp = sigHeader(req, "timestamp");
  const signature = sigHeader(req, "signature");
  if (!id || !timestamp || !signature) return false;

  // Защита от повторного проигрывания старого запроса.
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  // whsec_ — ключ закодирован в base64; иначе берём как есть (сырой ключ).
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret);

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  // Заголовок может содержать несколько подписей через пробел: "v1,<sig> v1,<sig>".
  for (const item of signature.split(" ")) {
    const comma = item.indexOf(",");
    const version = comma === -1 ? "" : item.slice(0, comma);
    const value = comma === -1 ? item : item.slice(comma + 1);
    if (version !== "v1" || !value) continue;
    if (constantTimeEqual(value, expected)) return true;
  }
  return false;
}

/** Запасной путь: простой общий секрет в X-Mail-Secret. */
function sharedSecretOk(provided: string | null, expected: string): boolean {
  if (!expected || !provided) return false;
  return constantTimeEqual(provided, expected);
}

/** Из адреса вида "info@trioz.ru" или "Имя <info@trioz.ru>" достаём localPart. */
function localPartOf(addr: string): string | null {
  const m = /<([^>]+)>/.exec(addr);
  const email = (m ? m[1] : addr).trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0) return null;
  return email.slice(0, at);
}

export async function POST(req: NextRequest) {
  const signedSecret = process.env.MAIL_WEBHOOK_SECRET || "";
  const sharedSecret = process.env.MAIL_INGEST_SECRET || "";

  if (process.env.NODE_ENV !== "test" && !signedSecret && !sharedSecret) {
    return NextResponse.json({ error: "ingest disabled" }, { status: 503 });
  }

  // Тело читаем как текст: для HMAC нужен ровно тот байт-в-байт payload, что
  // подписал сервис, а не пере-сериализованный JSON.
  const rawBody = await req.text();

  const hasSignature = Boolean(sigHeader(req, "signature"));
  let authed = false;
  if (signedSecret && hasSignature) {
    authed = verifySignedWebhook(req, rawBody, signedSecret);
  } else if (sharedSecret) {
    authed = sharedSecretOk(req.headers.get("x-mail-secret"), sharedSecret);
  }
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const direction = body.direction;
  if (!isMailDirection(direction)) {
    return NextResponse.json({ error: "direction must be incoming|outgoing" }, { status: 400 });
  }

  const fromAddr = String(body.from || "").slice(0, 320);
  const toAddr = String(body.to || "").slice(0, 320);
  const subject = String(body.subject || "(без темы)").slice(0, 2000);
  const bodyText = String(body.text || "");
  const bodyHtml = typeof body.html === "string" ? body.html : null;
  const messageId = typeof body.messageId === "string" ? body.messageId.slice(0, 400) : null;
  const sentAt = body.sentAt ? new Date(body.sentAt as string) : new Date();

  // Ящик домена — тот конец, который принадлежит нам: для входящих это "to",
  // для исходящих — "from".
  const ourAddr = direction === "incoming" ? toAddr : fromAddr;
  const localPart = localPartOf(ourAddr);
  const def = localPart ? findMailbox(localPart) : undefined;
  if (!def) {
    return NextResponse.json({ error: "unknown mailbox", address: ourAddr }, { status: 404 });
  }

  // Ящик мог ещё не посеяться — создаём лениво по каноническому определению.
  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart: def.localPart },
    update: {},
    create: {
      address: mailboxAddress(def.localPart),
      localPart: def.localPart,
      label: def.label,
      purpose: def.purpose,
      order: def.order,
    },
  });

  // Дедуп по Message-ID: сервис может повторить вебхук при ретрае.
  if (messageId) {
    const dup = await prisma.mailMessage.findUnique({ where: { messageId } });
    if (dup) return NextResponse.json({ ok: true, id: dup.id, deduped: true });
  }

  const created = await prisma.mailMessage.create({
    data: {
      mailboxId: mailbox.id,
      direction,
      fromAddr,
      toAddr,
      subject,
      preview: previewFromText(bodyText || subject),
      bodyText,
      bodyHtml,
      messageId,
      sentAt: isNaN(sentAt.getTime()) ? new Date() : sentAt,
    },
  });

  return NextResponse.json({ ok: true, id: created.id });
}
