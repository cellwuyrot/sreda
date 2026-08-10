/**
 * Тесты: src/lib/channelModules.ts — единый список рабочих модулей группы.
 *
 * Этот список раньше был выписан руками в четырёх местах: панель «Разделы»,
 * список каналов, «Рабочая среда» в настройках и whitelist типов в API. Копии
 * разъехались молча — интерфейс не падает от того, что канал числится модулем
 * в одном месте и обычным каналом в другом, он просто показывает его дважды
 * или не показывает вовсе. Тесты держат состав списка и фиксируют, что каждое
 * из четырёх мест теперь спрашивает один и тот же источник.
 */
import { describe, it, expect } from "vitest";
import {
  CHANNEL_MODULES,
  CHANNEL_TYPES,
  CHAT_CHANNEL_TYPES,
  MODULE_TYPES,
  isChannelType,
  isModuleType,
  moduleByType,
} from "@/lib/channelModules";

describe("список модулей", () => {
  it("ИНВАРИАНТ: восемь модулей — тот же набор, что был разложен по четырём местам", () => {
    /* Список сверяется целиком, а не «длина больше нуля»: пропажа модуля
       означает, что его канал исчезнет из панели «Разделы» и провалится в
       общий список каналов, а лишний тип — карточку, которую сервер откажется
       создавать. */
    expect(MODULE_TYPES).toEqual([
      "NEWS",
      "QA",
      "WIKI",
      "CALENDAR",
      "DOCS",
      "TASKS",
      "CANVAS",
      "COMMUNITY",
    ]);
  });

  it("ИНВАРИАНТ: APPEALS модулем не считается", () => {
    /* Решение по разъехавшимся спискам: «Обращения» — канал платформенной
       поддержки, разбирать его может только глобальный админ. Числись он
       модулем — на десктопе показывался бы дважды (в колонке модулей и в
       списке каналов), как и было до объединения списков. Типом канала он при
       этом остаётся: канал обращений главного сообщества никуда не делся. */
    expect(isModuleType("APPEALS")).toBe(false);
    expect(isChannelType("APPEALS")).toBe(true);
  });

  it("ИНВАРИАНТ: у каждого модуля свой тип, подпись и имя по умолчанию", () => {
    /* Дубль типа — две одинаковые карточки в настройках; пустое имя — канал
       без названия в списке. */
    const types = CHANNEL_MODULES.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    for (const m of CHANNEL_MODULES) {
      expect(m.label.length, m.type).toBeGreaterThan(2);
      expect(m.defaultName.length, m.type).toBeGreaterThan(2);
    }
  });

  it("ФИКСАЦИЯ: имя по умолчанию совпадает с подписью модуля", () => {
    /* На это опираются шаблоны сообществ: развёрнутый шаблоном раздел и
       добавленный вручную должны называться одинаково, иначе в одной группе
       «Новости», а в другой «важная-информация». */
    for (const m of CHANNEL_MODULES) {
      expect(m.defaultName, m.type).toBe(m.label);
    }
  });

  it("описание модуля ищется по типу и не выдумывается", () => {
    expect(moduleByType("CANVAS")?.defaultName).toBe("Рабочая среда");
    expect(moduleByType("APPEALS")).toBeNull();
    expect(moduleByType("нет такого")).toBeNull();
  });
});

describe("whitelist типов канала", () => {
  it("ИНВАРИАНТ: whitelist — это модули плюс переписка, категория и обращения", () => {
    /* Ровно то, что раньше перечисляли в POST /api/channels. Пропажа типа
       отсюда означает, что сервер тихо подменит его на TEXT: панель модулей
       уже показала бы карточку, а канал создался бы перепиской. */
    expect([...CHANNEL_TYPES].sort()).toEqual(
      [...CHAT_CHANNEL_TYPES, ...MODULE_TYPES, "APPEALS", "CATEGORY"].sort(),
    );
    expect(new Set(CHANNEL_TYPES).size).toBe(CHANNEL_TYPES.length);
  });

  it("ИНВАРИАНТ: каждый модуль допустим как тип канала", () => {
    /* Иначе кнопка «Добавить» в настройках создавала бы обычный TEXT-канал —
       карточка модуля осталась бы «не подключено» навсегда. */
    for (const type of MODULE_TYPES) {
      expect(isChannelType(type), type).toBe(true);
    }
  });

  it("ФИКСАЦИЯ: COMMUNITY проходит проверку типа", () => {
    /* Модуль «Общественность» добавили позже, и в whitelist смены типа канала
       (PUT /api/channels/[id]) его забыли — смена типа молча не применялась. */
    expect(isChannelType("COMMUNITY")).toBe(true);
    expect(isModuleType("COMMUNITY")).toBe(true);
  });

  it("чужое и мусор не проходят", () => {
    expect(isChannelType("DROP TABLE")).toBe(false);
    expect(isChannelType("text")).toBe(false);
    expect(isChannelType(undefined)).toBe(false);
    expect(isChannelType(null)).toBe(false);
    expect(isModuleType(42)).toBe(false);
    expect(isModuleType("TEXT")).toBe(false);
    expect(isModuleType("CATEGORY")).toBe(false);
  });
});
