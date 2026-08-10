/**
 * TPL: заготовки досок рабочей среды.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Пустой холст — худший экран в любом инструменте. Человек открывает доску,
 * видит «Пусто. Добавьте первый узел» и закрывает: не потому, что не нужно, а
 * потому что непонятно, с чего начинать. Заготовка отвечает на этот вопрос за
 * него — разворачивает готовую доску, которую остаётся поправить под себя.
 *
 * Сферы намеренно разные: работа, увлечения и личные цели. Инструмент один и
 * тот же, а показать это можно только примерами из разной жизни — иначе доска
 * читается как «ещё один таск-трекер для офиса».
 *
 * ── Почему только на пустую доску ───────────────────────────────────────────
 *
 * Заготовка кладёт полтора десятка карточек. Поверх существующей работы это
 * месиво: чужие карточки вперемешку со своими, и разобрать их обратно нечем —
 * отмена на холсте помнит последние шаги, а не «то, что было до». Пустая доска
 * снимает вопрос: терять нечего. Холстов в разделе несколько, так что завести
 * новый под заготовку — одно нажатие.
 *
 * Здесь только данные и раскладка: ни React, ни обращений к серверу.
 */

export type TemplateSphere = "work" | "hobby" | "personal";

export const SPHERE_LABEL: Record<TemplateSphere, string> = {
  work: "Работа",
  hobby: "Увлечения",
  personal: "Личные цели",
};

export const SPHERE_ORDER: TemplateSphere[] = ["work", "hobby", "personal"];

/** Виды карточек, из которых собираются заготовки. */
export type TemplateKind = "task" | "note" | "link" | "table" | "document";

export type TemplateColor = "red" | "blue" | "gray" | "green";

export interface TemplateCard {
  kind: TemplateKind;
  title: string;
  color?: TemplateColor;
  /** Место в сетке: столбец слева направо, строка сверху вниз. */
  col: number;
  row: number;
  /** Заметка — текст; задача — короткая заметка под чек-листом. */
  body?: string;
  checklist?: string[];
  status?: "todo" | "doing" | "done";
  priority?: "p1" | "p2" | "p3" | "p4";
  url?: string;
  cells?: string[][];
  /** Документ: обычный текст. */
  text?: string;
  fileName?: string;
  tags?: string[];
}

export interface BoardTemplate {
  id: string;
  name: string;
  sphere: TemplateSphere;
  /** Одна строка о том, для чего это. */
  summary: string;
  cards: TemplateCard[];
  /** Связи по номерам карточек в массиве: [откуда, куда]. */
  edges?: [number, number][];
}

/** Шаг сетки при раскладке. Совпадает с шириной карточки плюс воздух. */
export const TPL_COL_WIDTH = 340;
export const TPL_ROW_HEIGHT = 280;

