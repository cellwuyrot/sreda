/**
 * Право на конкретный файл.
 *
 * Прошлая правка убрала вложения из `public/` и закрыла их проверкой входа. Но
 * оставалась дыра: любой ВОШЕДШИЙ пользователь, которому переслали прямую
 * ссылку, файл получал. Проверить право было нечем — вложения сообщений лежат
 * в JSON-поле, и обратного пути от адреса файла к каналу или беседе в базе не
 * существовало.
 *
 * Здесь этот путь появляется. При загрузке рядом с файлом заводится строка:
 * путь на диске и то, чему файл принадлежит — каналу, беседе или задаче. При
 * выдаче раздатчик спрашивает ровно то же, что спросил бы маршрут этого канала
 * или беседы: можно ли этому человеку сюда смотреть.
 *
 * Почему не подписанные ссылки. Подпись пришлось бы ставить в двадцати с лишним
 * местах, где адрес покидает сервер (списки сообщений, закреплённые, галереи,
 * задачи, документы, события сокета), и пропущенное место означало бы битую
 * картинку. Главное же — подпись отвечает на вопрос «ссылку выдали недавно?», а
 * не «есть ли у этого человека право». Срок жизни ссылки сужает окно утечки,
 * проверка права закрывает её целиком.
 *
 * Старые файлы. У загруженных раньше строки нет, и запретить их значило бы
 * стереть историю вложений. Поэтому для неизвестного файла ответ — «не знаю»:
 * раздатчик пускает вошедшего и пишет предупреждение в журнал. После разбора
 * истории (scripts/backfill-upload-index.mjs) режим переключается переменной
 * UPLOADS_STRICT (включён по умолчанию; отключается UPLOADS_STRICT=0), и неизвестные файлы закрываются.
 */

import { LRUCache } from "lru-cache";
import prisma from "@/lib/prisma";
import { getChannelPermissions, canAccessConversation } from "@/lib/connectPermissions";
import { scheduleOffload } from "@/lib/uploadOffload";

export type UploadVerdict = "allow" | "deny" | "unknown";

/** Ответы живут недолго: права меняются, а картинок в ленте много. */
const verdictCache = new LRUCache<string, UploadVerdict>({ max: 20_000, ttl: 60_000 });

export interface UploadOwner {
  /** Путь внутри каталога загрузок: `messages/abc.webp`. */
  path: string;
  uploaderId: string;
  channelId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
}

/**
 * Запомнить, чему принадлежит загруженный файл. Вызывается из маршрутов
 * загрузки сразу после записи на диск.
 *
 * Ошибку намеренно глушим: файл уже лежит и уже отдан клиенту, ронять из-за
 * учётной строки саму загрузку неправильно. Пропущенная строка означает лишь
 * то, что файл останется «неизвестным» — как старые.
 */
export async function recordUpload(owner: UploadOwner): Promise<void> {
  try {
    await prisma.uploadedFile.upsert({
      where: { path: owner.path },
      update: {},
      create: {
        path: owner.path,
        dir: owner.path.split("/")[0] ?? "",
        uploaderId: owner.uploaderId,
        channelId: owner.channelId ?? null,
        conversationId: owner.conversationId ?? null,
        taskId: owner.taskId ?? null,
      },
    });
  } catch (err) {
    console.warn("[uploads] не удалось записать владельца файла", owner.path, err);
  }

  /* STORAGE-PRIORITY: если заведён узел хранения, файл уезжает на него. Здесь,
     а не в каждом из четырёх маршрутов загрузки: место файла — свойство самого
     файла, и правило должно быть одно на всех. Ждать переезд человек не должен,
     поэтому запуск без await: пока файл не уехал, он доступен с диска. */
  scheduleOffload(owner.path);
}

/**
 * Можно ли этому пользователю получить этот файл.
 *
 * `unknown` — файла нет в указателе (загружен до этой правки). Решение, что
 * делать с такими, принимает вызывающий: см. UPLOADS_STRICT в server.ts.
 */
export async function canAccessUpload(userId: string, path: string): Promise<UploadVerdict> {
  if (!userId || !path) return "deny";

  const key = `${userId}:${path}`;
  const cached = verdictCache.get(key);
  if (cached) return cached;

  const verdict = await computeVerdict(userId, path);
  verdictCache.set(key, verdict);
  return verdict;
}

async function computeVerdict(userId: string, path: string): Promise<UploadVerdict> {
  const record = await prisma.uploadedFile.findUnique({
    where: { path },
    select: { uploaderId: true, channelId: true, conversationId: true, taskId: true },
  });
  if (!record) return "unknown";

  // Тот, кто загрузил, видит свой файл всегда: он и так держит его у себя.
  if (record.uploaderId === userId) return "allow";

  if (record.channelId) {
    const permissions = await getChannelPermissions(userId, record.channelId);
    return permissions?.canView ? "allow" : "deny";
  }

  if (record.conversationId) {
    return (await canAccessConversation(userId, record.conversationId)) ? "allow" : "deny";
  }

  if (record.taskId) {
    /* У задачи своего доступа нет — она живёт в канале, права считаются по
       нему. Так же поступает и маршрут вложений задачи. */
    const task = await prisma.channelTask.findUnique({
      where: { id: record.taskId },
      select: { channelId: true },
    });
    if (!task) return "deny";
    const permissions = await getChannelPermissions(userId, task.channelId);
    return permissions?.canView ? "allow" : "deny";
  }

  /* Файл без привязки (например материал проекта) виден только загрузившему —
     проверка выше уже не сработала, значит это чужой человек. */
  return "deny";
}
