import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
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
 * Почта проекта уже ходит через этот сервис (lib/email.ts). Он же шлёт
 * вебхуки о судьбе писем — сюда он присылает входящие (на ящики домена) и
 * исходящие (отправленные с ящиков домена) письма. Шлюз клиентского
 * общения — отдельный от кодов входа, поэтому ничего в отправке кодов не
 * меняется.
 *
 * Защита — общий секрет MAIL_INGEST_SECRET в заголовке X-Mail-Secret. Секрет
 * сравнивается постоянное время (timingSafeEqual), чтобы не течь по таймингу.
 * Если секрет не задан в окружении — эндпоинт закрыт (503), чтобы не принимать
 * письма без аутентификации.
 */

function secretOk(provided: string | null): boolean {
  const expected = process.env.MAIL_INGEST_SECRET || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
  if (process.env.NODE_ENV !== "test" && !process.env.MAIL_INGEST_SECRET) {
    return NextResponse.json({ error: "ingest disabled" }, { status: 503 });
  }
  if (!secretOk(req.headers.get("x-mail-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
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
  const sentAt = body.sentAt ? new Date(body.sentAt) : new Date();

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
