import { LRUCache } from "lru-cache";
import prisma from "@/lib/prisma";
import { hasPremium } from "@/lib/premium";
import {
  matchCensorWords,
  type CensorEntry,
  type CensorLevel,
  type CensorVerdict,
} from "@/lib/censor";

/**
 * Словарь цензуры со стороны базы: чтение, кэш, запись наблюдений.
 *
 * Разбор текста живёт отдельно (lib/censor) и базы не знает — здесь только
 * доступ к данным.
 */

/**
 * Кэш словаря на сообщество.
 *
 * Разбор идёт на КАЖДОЕ сообщение, и без кэша к каждой отправке добавлялся бы
 * запрос к базе. Полминуты — компромисс: правка словаря вступает в силу почти
 * сразу, а при правке через наш же маршрут кэш сбрасывается сразу, без
 * ожидания. Пустой словарь тоже кэшируется: у большинства сообществ он пустой,
 * и это самый частый случай.
 */
const dictionaryCache = new LRUCache<string, CensorEntry[]>({ max: 2_000, ttl: 30_000 });

/** Есть ли у сообщества право на раздел цензуры: подписка у владельца. */
const featureCache = new LRUCache<string, boolean>({ max: 2_000, ttl: 60_000 });

export function invalidateCensorCache(groupId: string): void {
  dictionaryCache.delete(groupId);
}

export function invalidateCensorFeature(groupId: string): void {
  featureCache.delete(groupId);
}

/**
 * Доступен ли сообществу раздел цензуры.
 *
 * Правило: подписка у ВЛАДЕЛЬЦА сообщества — того, кто его создал. Так же
 * устроен предел своих эмодзи (lib/premiumLimits), и по той же причине: платит
 * за возможности сообщества его владелец, а не тот, кто в нём пишет.
 *
 * «Premium на момент создания» в базе не хранится, и заводить такое поле ради
 * одной проверки неправильно: подписка кончится, а поле останется, и владелец
 * без подписки продолжит пользоваться платной возможностью. Поэтому проверка по
 * текущему состоянию — с оговоркой в интерфейсе.
 */
export async function censorAvailable(groupId: string): Promise<boolean> {
  const cached = featureCache.get(groupId);
  if (cached !== undefined) return cached;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { owner: { select: { isPremium: true, role: true } } },
  });
  const available = hasPremium(group?.owner);
  featureCache.set(groupId, available);
  return available;
}

/** Словарь сообщества. Пустой массив — проверять нечего. */
export async function loadCensorDictionary(groupId: string): Promise<CensorEntry[]> {
  const cached = dictionaryCache.get(groupId);
  if (cached) return cached;
  const rows = await prisma.groupCensorWord.findMany({
    where: { groupId },
    select: { word: true, level: true },
    orderBy: { createdAt: "asc" },
  });
  const entries: CensorEntry[] = rows.map((row) => ({ word: row.word, level: row.level as CensorLevel }));
  dictionaryCache.set(groupId, entries);
  return entries;
}

export interface CensorCheckResult extends CensorVerdict {
  /** Отправку нужно отклонить. */
  blocked: boolean;
}

/**
 * Проверить текст по словарю сообщества.
 *
 * Ничего не пишет: запись наблюдений — отдельным вызовом, уже после того как
 * сообщение действительно создано. Иначе счётчик рос бы и от сообщений, которые
 * не отправились по другой причине.
 */
export async function checkCensor(groupId: string, text: string): Promise<CensorCheckResult> {
  if (!text.trim()) return { matches: [], level: null, blocked: false };
  if (!(await censorAvailable(groupId))) return { matches: [], level: null, blocked: false };
  const dictionary = await loadCensorDictionary(groupId);
  const verdict = matchCensorWords(text, dictionary);
  return { ...verdict, blocked: verdict.level === "BLOCK" };
}

/**
 * Записать замеченные упоминания в счётчик.
 *
 * Ошибку глотаем намеренно: наблюдение — вспомогательная запись, и падать
 * отправкой сообщения из-за него нельзя. В журнал при этом пишем, иначе тихая
 * потеря наблюдений выглядела бы как «фильтр не работает».
 */
export async function recordCensorHits(params: {
  groupId: string;
  userId: string;
  channelId?: string | null;
  matches: { word: string; level: CensorLevel }[];
}): Promise<void> {
  if (params.matches.length === 0) return;
  try {
    await prisma.censorHit.createMany({
      data: params.matches.map((match) => ({
        groupId: params.groupId,
        userId: params.userId,
        channelId: params.channelId ?? null,
        word: match.word,
        level: match.level,
      })),
    });
  } catch (err) {
    console.warn("[censor] не удалось записать наблюдение", params.groupId, err);
  }
}

export interface CensorCounter {
  userId: string;
  userName: string;
  username: string;
  avatar: string | null;
  total: number;
  byLevel: Record<CensorLevel, number>;
  lastAt: string | null;
}

/**
 * Сводка по участникам: у кого сколько замечено.
 *
 * Считаем в базе группировкой, а не выборкой всех строк: наблюдений за месяц
 * может быть десятки тысяч, и тянуть их в память ради счёта — верный способ
 * получить медленную страницу настроек.
 */
export async function censorCounters(groupId: string, limit = 50): Promise<CensorCounter[]> {
  const grouped = await prisma.censorHit.groupBy({
    by: ["userId", "level"],
    where: { groupId },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  if (grouped.length === 0) return [];

  const byUser = new Map<string, CensorCounter>();
  for (const row of grouped) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      userName: "Участник",
      username: "",
      avatar: null,
      total: 0,
      byLevel: { BLOCK: 0, WARN: 0, WATCH: 0 },
      lastAt: null as string | null,
    };
    const count = row._count._all;
    entry.total += count;
    if (row.level === "BLOCK" || row.level === "WARN" || row.level === "WATCH") {
      entry.byLevel[row.level] += count;
    }
    const last = row._max.createdAt ? new Date(row._max.createdAt).toISOString() : null;
    if (last && (!entry.lastAt || last > entry.lastAt)) entry.lastAt = last;
    byUser.set(row.userId, entry);
  }

  const sorted = [...byUser.values()].sort((a, b) => b.total - a.total).slice(0, limit);

  /* Имена — одним запросом на всех: связи с User у наблюдения нет намеренно
     (строка переживает удаление участника), поэтому подписи добираем здесь. */
  const users = await prisma.user.findMany({
    where: { id: { in: sorted.map((row) => row.userId) } },
    select: { id: true, name: true, username: true, avatar: true },
  });
  const userById = new Map(users.map((user) => [user.id, user]));
  for (const row of sorted) {
    const user = userById.get(row.userId);
    if (user) {
      row.userName = user.name;
      row.username = user.username;
      row.avatar = user.avatar;
    } else {
      // Участника удалили — счётчик остаётся, но подписать его нечем.
      row.userName = "Удалённый участник";
    }
  }
  return sorted;
}
