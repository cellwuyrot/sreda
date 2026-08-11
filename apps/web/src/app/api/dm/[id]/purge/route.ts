import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs/promises";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";
import { isStaffRole } from "@/lib/businessChat";
import { resolveUploadPath } from "@/lib/uploadPaths";
import { logAction } from "@/lib/audit";

/**
 * ARCHIVE: безвозвратное удаление переписки — DELETE /api/dm/<id>/purge
 *
 * Отличие от уже существующего DELETE /api/dm/<id>?messageId=... принципиальное:
 * там одно сообщение гасится мягко (строка остаётся, текст пустеет), здесь
 * уничтожается весь разговор целиком и у обоих участников. Отдельный адрес
 * взят сознательно: признак вроде `?purge=1` на том же обработчике означает, что
 * забытый параметр превращает удаление реплики в уничтожение переписки.
 *
 * Что удаляется:
 *   • сама запись разговора — сообщения уходят по каскаду вместе с ней;
 *   • файлы вложений с диска и их учётные строки (UploadedFile);
 *   • уведомления по этой переписке — иначе в колокольчике останется ссылка
 *     на несуществующий чат.
 *
 * Кто имеет право:
 *   • личная переписка — любой из двоих. Переписка общая, и спрашивать
 *     разрешения у того, от кого человек как раз хочет избавиться, бессмысленно;
 *   • деловой разговор — только администрация. За ним стоит заявка, а часто и
 *     счёт с подписанными договорами; если клиент сотрёт его в один клик,
 *     администрация останется без основания по своей же работе. Клиенту доступен
 *     архив: выгрузка файлом и скрытие из списка.
 */

/** Событие для открытых вкладок: убрать разговор из списка и закрыть его. */
export const DM_PURGED_EVENT = "dm-purged";

/** Адреса вложений из JSON-поля сообщения. Битая запись просто пропускается. */
function attachmentUrls(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (item as Record<string, unknown>)?.url)
      .filter((url): url is string => typeof url === "string" && url.startsWith("/uploads/"));
  } catch {
    return [];
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const participant = conversation.user1Id === userId || conversation.user2Id === userId;
  const business = conversation.kind === "BUSINESS";

  if (business) {
    if (!isStaffRole(session.user.role)) {
      return NextResponse.json(
        {
          error:
            "Деловой разговор безвозвратно удаляет только администрация: за ним стоит заявка и расчёты. Сохраните копию в архив и уберите разговор из списка.",
        },
        { status: 403 },
      );
    }
  } else if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Вложения собираем ДО удаления записи: после каскада сообщений уже нет,
     а файлы на диске останутся лежать навсегда и узнать о них будет неоткуда. */
  const withFiles = await prisma.directMessage.findMany({
    where: { conversationId: id, NOT: { attachments: null } },
    select: { attachments: true },
  });
  const urls = [...new Set(withFiles.flatMap((m) => attachmentUrls(m.attachments)))];

  const participants = [conversation.user1Id, conversation.user2Id];

  /* Порядок важен: сначала база. Если сначала стереть файлы, а удаление
     разговора упадёт, переписка останется с битыми вложениями — хуже, чем
     осиротевший файл на диске. */
  await prisma.directConversation.delete({ where: { id } });

  /* Учётные строки файлов и уведомления — хвосты, которые не держатся на
     внешнем ключе к разговору и каскадом не уходят. */
  await prisma.uploadedFile.deleteMany({ where: { conversationId: id } }).catch(() => undefined);
  await prisma.notification
    .deleteMany({ where: { entityType: "dm", entityId: id } })
    .catch(() => undefined);

  /* Файлы стираем по одному и молча пропускаем неудачи: часть вложений могла
     уехать на узел хранения или быть удалённой раньше, и ни то, ни другое не
     причина возвращать ошибку человеку, у которого чат уже удалён. */
  let removedFiles = 0;
  for (const url of urls) {
    const resolved = resolveUploadPath(url);
    if (!resolved) continue;
    try {
      await fs.unlink(resolved.filePath);
      removedFiles += 1;
    } catch {
      /* файла нет или он не здесь */
    }
  }

  /* Обоим участникам — и тому, кто нажал. У человека может быть открыта
     вторая вкладка или телефон, и там удалённый чат остался бы открытым. */
  for (const target of participants) {
    emitToUser(target, DM_PURGED_EVENT, { conversationId: id, by: userId });
  }

  await logAction({
    userId,
    username: session.user.name || session.user.username || "",
    action: "dm.purge",
    target: "DirectConversation",
    targetId: id,
    details: `kind=${conversation.kind}; файлов удалено: ${removedFiles} из ${urls.length}`,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, conversationId: id, removedFiles });
}
