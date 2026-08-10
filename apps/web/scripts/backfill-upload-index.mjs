/**
 * Разовый разбор истории: заполняет указатель UploadedFile по уже загруженным
 * файлам.
 *
 * Зачем. Выдача приватных вложений теперь спрашивает право на канал, беседу или
 * задачу, к которой файл относится (lib/uploadAccess). У файлов, загруженных до
 * появления указателя, такой строки нет, и они считаются «неизвестными»: пока
 * UPLOADS_STRICT выключен, их получает любой вошедший, а в журнал идёт
 * предупреждение. Этот скрипт разбирает историю и закрывает пробел.
 *
 * Откуда берутся связи:
 *   Message.attachments (JSON)        → channelId сообщения
 *   DirectMessage.attachments (JSON)  → conversationId переписки
 *   WorkspaceFile.url                 → channelId канала документов
 *   TaskAttachment.url                → taskId задачи
 *
 * Запуск (из контейнера приложения):
 *   node scripts/backfill-upload-index.mjs            — записать
 *   node scripts/backfill-upload-index.mjs --dry-run  — только посчитать
 *
 * Скрипт можно запускать повторно: строки создаются с пропуском дубликатов.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 500;

/** Каталоги, доступ к которым проверяется. Публичные (аватары и т. п.) не нужны. */
const PRIVATE_DIRS = new Set(["messages", "voice", "videos", "documents", "tasks", "projects"]);

/** `/uploads/messages/uuid.webp` → `messages/uuid.webp`, иначе null. */
function toRelPath(url) {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return null;
  const rest = url.slice("/uploads/".length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const dir = rest.slice(0, slash);
  const name = rest.slice(slash + 1);
  if (!PRIVATE_DIRS.has(dir) || !name || name.includes("/")) return null;
  return { path: `${dir}/${name}`, dir };
}

function parseAttachments(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let created = 0;
let seen = 0;

async function flush(rows) {
  if (rows.length === 0) return;
  seen += rows.length;
  if (DRY_RUN) return;
  const res = await prisma.uploadedFile.createMany({ data: rows, skipDuplicates: true });
  created += res.count;
}

async function walk(label, fetchPage, toRows) {
  let cursor = null;
  let processed = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    if (page.length === 0) break;
    const rows = [];
    for (const item of page) rows.push(...toRows(item));
    await flush(rows);
    processed += page.length;
    cursor = page[page.length - 1].id;
    process.stdout.write(`\r${label}: обработано ${processed}`);
  }
  process.stdout.write(`\r${label}: обработано ${processed}\n`);
}

async function main() {
  console.log(DRY_RUN ? "Пробный проход: ничего не записываю\n" : "Заполняю указатель UploadedFile\n");

  await walk(
    "Сообщения каналов",
    (cursor) =>
      prisma.message.findMany({
        where: { attachments: { not: null } },
        select: { id: true, userId: true, channelId: true, attachments: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (message) =>
      parseAttachments(message.attachments)
        .map((att) => toRelPath(att?.url))
        .filter(Boolean)
        .map((rel) => ({
          path: rel.path,
          dir: rel.dir,
          uploaderId: message.userId,
          channelId: message.channelId,
        })),
  );

  await walk(
    "Личные сообщения",
    (cursor) =>
      prisma.directMessage.findMany({
        where: { attachments: { not: null } },
        select: { id: true, userId: true, conversationId: true, attachments: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (message) =>
      parseAttachments(message.attachments)
        .map((att) => toRelPath(att?.url))
        .filter(Boolean)
        .map((rel) => ({
          path: rel.path,
          dir: rel.dir,
          uploaderId: message.userId,
          conversationId: message.conversationId,
        })),
  );

  await walk(
    "Документы каналов",
    (cursor) =>
      prisma.workspaceFile.findMany({
        select: { id: true, url: true, uploaderId: true, channelId: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (file) => {
      const rel = toRelPath(file.url);
      return rel ? [{ path: rel.path, dir: rel.dir, uploaderId: file.uploaderId, channelId: file.channelId }] : [];
    },
  );

  await walk(
    "Вложения задач",
    (cursor) =>
      prisma.taskAttachment.findMany({
        select: { id: true, url: true, uploaderId: true, taskId: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (att) => {
      const rel = toRelPath(att.url);
      return rel ? [{ path: rel.path, dir: rel.dir, uploaderId: att.uploaderId, taskId: att.taskId }] : [];
    },
  );

  console.log(`\nНайдено ссылок на приватные файлы: ${seen}`);
  console.log(DRY_RUN ? "Записано: 0 (пробный проход)" : `Создано строк: ${created}`);
  console.log(
    DRY_RUN
      ? "\nПовторите без --dry-run, затем включайте UPLOADS_STRICT=1."
      : "\nТеперь проверьте журнал приложения на строки «[uploads] файла нет в указателе».\n" +
          "Если их нет — можно включать UPLOADS_STRICT=1.",
  );
}

main()
  .catch((err) => {
    console.error("\nОшибка:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
