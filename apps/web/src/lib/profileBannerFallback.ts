import prisma from "@/lib/prisma";

/**
 * FIX-BANNERWEB: один фон профиля на всю площадку.
 *
 * Фон когда-то можно было задать отдельно для каждого сообщества (раздел
 * "Профиль на выбранном сервере"), и такое значение легло на участника
 * (GroupMember.profileBanner), а не на пользователя. Сам раздел убран
 * (FIX-NOSRVPROFILE), а переопределение по сообществу больше не читается
 * (FIX-BANNERONE) -- поэтому у тех, кто выставлял фон только там, User.profileBanner
 * остался пустым: в новой сборке профиль стал без фона, тогда как собранное
 * ранее приложение показывало прежнюю картинку. Со стороны это и выглядит как
 * "в десктопе фон есть, в вебе нет".
 *
 * Здесь прежнее значение принимается как общий фон и один раз переносится на
 * пользователя, чтобы все остальные места (сообщения, карточка, страница
 * профиля) читали его из одного поля и больше не расходились. Перенос -- в
 * попытке: упавшая запись не должна ломать выдачу профиля.
 */
export async function resolveProfileBanner(
  userId: string,
  current: string | null | undefined,
): Promise<string | null> {
  const value = typeof current === "string" ? current.trim() : "";
  if (value) return value;

  let legacy: { profileBanner: string | null } | null = null;
  try {
    legacy = await prisma.groupMember.findFirst({
      where: { userId, profileBanner: { not: null } },
      select: { profileBanner: true },
      /* Самый свежий из перенесённых: если человек выставлял фон в нескольких
         сообществах, общим логично сделать последний выбранный. */
      orderBy: { joinedAt: "desc" },
    });
  } catch {
    return null;
  }

  const adopted = legacy?.profileBanner?.trim();
  if (!adopted) return null;

  /* Записываем только то, что принял бы PATCH /api/profile/me: путь загрузки на
     нашем домене. Старые data URL (до ~900 КБ) показываем, но в поле
     пользователя не переносим -- они и так тяжелы для каждой выдачи профиля. */
  if (adopted.startsWith("/uploads/") && adopted.length <= 400 && !adopted.includes("..")) {
    try {
      await prisma.user.update({ where: { id: userId }, data: { profileBanner: adopted } });
    } catch {
      /* Колонки нет или база недоступна -- фон всё равно вернём этой выдачей. */
    }
  }

  return adopted;
}
