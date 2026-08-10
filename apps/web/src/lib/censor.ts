/**
 * Словарь цензуры сообщества: разбор текста без обращения к базе.
 *
 * Здесь только сопоставление строк — ни prisma, ни сети. Это позволяет покрыть
 * самое хрупкое место (обход фильтра) тестами и не тащить в них базу.
 *
 * ── Чего эта проверка НЕ умеет ──────────────────────────────────────────────
 *
 * Она ловит небрежный обход: другой регистр, латинские двойники кириллицы,
 * цифры вместо букв, растянутые буквы, разделители между буквами. Она НЕ ловит
 * умышленный обход — переставленные буквы, синонимы, транслит целыми словами,
 * картинку вместо текста. Обещать «фильтрацию мата» такой механизм не может, и
 * притворяться обратным вредно: администратор должен понимать, что счётчик
 * показывает замеченное, а не всё сказанное.
 *
 * Сопоставление идёт ПОДСТРОКОЙ, а не по целому слову. Для русского это
 * сознательный выбор: без него в словарь пришлось бы вносить все формы
 * («дурак», «дурака», «дураками»). Обратная сторона — ложные срабатывания на
 * словах, внутри которых лежит корень из словаря. Поэтому в словарь стоит
 * вносить корни, а не слова целиком, и помнить, что «Херсон» поймается на
 * «хер».
 */

/** Строгость: что делать, когда слово из словаря встретилось в тексте. */
export const CENSOR_LEVELS = ["BLOCK", "WARN", "WATCH"] as const;
export type CensorLevel = (typeof CENSOR_LEVELS)[number];

export function isCensorLevel(value: unknown): value is CensorLevel {
  return typeof value === "string" && (CENSOR_LEVELS as readonly string[]).includes(value);
}

/**
 * Подписи для интерфейса. «Жёсткая блокировка» переименована: блокировкой в
 * проекте называют бан участника, и одно слово на два разных действия путает —
 * здесь речь только о том, что сообщение не уйдёт.
 */
export const CENSOR_LEVEL_LABELS: Record<CensorLevel, string> = {
  BLOCK: "Запрет",
  WARN: "Предупреждение",
  WATCH: "Наблюдение",
};

export const CENSOR_LEVEL_HINTS: Record<CensorLevel, string> = {
  BLOCK: "Сообщение не отправляется. Человек видит отказ и может переписать текст.",
  WARN: "Сообщение уходит, но человеку показывается карточка о рамках приличия.",
  WATCH: "Ничего не показывается. Слово молча идёт в счётчик для администрации.",
};

/** Порядок строгости: чем больше, тем строже. Нужен, чтобы выбрать худший исход. */
const LEVEL_RANK: Record<CensorLevel, number> = { WATCH: 0, WARN: 1, BLOCK: 2 };

