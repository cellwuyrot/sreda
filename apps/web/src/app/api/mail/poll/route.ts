import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { timingSafeEqual } from "crypto";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PROJECT_MAILBOXES, mailboxAddress, findMailbox } from "@/lib/projectMail";
import { fetchRecent } from "@/lib/mailImap";

/**
 * PROJECT-MAIL: забрать входящие письма ящиков по IMAP и сложить в базу.
 *
 * Этот роут и есть ответ на «письмо пришло на сервер, а в админке пусто»:
 * теперь приложение само ходит в ящики и подтягивает почту.
 *
 * Запускается двумя способами:
 *   • админ кнопкой «Проверить почту» (сессия ADMIN);
 *   • по cron — заголовок X-Cron-Secret = MAIL_CRON_SECRET (чтобы почта
 *     подтягивалась сама, а не только когда открыта админка).
 *
 * Тело (необязательно): { address?: "info" } — опросить только один ящик.
 */

function cronOk(provided: string | null): boolean {
  const expected = process.env.MAIL_CRON_SECRET || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Доступ: либо админ, либо cron-секрет.
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "ADMIN";
  if (!isAdmin && !cronOk(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const only = typeof body?.address === "string" ? body.address.toLowerCase() : null;
  const targets = only
    ? PROJECT_MAILBOXES.filter((m) => m.localPart === only)
    : PROJECT_MAILBOXES;
  if (only && targets.length === 0) {
    return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  }

  let fetched = 0;
  let stored = 0;
  const errors: Array<{ address: string; error: string }> = [];

  for (const def of targets) {
    try {
      const messages = await fetchRecent(def.localPart);
      fetched += messages.length;

      // Ящик мог ещё не посеяться — создаём лениво.
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

      for (const msg of messages) {
        // Дедуп по Message-ID: повторный опрос не должен плодить дубли.
        if (msg.messageId) {
          const dup = await prisma.mailMessage.findUnique({ where: { messageId: msg.messageId } });
          if (dup) continue;
        }
        await prisma.mailMessage.create({
          data: {
            mailboxId: mailbox.id,
            direction: "incoming",
            fromAddr: msg.fromAddr,
            toAddr: msg.toAddr,
            subject: msg.subject,
            preview: msg.preview,
            bodyText: msg.bodyText,
            bodyHtml: msg.bodyHtml,
            messageId: msg.messageId,
            sentAt: msg.sentAt,
          },
        });
        stored += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ address: mailboxAddress(def.localPart), error: message });
    }
  }

  // Если не удалось ни один ящик — это ошибка конфигурации, а не частичный успех.
  if (errors.length === targets.length) {
    return NextResponse.json(
      { ok: false, fetched, stored, errors },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, fetched, stored, errors });
}