/* ── Каталог ────────────────────────────────────────────────────────────────
 * Десять заготовок: четыре рабочих, три из увлечений, три личных. Каждая — не
 * набор пустых карточек, а уже заполненный каркас: чек-листы с настоящими
 * пунктами, таблицы с заголовками столбцов, заметки с вопросами, на которые
 * стоит ответить до начала. Пустой каркас пришлось бы заполнять — то есть
 * решать ровно ту задачу, ради которой заготовку и берут. */

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "launch",
    name: "Запуск продукта",
    sphere: "work",
    summary: "От замысла до разбора после релиза",
    cards: [
      {
        kind: "note",
        title: "Что запускаем",
        color: "blue",
        col: 0,
        row: 0,
        body: "Кому это нужно и какую их задачу решает.\nЧем меряем успех через месяц.\nЧто НЕ входит в этот запуск.",
      },
      {
        kind: "task",
        title: "Подготовка",
        color: "blue",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Собрать требования", "Оценить сроки", "Согласовать бюджет", "Назначить ответственных"],
      },
      {
        kind: "task",
        title: "Разработка",
        color: "gray",
        col: 2,
        row: 0,
        priority: "p2",
        checklist: ["Основной сценарий", "Крайние случаи", "Тексты и картинки", "Проверка на живых данных"],
      },
      {
        kind: "note",
        title: "Риски",
        color: "red",
        col: 0,
        row: 1,
        body: "Что может пойти не так и что делаем, если пойдёт.\nКто узнает первым.",
      },
      {
        kind: "table",
        title: "Каналы объявления",
        color: "gray",
        col: 1,
        row: 1,
        cells: [
          ["Канал", "Дата", "Кто готовит", "Готово"],
          ["Письмо клиентам", "", "", ""],
          ["Соцсети", "", "", ""],
          ["Сайт", "", "", ""],
        ],
      },
      {
        kind: "task",
        title: "Разбор после релиза",
        color: "green",
        col: 2,
        row: 1,
        priority: "p3",
        checklist: ["Что сработало", "Что нет", "Что меняем в следующий раз"],
        body: "Провести через неделю после запуска, пока помнится.",
      },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 5],
      [3, 1],
    ],
  },

  {
    id: "hiring",
    name: "Найм сотрудника",
    sphere: "work",
    summary: "Воронка от вакансии до первой недели",
    cards: [
      {
        kind: "note",
        title: "Профиль вакансии",
        color: "blue",
        col: 0,
        row: 0,
        body: "Что человек будет делать в первые три месяца.\nБез чего точно не справится.\nЧему готовы научить.\nВилка.",
      },
      {
        kind: "task",
        title: "Разместить вакансию",
        color: "blue",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Текст вакансии", "Площадки", "Ответственный за отклики"],
      },
      {
        kind: "table",
        title: "Кандидаты",
        color: "gray",
        col: 2,
        row: 0,
        cells: [
          ["Имя", "Этап", "Дата", "Впечатление"],
          ["", "Отклик", "", ""],
          ["", "Созвон", "", ""],
          ["", "Финал", "", ""],
        ],
      },
      {
        kind: "note",
        title: "Вопросы на собеседовании",
        color: "gray",
        col: 0,
        row: 1,
        body: "Одинаковые для всех — иначе кандидатов не сравнить.\nПро реальные задачи, а не про определения.",
      },
      {
        kind: "task",
        title: "Оффер",
        color: "green",
        col: 1,
        row: 1,
        priority: "p1",
        checklist: ["Условия согласованы", "Оффер отправлен", "Дата выхода назначена"],
      },
      {
        kind: "task",
        title: "Первая неделя",
        color: "green",
        col: 2,
        row: 1,
        priority: "p2",
        checklist: ["Доступы", "Знакомство с командой", "Первая маленькая задача", "Разговор в конце недели"],
        body: "Кто отвечает за новичка эту неделю.",
      },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 4],
      [4, 5],
      [3, 2],
    ],
  },

  {
    id: "manager-week",
    name: "Неделя руководителя",
    sphere: "work",
    summary: "Приоритеты, делегированное и итоги — по кругу",
    cards: [
      {
        kind: "note",
        title: "Три главных дела недели",
        color: "red",
        col: 0,
        row: 0,
        body: "1.\n2.\n3.\n\nЕсли на неделе выйдет только это — неделя удалась.",
      },
      {
        kind: "task",
        title: "Делегировано",
        color: "blue",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Кому", "Что именно", "К какому сроку", "Когда проверю"],
        body: "Поставить напоминание на день проверки.",
      },
      {
        kind: "task",
        title: "Встречи",
        color: "gray",
        col: 2,
        row: 0,
        priority: "p3",
        checklist: ["Повестка заранее", "Решения записаны", "Поручения розданы"],
      },
      {
        kind: "task",
        title: "Ждёт ответа",
        color: "red",
        col: 0,
        row: 1,
        priority: "p2",
        body: "Кому написал и жду. Проверить, если тишина больше двух дней.",
      },
      {
        kind: "note",
        title: "Итоги недели",
        color: "green",
        col: 1,
        row: 1,
        body: "Что сдвинулось.\nЧто застряло и почему.\nЧто переношу и не вру ли себе.",
      },
      {
        kind: "note",
        title: "Не мои задачи",
        color: "gray",
        col: 2,
        row: 1,
        body: "То, что прилетело, но должен делать не я. Кому передал.",
      },
    ],
    edges: [
      [0, 1],
      [1, 3],
      [2, 4],
      [1, 4],
    ],
  },

  {
    id: "incident",
    name: "Разбор инцидента",
    sphere: "work",
    summary: "Хронология, причина и что не даст повториться",
    cards: [
      {
        kind: "note",
        title: "Что произошло",
        color: "red",
        col: 0,
        row: 0,
        body: "Когда началось и когда закончилось.\nКого затронуло.\nКак узнали — сами или от людей.",
      },
      {
        kind: "table",
        title: "Хронология",
        color: "gray",
        col: 1,
        row: 0,
        cells: [
          ["Время", "Что случилось", "Кто заметил"],
          ["", "", ""],
          ["", "", ""],
          ["", "", ""],
        ],
      },
      {
        kind: "note",
        title: "Причина",
        color: "red",
        col: 2,
        row: 0,
        body: "Не «кто виноват», а «что позволило этому случиться».\nПочему не заметили раньше.",
      },
      {
        kind: "task",
        title: "Починить сейчас",
        color: "blue",
        col: 0,
        row: 1,
        priority: "p1",
        checklist: ["Устранить последствия", "Проверить, что не повторяется", "Сообщить затронутым"],
      },
      {
        kind: "task",
        title: "Чтобы не повторилось",
        color: "green",
        col: 1,
        row: 1,
        priority: "p2",
        checklist: ["Предупреждение сработает раньше", "Проверка при выкатке", "Запись в правилах"],
      },
      {
        kind: "document",
        title: "Отчёт",
        color: "gray",
        col: 2,
        row: 1,
        fileName: "разбор.txt",
        text: "Что произошло:\n\nПочему:\n\nЧто сделали:\n\nЧто изменим:\n",
      },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [4, 5],
    ],
  },

  {
    id: "trip",
    name: "Путешествие",
    sphere: "hobby",
    summary: "Маршрут, брони и список вещей в одном месте",
    cards: [
      {
        kind: "note",
        title: "Куда и когда",
        color: "blue",
        col: 0,
        row: 0,
        body: "Даты.\nСколько человек.\nРади чего едем — а то поездка превращается в перебежки между точками.",
      },
      {
        kind: "table",
        title: "Бюджет",
        color: "green",
        col: 1,
        row: 0,
        cells: [
          ["Статья", "План", "Факт"],
          ["Дорога", "", ""],
          ["Жильё", "", ""],
          ["Еда", "", ""],
          ["Развлечения", "", ""],
        ],
      },
      {
        kind: "task",
        title: "Брони",
        color: "red",
        col: 2,
        row: 0,
        priority: "p1",
        checklist: ["Билеты туда", "Билеты обратно", "Жильё", "Трансфер"],
        body: "Сложить подтверждения в одно место.",
      },
      {
        kind: "task",
        title: "Документы",
        color: "red",
        col: 0,
        row: 1,
        priority: "p1",
        checklist: ["Паспорт годен", "Виза", "Страховка", "Копии в телефоне"],
      },
      {
        kind: "note",
        title: "Что взять",
        color: "gray",
        col: 1,
        row: 1,
        body: "Аптечка.\nЗарядки и переходник.\nОдежда по погоде.\nТо, что забываю каждый раз:",
      },
      {
        kind: "note",
        title: "Хочу успеть",
        color: "blue",
        col: 2,
        row: 1,
        body: "Места и дела по дням. Не больше двух на день — остальное всё равно не выйдет.",
      },
    ],
    edges: [
      [0, 2],
      [0, 1],
      [2, 3],
      [0, 5],
    ],
  },

  {
    id: "fitness",
    name: "Тренировки и форма",
    sphere: "hobby",
    summary: "План недели, замеры и честная проверка раз в месяц",
    cards: [
      {
        kind: "note",
        title: "Цель и срок",
        color: "blue",
        col: 0,
        row: 0,
        body: "Что хочу и к какому месяцу.\nКак пойму, что дошёл, — в числах, а не в ощущениях.",
      },
      {
        kind: "task",
        title: "План недели",
        color: "green",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Понедельник", "Среда", "Пятница", "Прогулка в выходной"],
        body: "Пропустил — не наверстываю, просто иду дальше по плану.",
      },
      {
        kind: "table",
        title: "Замеры",
        color: "gray",
        col: 2,
        row: 0,
        cells: [
          ["Дата", "Вес", "Сон", "Самочувствие"],
          ["", "", "", ""],
          ["", "", "", ""],
        ],
      },
      {
        kind: "note",
        title: "Еда",
        color: "gray",
        col: 0,
        row: 1,
        body: "Что меняю: одно правило за раз.\nЧто держится, а что нет.",
      },
      {
        kind: "task",
        title: "Проверка раз в месяц",
        color: "blue",
        col: 1,
        row: 1,
        priority: "p3",
        checklist: ["Сверить замеры", "Что мешало", "Поправить план"],
        body: "Поставить напоминание на первое число.",
      },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 4],
      [3, 4],
    ],
  },

  {
    id: "craft",
    name: "Творческий проект",
    sphere: "hobby",
    summary: "От замысла до выпуска — без застревания в черновике",
    cards: [
      {
        kind: "note",
        title: "Замысел",
        color: "blue",
        col: 0,
        row: 0,
        body: "О чём это.\nДля кого.\nКогда считаю законченным — иначе доделывать можно вечно.",
      },
      {
        kind: "note",
        title: "Что вдохновляет",
        color: "gray",
        col: 1,
        row: 0,
        body: "Ссылки, имена, приёмы, которые хочу попробовать.",
      },
      {
        kind: "task",
        title: "Черновик",
        color: "green",
        col: 2,
        row: 0,
        priority: "p2",
        checklist: ["Набросок целиком", "Не править по ходу", "Отложить на неделю"],
        body: "Плохой целиком лучше отличного наполовину.",
      },
      {
        kind: "task",
        title: "Доработка",
        color: "green",
        col: 0,
        row: 1,
        priority: "p2",
        checklist: ["Свежим взглядом", "Показать одному человеку", "Убрать лишнее"],
      },
      {
        kind: "task",
        title: "Выпуск",
        color: "red",
        col: 1,
        row: 1,
        priority: "p2",
        checklist: ["Где публикую", "Что напишу к этому", "Дата"],
      },
    ],
    edges: [
      [0, 2],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },

  {
    id: "year-goals",
    name: "Год: цели и привычки",
    sphere: "personal",
    summary: "Одна цель, четыре квартала и ежемесячная сверка",
    cards: [
      {
        kind: "note",
        title: "Главное в этом году",
        color: "red",
        col: 0,
        row: 0,
        body: "Одна вещь. Не пять.\nПочему именно она.\nОт чего придётся отказаться ради неё.",
      },
      {
        kind: "task",
        title: "Первый квартал",
        color: "blue",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Что должно быть сделано к марту"],
      },
      {
        kind: "task",
        title: "Второй квартал",
        color: "blue",
        col: 2,
        row: 0,
        priority: "p3",
        checklist: ["Что должно быть сделано к июню"],
      },
      {
        kind: "task",
        title: "Третий квартал",
        color: "blue",
        col: 0,
        row: 1,
        priority: "p3",
        checklist: ["Что должно быть сделано к сентябрю"],
      },
      {
        kind: "task",
        title: "Четвёртый квартал",
        color: "blue",
        col: 1,
        row: 1,
        priority: "p3",
        checklist: ["Что должно быть сделано к декабрю"],
      },
      {
        kind: "table",
        title: "Привычки",
        color: "green",
        col: 2,
        row: 1,
        cells: [
          ["Привычка", "Нед. 1", "Нед. 2", "Нед. 3", "Нед. 4"],
          ["", "", "", "", ""],
          ["", "", "", "", ""],
        ],
      },
      {
        kind: "task",
        title: "Сверка раз в месяц",
        color: "gray",
        col: 0,
        row: 2,
        priority: "p3",
        checklist: ["Что сдвинулось", "Что не начал и почему", "Что убираю из плана"],
        body: "Поставить напоминание на последний день месяца.",
      },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 6],
      [5, 6],
    ],
  },

  {
    id: "money",
    name: "Финансы: подушка и долги",
    sphere: "personal",
    summary: "Куда уходит, что откладываю, когда закрою долги",
    cards: [
      {
        kind: "table",
        title: "Месяц",
        color: "gray",
        col: 0,
        row: 0,
        cells: [
          ["Статья", "План", "Факт"],
          ["Доход", "", ""],
          ["Обязательные траты", "", ""],
          ["Еда", "", ""],
          ["Остальное", "", ""],
          ["Отложено", "", ""],
        ],
      },
      {
        kind: "task",
        title: "Подушка",
        color: "green",
        col: 1,
        row: 0,
        priority: "p1",
        checklist: ["Посчитать месячные траты", "Цель — три таких суммы", "Откладывать в день зарплаты"],
        body: "Не «что останется», а первым платежом самому себе.",
      },
      {
        kind: "table",
        title: "Долги",
        color: "red",
        col: 2,
        row: 0,
        cells: [
          ["Кому", "Сумма", "Ставка", "Платёж до"],
          ["", "", "", ""],
          ["", "", "", ""],
        ],
      },
      {
        kind: "note",
        title: "Правила трат",
        color: "blue",
        col: 0,
        row: 1,
        body: "Покупка дороже N — сутки подумать.\nПодписки пересматриваю раз в квартал.\nЧто считаю пустой тратой:",
      },
      {
        kind: "task",
        title: "Свериться в конце месяца",
        color: "gray",
        col: 1,
        row: 1,
        priority: "p2",
        checklist: ["Занести факт", "Сравнить с планом", "Поправить план на следующий месяц"],
        body: "Поставить напоминание на 28-е число.",
      },
    ],
    edges: [
      [0, 1],
      [0, 4],
      [2, 1],
      [3, 4],
    ],
  },

  {
    id: "learning",
    name: "Обучение",
    sphere: "personal",
    summary: "Язык, курс или навык — с практикой, а не только с материалами",
    cards: [
      {
        kind: "note",
        title: "Чему учусь и зачем",
        color: "blue",
        col: 0,
        row: 0,
        body: "Что хочу уметь через полгода — конкретным делом, а не «знать язык».\nСколько часов в неделю честно есть.",
      },
      {
        kind: "task",
        title: "Занятия",
        color: "green",
        col: 1,
        row: 0,
        priority: "p2",
        checklist: ["Три раза в неделю по часу", "Одно и то же время", "Отмечать сделанное"],
        body: "Короткие занятия чаще работают лучше длинных по выходным.",
      },
      {
        kind: "note",
        title: "Материалы",
        color: "gray",
        col: 2,
        row: 0,
        body: "Один основной источник и не больше двух дополнительных.\nОстальное — способ не начинать.",
      },
      {
        kind: "task",
        title: "Практика",
        color: "red",
        col: 0,
        row: 1,
        priority: "p1",
        checklist: ["Где применяю в жизни", "Первое маленькое дело", "Второе"],
        body: "Без этого выученное забывается за месяц.",
      },
      {
        kind: "task",
        title: "Проверка раз в две недели",
        color: "gray",
        col: 1,
        row: 1,
        priority: "p3",
        checklist: ["Что уже умею", "Где буксую", "Что меняю в занятиях"],
      },
    ],
    edges: [
      [0, 1],
      [2, 1],
      [1, 3],
      [3, 4],
    ],
  },
];