export function strictestLevel(levels: readonly CensorLevel[]): CensorLevel | null {
  let best: CensorLevel | null = null;
  for (const level of levels) {
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

/** Предел на длину записи словаря: 64 знака хватает любому корню. */
export const CENSOR_WORD_MAX = 64;
/** Меньше двух букв — это не слово, а фильтр «всё подряд». */
export const CENSOR_WORD_MIN = 2;
/** Предел размера словаря на сообщество: разбор идёт на каждое сообщение. */
export const CENSOR_DICTIONARY_MAX = 300;

/**
 * Латинские и цифровые двойники кириллицы. Набор сознательно короткий: только
 * то, что действительно похоже начертанием и встречается в обходах.
 */
const LOOKALIKES: Record<string, string> = {
  a: "а", b: "ь", c: "с", e: "е", h: "н", k: "к", m: "м",
  o: "о", p: "р", t: "т", x: "х", y: "у",
  "0": "о", "3": "з", "4": "ч", "6": "б",
};

/** Невидимые знаки, которыми разрывают слово: пробелы нулевой ширины и метки. */
const INVISIBLE = /[­​-‏‪-‮⁠﻿]/g;

/**
 * Приведение к виду, в котором сравнение осмысленно.
 *
 * Одинаково применяется и к тексту, и к записи словаря — иначе «класс» в
 * словаре никогда не совпадёт с «класс» в тексте после схлопывания повторов.
 */
export function normalizeForCensor(input: string): string {
  /* Порядок важен, и на нём я уже ошибся: NFKD раскладывает «ё» на «е» плюс
     отдельный знак диакритики, поэтому замена /ё/ ПОСЛЕ разложения не срабатывала
     никогда — в тексте оставалась «е» со знаком, и слово с «ё» не находилось.
     Снимаем все комбинирующие знаки сразу после разложения: это заодно убирает
     ударения и прочую диакритику, которой тоже разрывают слова. */
  let out = input.normalize("NFKD").replace(/\p{M}/gu, "").replace(INVISIBLE, "").toLowerCase();
  out = out.replace(/ё/g, "е");
  out = out.replace(/[abcehkmoptxy0346]/g, (ch) => LOOKALIKES[ch] ?? ch);
  // Растянутые буквы: «дуррак», «сууука». Схлопываем на обеих сторонах.
  out = out.replace(/(.)\1+/g, "$1");
  return out;
}

/** Тот же текст без всего, что не буква и не цифра: ловит «д.у.р.а.к». */
function squeeze(normalized: string): string {
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface CensorEntry {
  /** Что искать. Нормализуется внутри — снаружи можно хранить как ввели. */
  word: string;
  level: CensorLevel;
}

export interface CensorMatch {
  /** Запись словаря в исходном виде — её показывают администратору. */
  word: string;
  level: CensorLevel;
}

export interface CensorVerdict {
  matches: CensorMatch[];
  /** Строжайший из сработавших уровней, null — ничего не нашлось. */
  level: CensorLevel | null;
}

/**
 * Найти в тексте записи словаря.
 *
 * Проверяются два представления текста: с разделителями и без них. Первое
 * находит обычное упоминание, второе — разорванное точками или пробелами.
 * Пустой словарь означает «проверка выключена» — обходимся без работы.
 */
export function matchCensorWords(text: string, dictionary: readonly CensorEntry[]): CensorVerdict {
  if (!text || dictionary.length === 0) return { matches: [], level: null };

  const normalized = normalizeForCensor(text);
  const squeezed = squeeze(normalized);
  if (!normalized) return { matches: [], level: null };

  const matches: CensorMatch[] = [];
  const seen = new Set<string>();
  for (const entry of dictionary) {
    const needle = normalizeForCensor(entry.word);
    if (needle.length < CENSOR_WORD_MIN) continue;
    const squeezedNeedle = squeeze(needle);
    const hit = normalized.includes(needle) || (!!squeezedNeedle && squeezed.includes(squeezedNeedle));
    if (!hit) continue;
    // Одно и то же слово могло попасть в словарь дважды разными регистрами.
    const key = needle;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ word: entry.word, level: entry.level });
  }

  return { matches, level: strictestLevel(matches.map((m) => m.level)) };
}

/**
 * Проверка записи перед сохранением в словарь.
 *
 * Возвращает готовое к записи слово или причину отказа. Обрезаем пробелы и
 * приводим к нижнему регистру: словарь регистр не различает, и две записи
 * «Дурак»/«дурак» — это одна запись, а не две.
 */
export function normalizeCensorWordInput(raw: unknown): { word: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Слово должно быть строкой" };
  const word = raw.trim().replace(INVISIBLE, "").toLowerCase();
  if (word.length < CENSOR_WORD_MIN) return { error: `Не короче ${CENSOR_WORD_MIN} знаков` };
  if (word.length > CENSOR_WORD_MAX) return { error: `Не длиннее ${CENSOR_WORD_MAX} знаков` };
  // Разбор идёт по подстроке, поэтому запись из одних разделителей поймала бы
  // любой текст — такую в словарь не пускаем.
  if (!/[\p{L}\p{N}]/u.test(word)) return { error: "Слово должно содержать буквы или цифры" };
  return { word };
}
