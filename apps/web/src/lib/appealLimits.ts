import prisma from "@/lib/prisma";

/**
 * Защита обращений от спама.
 *
 * Ограничитель запросов (lib/rateLimit) здесь недостаточен: он считает запросы,
 * а спам заявками — это не частота запросов, а количество открытых разговоров.
 * Человек может отправлять по одной заявке в минуту весь день и формально не
 * превысить ни одного лимита на запросы, а очередь администратора при этом
 * встанет.
 *
 * Поэтому три разных ограничения, каждое закрывает свой способ:
 *
 *   1. ПАУЗА между заявками — от случайного двойного нажатия и от «строчу
 *      заявки одну за другой».
 *   2. ПРЕДЕЛ незакрытых — от накопления. Пока по трём обращениям не ответили,
 *      четвёртое не нужно ни человеку, ни администратору: разбирать всё равно
 *      будут по одному.
 *   3. ЗАПРЕТ дубля — от «отправлю то же самое ещё раз, вдруг заметят».
 *
 * Обжалование блокировки эти правила не касаются: у него свой предел (две
 * попытки на один бан, см. маршрут обращений). Смешивать их нельзя — иначе
 * заблокированный человек, исчерпавший паузу на обычных обращениях, лишился бы
 * возможности обжаловать блокировку.
 */

/** Пауза между двумя обращениями одного человека. */
export const APPEAL_COOLDOWN_MS = 5 * 60 * 1000;
/** Сколько обращений можно держать незакрытыми одновременно. */
export const APPEAL_OPEN_LIMIT = 3;
/** За какой срок одинаковая заявка считается повтором. */
export const APPEAL_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AppealLimitVerdict {
  /** null — можно отправлять. Иначе готовый текст отказа. */
  error: string | null;
  /** Через сколько секунд можно повторить. Нужен клиенту для отсчёта. */
  retryAfterSec?: number;
}

/** «через 3 мин» — человеку понятнее, чем «через 180 секунд». */
function humanWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "минуту";
  if (minutes < 5) return `${minutes} минуты`;
  return `${minutes} минут`;
}

/**
 * Можно ли этому человеку отправить обращение прямо сейчас.
 *
 * Обращения обжалования блокировки в расчёт не берём совсем: они живут по своим
 * правилам, и учитывать их здесь значило бы наказывать за них дважды.
 */
export async function checkAppealLimits(params: {
  userId: string;
  subject: string;
  body: string;
  now?: Date;
}): Promise<AppealLimitVerdict> {
  const now = params.now ?? new Date();

  /* Один запрос вместо трёх: свежие обращения человека за сутки покрывают все
     три проверки — и паузу, и дубль, а незакрытые считаем отдельно, потому что
     они могут быть и старше суток. */
  const recent = await prisma.appeal.findMany({
    where: {
      authorId: params.userId,
      category: { not: { startsWith: "BAN_APPEAL:" } },
      createdAt: { gte: new Date(now.getTime() - APPEAL_DUPLICATE_WINDOW_MS) },
    },
    select: { subject: true, body: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const last = recent[0];
  if (last) {
    const since = now.getTime() - new Date(last.createdAt).getTime();
    if (since < APPEAL_COOLDOWN_MS) {
      const left = APPEAL_COOLDOWN_MS - since;
      return {
        error: `Вы только что отправили обращение. Следующее можно отправить через ${humanWait(left)}.`,
        retryAfterSec: Math.ceil(left / 1000),
      };
    }
  }

  const subject = params.subject.trim().toLowerCase();
  const body = params.body.trim().toLowerCase();
  const duplicate = recent.some(
    (appeal: { subject: string; body: string }) =>
      appeal.subject.trim().toLowerCase() === subject && appeal.body.trim().toLowerCase() === body,
  );
  if (duplicate) {
    return {
      error: "Такое обращение уже отправлено — оно в работе. Дождитесь ответа, повторять не нужно.",
    };
  }

  const open = await prisma.appeal.count({
    where: {
      authorId: params.userId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      category: { not: { startsWith: "BAN_APPEAL:" } },
    },
  });
  if (open >= APPEAL_OPEN_LIMIT) {
    return {
      error: `У вас уже ${open} обращения в работе. Дождитесь ответа хотя бы по одному — так быстрее ответят на все.`,
    };
  }

  return { error: null };
}
