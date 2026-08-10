/**
 * Тесты: src/lib/orderStages.ts — этапы работ по услуге.
 *
 * Ошибка здесь не падает, а тихо врёт заказчику о ходе его работ: показывает
 * «вёрстку» тому, кто заказал подключение к «Честному Знаку», считает проценты
 * от чужого набора или теряет отметки о выполненных этапах после того, как
 * владелец поправил список. Поэтому проверяется и каталог целиком, и подбор
 * набора по каждой из одиннадцати услуг, и всё, что происходит с отметками при
 * правке набора.
 */
import { describe, it, expect } from "vitest";
import {
  GENERIC_STAGE_KEY,
  MAX_STAGES,
  MAX_STAGE_TITLE,
  STAGE_SETS,
  defaultStagesForService,
  normalizeDoneStages,
  sanitizeStages,
  stageProgress,
  stageSetKeyForService,
  stageStatusLabel,
  stagesForService,
  stagesOfSet,
} from "@/lib/orderStages";

/** Одиннадцать услуг из prisma/seed.ts — ровно то, что видит владелец. */
const SEEDED_SERVICES: ReadonlyArray<readonly [string, string]> = [
  ["Честный Знак", "honest"],
  ["CRM Интеграция", "crm"],
  ["ИИ-Помощники", "ai-assistant"],
  ["ИИ-Автоматизация", "ai-automation"],
  ["Облачные хранилища", "cloud"],
  ["Создание сайтов", "site"],
  ["Сопровождение TZ.Ent", "tzent"],
  ["Обслуживание сайтов", "site-care"],
  ["Настройка систем", "systems"],
  ["Рекламные кампании", "ads"],
  ["Телеграм-боты", "bots"],
];

