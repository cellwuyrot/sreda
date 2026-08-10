/**
 * Тесты: src/lib/communityTemplates.ts — шаблоны сообществ.
 *
 * Шаблон разворачивает готовую группу одним нажатием, и ошибка в этих данных
 * не падает, а тихо выдаёт не ту группу. Так и вышло: каналы были помечены
 * `section: true`, маршрут создания включал по этой пометке блочный режим, и
 * любая группа по премиум-шаблону открывалась как ГЛАВНОЕ сообщество TZ
 * Connect — вместо панели «Разделы — рабочие модули группы». Покрытия у
 * шаблонов не было вовсе, поэтому и заметили только по жалобе.
 *
 * Отсюда состав проверок: не «данные заполнены», а «шаблон не может снова
 * незаметно поменять группе интерфейс».
 */
import { describe, it, expect } from "vitest";
import { COMMUNITY_TEMPLATES, getCommunityTemplate } from "@/lib/communityTemplates";
import { CHAT_CHANNEL_TYPES, isChannelType, isModuleType, moduleByType } from "@/lib/channelModules";

/** Премиум-шаблоны: всё, кроме базового пустого. */
const PREMIUM_IDS = ["gaming", "project", "support", "learning"];

describe("каталог шаблонов", () => {
  it("ИНВАРИАНТ: ни один шаблон не включает блочный режим", () => {
    /* Главная проверка файла. Блочный режим — это интерфейс главного
       сообщества; включённый шаблоном, он подменял группе весь вид и прятал
       панель модулей. Признака `section` у канала шаблона больше нет и быть не
       должно: режим включает только владелец переключателем в настройках. */
    for (const template of COMMUNITY_TEMPLATES) {
      for (const channel of template.channels) {
        expect(channel, `${template.id}:${channel.name}`).not.toHaveProperty("section");
      }
    }
  });

  it("ИНВАРИАНТ: канал шаблона — либо переписка, либо рабочий модуль", () => {
    /* Третьего не дано: тип вне whitelist сервер молча подменит на TEXT, а
       тип, не известный панели модулей, создаст раздел, который негде открыть
       (ровно так вёл себя канал обращений в шаблоне «Поддержка»). */
    for (const template of COMMUNITY_TEMPLATES) {
      for (const channel of template.channels) {
        const known =
          (CHAT_CHANNEL_TYPES as readonly string[]).includes(channel.type) || isModuleType(channel.type);
        expect(known, `${template.id}:${channel.name}:${channel.type}`).toBe(true);
        expect(isChannelType(channel.type), `${template.id}:${channel.type}`).toBe(true);
      }
    }
  });

  it("ИНВАРИАНТ: каждый содержательный шаблон создаёт хотя бы один модуль", () => {
    /* Шаблон без модулей — это базовая группа под другим названием: человек
       выбрал «Проектную команду» ради задач и документов, а получил чат.
       Исключение одно и намеренное — «Базовое сообщество»: оно и есть чат с
       голосом, модули к нему добавляют потом из настроек. */
    for (const template of COMMUNITY_TEMPLATES) {
      if (template.id === "blank") continue;
      const modules = template.channels.filter((c) => isModuleType(c.type));
      expect(modules.length, template.id).toBeGreaterThan(0);
    }
    expect(COMMUNITY_TEMPLATES.find((t) => t.id === "blank")!.channels.some((c) => isModuleType(c.type))).toBe(false);
  });

  it("ИНВАРИАНТ: имена каналов внутри шаблона не повторяются", () => {
    /* Два одинаковых имени в списке каналов неразличимы: человек открывает
       «Календарь» и не понимает, почему там пусто — потому что их два. */
    for (const template of COMMUNITY_TEMPLATES) {
      const names = template.channels.map((c) => c.name);
      expect(new Set(names).size, template.id).toBe(names.length);
    }
  });

  it("ИНВАРИАНТ: премиум-шаблоны помечены признаком премиума", () => {
    /* По этому признаку маршрут создания группы отказывает обычному аккаунту.
       Потеряется признак — премиум-шаблон станет бесплатным для всех. */
    for (const template of COMMUNITY_TEMPLATES) {
      expect(template.premium, template.id).toBe(PREMIUM_IDS.includes(template.id));
    }
    expect(getCommunityTemplate("blank")?.premium).toBe(false);
  });

  it("ИНВАРИАНТ: идентификаторы шаблонов не повторяются", () => {
    /* По идентификатору шаблон ищется при создании группы: дубль означал бы,
       что разворачивается соседний. */
    const ids = COMMUNITY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ФИКСАЦИЯ: у каждого шаблона есть чат и голос", () => {
    /* Группа без чата и голоса — это набор разделов, в котором не поговорить;
       модули их не заменяют. */
    for (const template of COMMUNITY_TEMPLATES) {
      expect(template.channels.some((c) => c.type === "TEXT"), template.id).toBe(true);
      expect(template.channels.some((c) => c.type === "VOICE"), template.id).toBe(true);
    }
  });

  it("ФИКСАЦИЯ: модульные каналы названы так же, как добавленные вручную", () => {
    /* Иначе развёрнутое шаблоном и добавленное из настроек выглядит по-разному
       («важная-информация» против «Новости»), и знакомый раздел приходится
       искать глазами. Имя берётся из общего списка модулей. */
    for (const template of COMMUNITY_TEMPLATES) {
      for (const channel of template.channels) {
        if (!isModuleType(channel.type)) continue;
        expect(channel.name, `${template.id}:${channel.type}`).toBe(
          moduleByType(channel.type)?.defaultName,
        );
      }
    }
  });

  it("ФИКСАЦИЯ: у модульных каналов нет своей иконки", () => {
    /* Панель модулей рисует иконку по типу канала и поле `icon` не читает.
       Прежние значения (`announce`, `generic`, `create`, `support`) — ключи
       BlockIcons из блочного режима: они молча не делали ничего. */
    for (const template of COMMUNITY_TEMPLATES) {
      for (const channel of template.channels) {
        if (!isModuleType(channel.type)) continue;
        expect(channel.icon, `${template.id}:${channel.type}`).toBeUndefined();
      }
    }
  });

  it("ФИКСАЦИЯ: новости публикуют модераторы, а не все подряд", () => {
    /* Лента анонсов, в которую пишет кто угодно, — это ещё один общий чат. */
    for (const template of COMMUNITY_TEMPLATES) {
      for (const channel of template.channels) {
        if (channel.type !== "NEWS") continue;
        expect(channel.postAccess, template.id).toBe("MOD");
      }
    }
  });

  it("ФИКСАЦИЯ: модули CANVAS и COMMUNITY доступны шаблонам", () => {
    /* Два модуля из восьми были шаблонам недоступны вовсе: тип в них просто не
       встречался, и получить их можно было только вручную после создания. */
    const types = COMMUNITY_TEMPLATES.flatMap((t) => t.channels.map((c) => c.type));
    expect(types).toContain("CANVAS");
    expect(types).toContain("COMMUNITY");
  });

  it("шаблон ищется по идентификатору и не выдумывается", () => {
    expect(getCommunityTemplate("project")?.name).toBe("Проектная команда");
    expect(getCommunityTemplate("нет такого")).toBeNull();
    expect(getCommunityTemplate(undefined)).toBeNull();
    expect(getCommunityTemplate(42)).toBeNull();
  });
});
