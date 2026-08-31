export type CommandDef = {
  name: string;
  /** Short syntax shown in autocomplete, e.g. "/ban @ник [дни] [причина]" */
  syntax: string;
  description: string;
  /** Minimum effective rank to see/use this command (RANK from groupModeration). */
  minRank: number;
  example?: string;
  /** Subcommands like ["create","list","info"] */
  subcommands?: string[];
};

// Matches ROLE_RANK from groupModeration.ts
export const CMD_RANK_MEMBER    = 1;
export const CMD_RANK_GUIDE     = 1.5;
export const CMD_RANK_MOD       = 2;
export const CMD_RANK_ADMIN     = 3;
export const CMD_RANK_OWNER     = 4;

export const SLASH_COMMANDS: CommandDef[] = [
  // ── All members ──────────────────────────────────────────────────────────
  { name: "help",          syntax: "/help [страница]",              minRank: CMD_RANK_MEMBER,   description: "Список доступных команд. /help 2 — вторая страница.",                    example: "/help 2" },
  { name: "profile",       syntax: "/profile @ник",                 minRank: CMD_RANK_MEMBER,   description: "Показать профиль участника.",                                           example: "/profile @Ivan" },
  { name: "report",        syntax: "/report @ник [причина]",        minRank: CMD_RANK_MEMBER,   description: "Пожаловаться на участника.",                                            example: "/report @Ivan спам" },
  { name: "mute",          syntax: "/mute @ник",                    minRank: CMD_RANK_MEMBER,   description: "Скрыть сообщения участника от себя (игнорирование).",                   example: "/mute @Ivan" },
  { name: "unmute",        syntax: "/unmute @ник",                  minRank: CMD_RANK_MEMBER,   description: "Отменить игнорирование участника.",                                     example: "/unmute @Ivan" },
  { name: "notify",        syntax: "/notify @ник",                  minRank: CMD_RANK_MEMBER,   description: "Включить уведомления о сообщениях участника.",                          example: "/notify @Ivan" },
  { name: "declinenotify", syntax: "/declinenotify @ник",           minRank: CMD_RANK_MEMBER,   description: "Отключить уведомления о сообщениях участника.",                         example: "/declinenotify @Ivan" },
  { name: "pin",           syntax: "/pin [номер]",                  minRank: CMD_RANK_MEMBER,   description: "Перейти к закреплённому сообщению по номеру.",                          example: "/pin 2" },
  { name: "members",       syntax: "/members",                      minRank: CMD_RANK_MEMBER,   description: "Показать список участников группы с ролями." },
  // ── Guide + Moderator ────────────────────────────────────────────────────
  { name: "warn",          syntax: "/warn @ник [причина]",          minRank: CMD_RANK_GUIDE,    description: "Предупреждение: у участника 1 минуту горит красный баннер.",             example: "/warn @Ivan нарушение правил" },
  { name: "timeout",       syntax: "/timeout @ник минуты [причина]",minRank: CMD_RANK_GUIDE,    description: "Запрет писать и заходить в голосовые каналы на N минут.",              example: "/timeout @Ivan 30 оффтоп" },
  { name: "untimeout",     syntax: "/untimeout @ник",               minRank: CMD_RANK_GUIDE,    description: "Снять таймаут с участника.",                                           example: "/untimeout @Ivan" },
  { name: "kick",          syntax: "/kick @ник [причина]",          minRank: CMD_RANK_GUIDE,    description: "Выгнать участника из группы.",                                         example: "/kick @Ivan" },
  { name: "ban",           syntax: "/ban @ник [дни] [причина]",     minRank: CMD_RANK_GUIDE,    description: "Забанить участника. Дни = 0 или не указаны → навсегда.",               example: "/ban @Ivan 7 спам" },
  { name: "unban",         syntax: "/unban @ник",                   minRank: CMD_RANK_GUIDE,    description: "Снять бан с участника.",                                               example: "/unban @Ivan" },
  { name: "history",       syntax: "/history @ник",                 minRank: CMD_RANK_GUIDE,    description: "История предупреждений, таймаутов и банов участника.",                  example: "/history @Ivan" },
  { name: "whois",         syntax: "/whois @ник",                   minRank: CMD_RANK_GUIDE,    description: "Открыть карточку профиля участника.",                                  example: "/whois @Ivan" },
  { name: "clear",         syntax: "/clear [@ник] число",           minRank: CMD_RANK_GUIDE,    description: "Удалить последние N сообщений (или N сообщений участника).",           example: "/clear @Ivan 10" },
  { name: "slowmode",      syntax: "/slowmode [секунды]",           minRank: CMD_RANK_GUIDE,    description: "Включить медленный режим (0 или без аргумента — выключить).",          example: "/slowmode 30" },
  { name: "stats",         syntax: "/stats",                        minRank: CMD_RANK_GUIDE,    description: "Статистика группы: участники, каналы, активность." },
  // ── Admin + Owner ────────────────────────────────────────────────────────
  { name: "role",          syntax: "/role название_роли @ник",      minRank: CMD_RANK_ADMIN,    description: "Выдать роль-тег или системную роль. Пробелы заменяются на _.",        example: "/role VIP @Ivan" },
  { name: "createrole",    syntax: "/createrole название [#цвет]",  minRank: CMD_RANK_ADMIN,    description: "Создать новую роль-тег. Цвет в формате #hex необязателен.",            example: "/createrole VIP #9b59b6" },
  { name: "deleterole",    syntax: "/deleterole название",          minRank: CMD_RANK_ADMIN,    description: "Удалить роль по названию.",                                            example: "/deleterole VIP" },
  { name: "invite",        syntax: "/invite create|list|info",      minRank: CMD_RANK_ADMIN,    description: "Управление приглашениями: create, list, info.",                        example: "/invite create",   subcommands: ["create", "list", "info"] },
  { name: "settings",      syntax: "/settings",                     minRank: CMD_RANK_ADMIN,    description: "Открыть настройки группы." },
  { name: "topic",         syntax: "/topic текст",                  minRank: CMD_RANK_ADMIN,    description: "Показать или временно установить тему текущего канала.",              example: "/topic Обсуждение новинок" },
];

/** Return commands available for a given effective rank. */
export function availableCommands(effectiveRank: number): CommandDef[] {
  return SLASH_COMMANDS.filter((c) => c.minRank <= effectiveRank);
}

/** Filter commands by query (prefix of command name). */
export function filterCommands(query: string, effectiveRank: number): CommandDef[] {
  const q = query.toLowerCase();
  return availableCommands(effectiveRank).filter((c) => c.name.startsWith(q));
}