describe("каталог наборов", () => {
  it("ИНВАРИАНТ: ключи наборов не повторяются", () => {
    /* Дубль ключа означал бы, что этапы двух услуг получают одинаковые
       идентификаторы и отметки одного проекта проступают в другом. */
    const keys = STAGE_SETS.map((set) => set.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ИНВАРИАНТ: в каждом наборе есть этапы и они не повторяются", () => {
    for (const set of STAGE_SETS) {
      expect(set.titles.length, set.key).toBeGreaterThanOrEqual(5);
      expect(new Set(set.titles).size, set.key).toBe(set.titles.length);
    }
  });

  it("ИНВАРИАНТ: идентификаторы этапов внутри набора уникальны", () => {
    for (const set of STAGE_SETS) {
      const ids = stagesOfSet(set.key).map((stage) => stage.id);
      expect(new Set(ids).size, set.key).toBe(ids.length);
    }
  });

  it("названия этапов помещаются в отведённую длину", () => {
    for (const set of STAGE_SETS) {
      for (const title of set.titles) {
        expect(title.length, `${set.key}: ${title}`).toBeGreaterThan(2);
        expect(title.length, `${set.key}: ${title}`).toBeLessThanOrEqual(MAX_STAGE_TITLE);
      }
    }
  });

  it("каждый набор начинается с принятой заявки", () => {
    /* Единственное состояние, общее для любой услуги: по нему кабинет читается
       одинаково независимо от того, что человек заказал. */
    for (const set of STAGE_SETS) {
      expect(set.titles[0], set.key).toMatch(/^Заявка принята/);
    }
  });

  it("ФИКСАЦИЯ: набор «Создание сайтов» оставлен слово в слово", () => {
    /* По этим текстам миграция переводит уже накопленные отметки: номер N
       старого списка → «site-(N+1)». Любая правка формулировок здесь сместила
       бы смысл отметок у существующих проектов. */
    expect(stagesOfSet("site")).toEqual([
      { id: "site-1", title: "Заявка принята в работу" },
      { id: "site-2", title: "Материалы проекта изучены" },
      { id: "site-3", title: "Техническое задание согласовано" },
      { id: "site-4", title: "Дизайн-макет подготовлен" },
      { id: "site-5", title: "Вёрстка выполнена" },
      { id: "site-6", title: "Функционал разработан" },
      { id: "site-7", title: "Контент размещён" },
      { id: "site-8", title: "Тестирование пройдено" },
      { id: "site-9", title: "Домен и хостинг настроены" },
      { id: "site-10", title: "Проект запущен" },
    ]);
  });
});

describe("подбор набора по услуге", () => {
  it("ИНВАРИАНТ: каждая из одиннадцати услуг получает свой набор", () => {
    for (const [title, key] of SEEDED_SERVICES) {
      expect(stageSetKeyForService(title), title).toBe(key);
    }
  });

  it("ФИКСАЦИЯ: обслуживание сайтов не получает этапы разработки", () => {
    /* Оба названия содержат «сайт», и порядок проверки — единственное, что их
       различает. Перестановка наборов в каталоге сломает именно это. */
    const care = defaultStagesForService("Обслуживание сайтов").map((s) => s.title);
    expect(care).not.toContain("Вёрстка выполнена");
    expect(care).toContain("Аудит сайта проведён");
  });

  it("название разбирается независимо от регистра и падежа", () => {
    expect(stageSetKeyForService("ЧЕСТНЫЙ ЗНАК")).toBe("honest");
    expect(stageSetKeyForService("Облако для бухгалтерии")).toBe("cloud");
    expect(stageSetKeyForService("Настройка систем и инфраструктуры")).toBe("systems");
  });

  it("ИНВАРИАНТ: новая услуга владельца получает общий набор, а не этапы сайта", () => {
    /* Услуги заводит владелец, и новая не обязана попадать ни в одно слово.
       Пустота или чужие этапы здесь — прямая ложь о содержании работ. */
    const stages = defaultStagesForService("Курьерская доставка документов");
    expect(stageSetKeyForService("Курьерская доставка документов")).toBe(GENERIC_STAGE_KEY);
    expect(stages.map((s) => s.title)).toEqual([
      "Заявка принята",
      "Задача уточнена",
      "Работы ведутся",
      "Проверка",
      "Готово",
    ]);
  });

  it("услуга без названия тоже получает общий набор", () => {
    expect(stageSetKeyForService("")).toBe(GENERIC_STAGE_KEY);
    expect(defaultStagesForService(null).length).toBe(5);
  });

  it("свой набор услуги побеждает каталожный", () => {
    const stages = stagesForService({
      title: "Создание сайтов",
      stages: [{ id: "s1", title: "Свой первый этап" }, { id: "s2", title: "Свой второй" }],
    });
    expect(stages).toEqual([
      { id: "s1", title: "Свой первый этап" },
      { id: "s2", title: "Свой второй" },
    ]);
  });

  it("ФИКСАЦИЯ: проект без услуги показывает набор сайта", () => {
    /* Так вёлся КАЖДЫЙ проект до появления связи с услугой. Подменить его
       другим набором задним числом — значит сдвинуть отметки идущих работ. */
    expect(stagesForService(null).map((s) => s.id)).toEqual(stagesOfSet("site").map((s) => s.id));
  });
});

describe("разбор набора из базы", () => {
  it("не массив — своего набора нет", () => {
    expect(sanitizeStages(null)).toBeNull();
    expect(sanitizeStages(undefined)).toBeNull();
    expect(sanitizeStages("этапы")).toBeNull();
    expect(sanitizeStages({ id: "s1", title: "Этап" })).toBeNull();
  });

  it("ИНВАРИАНТ: пустой набор равносилен отсутствию набора", () => {
    /* Иначе кабинет показал бы карточку без единого этапа и без прогресса —
       заказчик прочитал бы это как «по моему заказу ничего не происходит». */
    expect(sanitizeStages([])).toBeNull();
    expect(sanitizeStages([{ id: "s1", title: "   " }])).toBeNull();
  });

  it("пустые названия выбрасываются, пробелы схлопываются", () => {
    const stages = sanitizeStages([
      { id: "s1", title: "  Первый   этап  " },
      { id: "s2", title: "" },
      { id: "s3", title: "Второй" },
    ]);
    expect(stages).toEqual([
      { id: "s1", title: "Первый этап" },
      { id: "s3", title: "Второй" },
    ]);
  });

  it("ИНВАРИАНТ: новому этапу присваивается идентификатор, повтор не проходит", () => {
    /* Два этапа с одним идентификатором означали бы одну отметку на двоих:
       отметил один — «выполнился» и второй. */
    const stages = sanitizeStages([
      { title: "Без идентификатора" },
      { id: "s1", title: "Свой" },
      { id: "s1", title: "Тот же идентификатор" },
    ])!;
    const ids = stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(stages[1]!.id).toBe("s1");
  });

  it("ИНВАРИАНТ: новый этап не отбирает идентификатор у существующего", () => {
    /* Этап, добавленный В НАЧАЛО списка, идентификатора ещё не имеет. Выдай ему
       «s1» — и настоящий «s1» ниже получил бы другой номер, а значит все
       проекты услуги разом потеряли бы отметку по нему. */
    const stages = sanitizeStages([
      { title: "Новый первый шаг" },
      { id: "s1", title: "Был первым" },
      { id: "s2", title: "Был вторым" },
    ])!;
    expect(stages[1]).toEqual({ id: "s1", title: "Был первым" });
    expect(stages[2]).toEqual({ id: "s2", title: "Был вторым" });
    expect(["s1", "s2"]).not.toContain(stages[0]!.id);
  });

  it("длинное название обрезается, лишние этапы отбрасываются", () => {
    const long = sanitizeStages([{ id: "s1", title: "я".repeat(500) }])!;
    expect(long[0]!.title.length).toBe(MAX_STAGE_TITLE);

    const many = sanitizeStages(
      Array.from({ length: MAX_STAGES + 10 }, (_, i) => ({ id: `s${i}`, title: `Этап ${i}` })),
    )!;
    expect(many.length).toBe(MAX_STAGES);
  });

  it("список простых строк тоже понимается", () => {
    /* Так набор проще завести руками в базе или в тесте, и это не должно
       заканчиваться пустотой в кабинете. */
    expect(sanitizeStages(["Первый", "Второй"])).toEqual([
      { id: "s1", title: "Первый" },
      { id: "s2", title: "Второй" },
    ]);
  });
});

describe("отметки о выполненных этапах", () => {
  const stages = stagesOfSet("honest");

  it("чужие и несуществующие отметки отбрасываются", () => {
    expect(normalizeDoneStages(["honest-1", "site-4", "мусор"], stages)).toEqual(["honest-1"]);
    expect(normalizeDoneStages("не массив", stages)).toEqual([]);
  });

  it("ИНВАРИАНТ: порядок отметок — порядок набора, а не порядок ввода", () => {
    expect(normalizeDoneStages(["honest-3", "honest-1"], stages)).toEqual(["honest-1", "honest-3"]);
  });

  it("повтор одной отметки считается один раз", () => {
    expect(normalizeDoneStages(["honest-1", "honest-1"], stages)).toEqual(["honest-1"]);
  });

  it("ФИКСАЦИЯ: старые номера пунктов ещё понимаются", () => {
    /* Совместимость на случай, если миграция не доехала: кабинет должен
       показать прогресс, а не молча обнулить его. */
    expect(normalizeDoneStages([0, 2], stagesOfSet("site"))).toEqual(["site-1", "site-3"]);
  });

  it("ИНВАРИАНТ: удалённый из набора этап теряет только свою отметку", () => {
    /* Ради этого отметки и хранятся идентификаторами. С номерами удаление
       второго этапа сдвинуло бы все последующие, и у проекта оказались бы
       отмечены не те работы. */
    const edited = sanitizeStages([
      { id: "honest-1", title: "Заявка принята" },
      { id: "honest-3", title: "Регистрация в системе маркировки" },
    ])!;
    expect(normalizeDoneStages(["honest-1", "honest-2", "honest-3"], edited)).toEqual([
      "honest-1",
      "honest-3",
    ]);
  });

  it("ИНВАРИАНТ: переименование и перестановка отметку сохраняют", () => {
    const edited = sanitizeStages([
      { id: "honest-3", title: "Регистрация в ГИС МТ" },
      { id: "honest-1", title: "Заявка получена" },
    ])!;
    expect(normalizeDoneStages(["honest-3"], edited)).toEqual(["honest-3"]);
  });
});

describe("прогресс и подпись", () => {
  it("ИНВАРИАНТ: последний этап любого набора даёт ровно 100%", () => {
    /* У «Честного Знака» восемь этапов, у сопровождения — шесть. Проценты от
       вшитой десятки показывали бы законченную работу незаконченной. */
    for (const set of STAGE_SETS) {
      const stages = stagesOfSet(set.key);
      expect(stageProgress(stages.map((s) => s.id), stages), set.key).toBe(100);
    }
  });

  it("ФИКСАЦИЯ: у набора сайта проценты остались прежними", () => {
    /* Десять пунктов по 10% — то, что заказчики уже видят у своих проектов. */
    const stages = stagesOfSet("site");
    expect(stageProgress(["site-1", "site-2", "site-3"], stages)).toBe(30);
  });

  it("чужие отметки в проценты не попадают", () => {
    const stages = stagesOfSet("bots");
    expect(stageProgress(["site-1", "site-2"], stages)).toBe(0);
  });

  it("пустой набор не делит на ноль", () => {
    expect(stageProgress(["s1"], [])).toBe(0);
  });

  it("подпись на ста процентах — последний этап набора, а не «Проект запущен»", () => {
    /* У обслуживания сайтов работа заканчивается регулярным обслуживанием, и
       никакого запуска там никто не обещал. */
    const care = stagesOfSet("site-care");
    expect(stageStatusLabel(100, "LAUNCHED", care)).toBe("На регулярном обслуживании");
    expect(stageStatusLabel(100, "IN_PROGRESS", stagesOfSet("honest"))).toBe("Работа в штатном режиме");
    expect(stageStatusLabel(100, "LAUNCHED", stagesOfSet("site"))).toBe("Проект запущен");
  });

  it("подпись на нуле и в середине", () => {
    const stages = stagesOfSet("site");
    expect(stageStatusLabel(0, "NEW", stages)).toBe("Заявка на рассмотрении");
    expect(stageStatusLabel(40, "IN_PROGRESS", stages)).toBe("Готово на 40%");
  });
});
