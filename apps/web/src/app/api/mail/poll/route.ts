import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { timingSafeEqual } from "crypto";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PROJECT_MAILBOXES, mailboxAddress, isUniqueViolation } from "@/lib/projectMail";
import { fetchSinceUid } from "@/lib/mailImap";
import { isBlacklistedSender, readMailBlacklist } from "@/lib/mailBlacklist";

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
  let duplicates = 0;
  let blocked = 0;
  let lastSyncAt: Date | null = null;
  const errors: Array<{ address: string; error: string }> = [];
  const blacklist = readMailBlacklist();

  for (const def of targets) {
    try {
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
      const batch = await fetchSinceUid(
        def.localPart,
        mailbox.lastSyncedUid,
        mailbox.imapUidValidity,
      );
      fetched += batch.messages.length;
      const validityChanged = mailbox.imapUidValidity != null && batch.uidValidity != null
        && BigInt(mailbox.imapUidValidity) !== batch.uidValidity;
      if (validityChanged) {
        await prisma.projectMailbox.update({
          where: { id: mailbox.id },
          data: { lastSyncedUid: null, imapUidValidity: batch.uidValidity },
        });
      }
      const advanceCursor = (uid: number) => prisma.projectMailbox.updateMany({
        where: {
          id: mailbox.id,
          OR: [{ lastSyncedUid: null }, { lastSyncedUid: { lt: BigInt(uid) } }],
        },
        data: { lastSyncedUid: BigInt(uid), imapUidValidity: batch.uidValidity },
      });

      for (const msg of batch.messages) {
        const suppressed = await prisma.mailDeletionTombstone.findUnique({
          where: {
            mailboxId_messageKey: { mailboxId: mailbox.id, messageKey: msg.messageId },
          },
          select: { id: true },
        });
        if (suppressed) {
          duplicates += 1;
          await advanceCursor(msg.imapUid);
          continue;
        }
        if (isBlacklistedSender(msg.fromAddr, blacklist)) {
          await prisma.mailDeletionTombstone.upsert({
            where: {
              mailboxId_messageKey: { mailboxId: mailbox.id, messageKey: msg.messageId },
            },
            update: { reason: "blacklist" },
            create: { mailboxId: mailbox.id, messageKey: msg.messageId, reason: "blacklist" },
          });
          blocked += 1;
          await advanceCursor(msg.imapUid);
          continue;
        }
        // Дедуп в пределах ящика: у каждого письма ключ есть всегда (настоящий
        // Message-ID либо синтетический), поэтому повторный опрос не плодит
        // копии — а одно письмо на два ящика домена попадает в оба.
        const dup = await prisma.mailMessage.findFirst({
          where: { mailboxId: mailbox.id, messageId: msg.messageId },
          select: { id: true },
        });
        if (dup) {
          duplicates += 1;
          await advanceCursor(msg.imapUid);
          continue;
        }
        try {
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
              imapUid: BigInt(msg.imapUid),
              sentAt: msg.sentAt,
            },
          });
          stored += 1;
        } catch (error) {
          // Два опроса могли пойти параллельно (кнопка и cron) и дойти до
          // create с одним и тем же ключом. Уникальный индекс отсечёт второго:
          // это дубль, а не сбой ящика — иначе одно письмо роняло весь опрос.
          if (isUniqueViolation(error)) duplicates += 1;
          else throw error;
        }
        // Cursor only advances after this UID is safely stored/deduped/suppressed.
        await advanceCursor(msg.imapUid);
      }
      lastSyncAt = new Date();
      await prisma.projectMailbox.update({
        where: { id: mailbox.id },
        data: {
          lastSyncAt,
          lastSyncError: null,
          ...(batch.uidValidity != null ? { imapUidValidity: batch.uidValidity } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ address: mailboxAddress(def.localPart), error: message });
      await prisma.projectMailbox.updateMany({
        where: { localPart: def.localPart },
        data: { lastSyncAt: new Date(), lastSyncError: message.slice(0, 2000) },
      }).catch(() => {});
    }
  }

  // Если не удалось ни один ящик — это ошибка конфигурации, а не частичный успех.
  if (errors.length === targets.length) {
    return NextResponse.json(
      { ok: false, fetched, stored, duplicates, blocked, lastSyncAt, errors },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, fetched, stored, duplicates, blocked, lastSyncAt, errors });
}