/** Заготовки одной сферы — так они и показываются в панели. */
export function templatesBySphere(sphere: TemplateSphere): BoardTemplate[] {
  return BOARD_TEMPLATES.filter((t) => t.sphere === sphere);
}

export function templateById(id: string): BoardTemplate | null {
  return BOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Пуста ли доска.
 *
 * Пустой считается доска без карточек и без связей. Одна забытая заметка —
 * повод не разворачивать заготовку: человек мог начать работу и не захочет
 * разбирать её вперемешку с пятнадцатью чужими карточками.
 */
export function isBoardEmpty(cards: unknown[], edges: unknown[]): boolean {
  return cards.length === 0 && edges.length === 0;
}

/** Карточка в том виде, в каком её принимает холст. */
export interface BuiltCard {
  id: string;
  type: TemplateKind;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  title: string;
  tags: string[];
  color: TemplateColor;
  [extra: string]: unknown;
}

export interface BuiltEdge {
  id: string;
  from: string;
  to: string;
}

/**
 * Разложить заготовку по холсту.
 *
 * Раскладка считается из сетки, а не хранится координатами: так заготовку можно
 * дописать одной строкой, не пересчитывая соседей вручную. Начало — левый
 * верхний угол видимой области, чтобы развёрнутая доска оказалась перед
 * глазами, а не за краем экрана.
 */
export function instantiateTemplate(
  template: BoardTemplate,
  makeId: () => string,
  origin: { x: number; y: number },
  now: number = Date.now(),
): { cards: BuiltCard[]; edges: BuiltEdge[] } {
  const cards: BuiltCard[] = template.cards.map((card, index) => {
    const base: BuiltCard = {
      id: makeId(),
      type: card.kind,
      x: origin.x + card.col * TPL_COL_WIDTH,
      y: origin.y + card.row * TPL_ROW_HEIGHT,
      /* Порядок наложения по номеру: карточки заготовки не перекрывают друг
         друга, но при перетаскивании поверх окажется та, что ниже по списку. */
      z: index + 1,
      createdAt: now,
      title: card.title,
      tags: card.tags ?? [],
      color: card.color ?? "gray",
    };

    if (card.kind === "task") {
      base.status = card.status ?? "todo";
      base.priority = card.priority ?? "p3";
      base.progress = 0;
      base.deadline = "";
      base.note = card.body ?? "";
      base.checklist = (card.checklist ?? []).map((text) => ({ id: makeId(), text, done: false }));
    } else if (card.kind === "note") {
      base.body = card.body ?? "";
    } else if (card.kind === "link") {
      base.url = card.url ?? "";
      base.project = "";
    } else if (card.kind === "table") {
      base.cells = (card.cells ?? [["", ""], ["", ""]]).map((row) => [...row]);
      base.hasHeader = true;
    } else {
      base.docKind = "text";
      base.fileName = card.fileName ?? "заметки.txt";
      base.text = card.text ?? "";
      base.src = "";
      base.caption = "";
    }

    return base;
  });

  const edges: BuiltEdge[] = (template.edges ?? [])
    /* Связь на несуществующую карточку — опечатка в заготовке. Молча
       пропускаем: холст с висящей связью рисуется криво. */
    .filter(([from, to]) => cards[from] && cards[to] && from !== to)
    .map(([from, to]) => ({ id: makeId(), from: cards[from]!.id, to: cards[to]!.id }));

  return { cards, edges };
}
