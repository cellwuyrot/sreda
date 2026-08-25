/* ══════════════════════════════════════════════════════════════════════════
   MAIL-WHITELIST: белый список почтовых домёнов для регистрации
   ══════════════════════════════════════════════════════════════════════════

   Регистрация разрешена только с адресов, домен которых внесён в таблицу.
   Всё остальное — одноразовые ящики, самодельные домены, опечатки вида
   «gmail.co» — отсекается до отправки кода подтверждения.

   Два правила, из которых здесь всё следует:

   1. Тому, кто регистрируется, про белый список не сообщается ничего: ни
      что список существует, ни какие домены в нём есть, ни почему именно
      этот адрес не подошёл. Человек видит единственную строку «Регистрация
      невозможна». Иначе перебором ответов список вычисляется целиком, а
      подсказка «возьмите почту на gmail» превращает ограничение в
      инструкцию по обходу.
   2. Пустой таблицы не бывает: она заполняется при миграции. Но если
      записей всё же не осталось (список вычистили руками), проверка
      опирается на встроенный набор ниже, а не пропускает всех подряд.
      Отсутствие данных не должно молча отключать ограничение. */

import prisma from "@/lib/prisma";

/** Единственное, что видит человек при неподходящем адресе. Без деталей. */
export const REGISTRATION_BLOCKED = "Регистрация невозможна";

/** Встроенный набор: мировые почты и российские службы. Им же засеивается таблица. */
export const DEFAULT_WHITELIST: Array<{ domain: string; note: string }> = [
  // Мировые
  { domain: "gmail.com", note: "Google" },
  { domain: "googlemail.com", note: "Google" },
  { domain: "icloud.com", note: "Apple" },
  { domain: "me.com", note: "Apple" },
  { domain: "outlook.com", note: "Microsoft" },
  { domain: "hotmail.com", note: "Microsoft" },
  { domain: "live.com", note: "Microsoft" },
  { domain: "yahoo.com", note: "Yahoo" },
  { domain: "proton.me", note: "Proton" },
  { domain: "protonmail.com", note: "Proton" },
  // Российские
  { domain: "yandex.ru", note: "Яндекс" },
  { domain: "ya.ru", note: "Яндекс" },
  { domain: "yandex.com", note: "Яндекс" },
  { domain: "mail.ru", note: "Mail.ru" },
  { domain: "inbox.ru", note: "Mail.ru" },
  { domain: "bk.ru", note: "Mail.ru" },
  { domain: "list.ru", note: "Mail.ru" },
  { domain: "internet.ru", note: "Mail.ru" },
  { domain: "vk.com", note: "VK" },
  { domain: "rambler.ru", note: "Рамблер" },
  { domain: "lenta.ru", note: "Рамблер" },
  { domain: "autorambler.ru", note: "Рамблер" },
  { domain: "ro.ru", note: "Рамблер" },
  { domain: "trioz.ru", note: "Свой домен" },
];

/** Домен в том виде, в котором он хранится: нижний регистр, без пробелов, @ и точки по краям. */
export function normalizeDomain(raw: string): string | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/^\.+|\.+$/g, "");
  if (!value || value.length > 100) return null;
  /* Домен, а не адрес: одна или несколько метка через точку, зона от двух букв.
     Латиница и цифры — адреса на кириллических домёнах здесь не заводятся. */
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) return null;
  if (!/\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

/** Домен адреса или null, если это не похоже на адрес. */
export function emailDomain(email: string): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  return normalizeDomain(value.slice(at + 1));
}

/**
 * Разрешён ли адрес к регистрации.
 *
 * Ответ намеренно двоичный: вызывающая сторона не должна иметь возможности
 * сообщить человеку что-то, кроме REGISTRATION_BLOCKED.
 */
export async function isRegistrationEmailAllowed(email: string): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain) return false;

  try {
    const hit = await prisma.emailDomainWhitelist.findFirst({
      where: { domain, active: true },
      select: { id: true },
    });
    if (hit) return true;

    /* Ни одной подходящей записи. Прежде чем отказать, убеждаемся, что список
       вообще заполнен: пустая таблица — это состояние обслуживания, и решать
       по ней «никому нельзя» так же неверно, как «можно всем». */
    const total = await prisma.emailDomainWhitelist.count({ where: { active: true } });
    if (total > 0) return false;
    return DEFAULT_WHITELIST.some((row) => row.domain === domain);
  } catch {
    /* База недоступна — работаем по встроенному набору. Регистрация с
       незнакомого домена в этот момент не пройдёт, и это правильнее, чем
       пропустить всех из-за сбоя запроса. */
    return DEFAULT_WHITELIST.some((row) => row.domain === domain);
  }
}
