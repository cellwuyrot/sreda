/**
 * Пределы длины сообщения — одни и те же для клиента и сервера.
 *
 * Раньше предел был только в символах (4000) и жил тремя копиями: в маршруте
 * каналов, в маршруте личных сообщений и атрибутом maxLength у поля ввода ЛС.
 * В канале ограничения на вводе не было вовсе: человек писал длинный текст,
 * нажимал отправить и получал отказ сервера уже после того, как всё набрал.
 *
 * Считаем и слова, и символы. Слова — то, чем человек мерит длину («не больше
 * четырёх тысяч слов»), символы — то, чем мерит база и стоимость отрисовки:
 * вставленный код или сплошная строка без пробелов почти не содержат слов, но
 * весят много.
 *
 * Предел зависит от подписки: без Premium он вдвое меньше. Проверка одна и та
 * же на клиенте и на сервере — иначе человек узнавал бы о ней только после
 * отправки, а текст ошибки различался бы.
 */

/** Сколько слов помещается в одно сообщение с подпиской. */
export const PREMIUM_MESSAGE_WORDS = 4000;

/** Без подписки — вдвое меньше. */
export const FREE_MESSAGE_WORDS = PREMIUM_MESSAGE_WORDS / 2;

/**
 * Жёсткий предел по символам. Взят с запасом под {@link PREMIUM_MESSAGE_WORDS}:
 * четыре тысячи слов по-русски — это примерно 25 тысяч знаков.
 */
export const PREMIUM_MESSAGE_CHARS = 25_000;
export const FREE_MESSAGE_CHARS = PREMIUM_MESSAGE_CHARS / 2;

/**
 * То же для сквозного шифрования: в базу уезжает не текст, а шифротекст в
 * base64, он длиннее исходного примерно наполовину.
 */
export const PREMIUM_ENCRYPTED_CHARS = 40_000;
export const FREE_ENCRYPTED_CHARS = PREMIUM_ENCRYPTED_CHARS / 2;

/** С этого объёма сообщение показывается свёрнутым. */
export const COLLAPSE_WORDS = 1200;

/**
 * …и то же по символам: длинный кусок кода бывает «одним словом» на сотню
 * строк, а занимает экран целиком.
 */
export const COLLAPSE_CHARS = 6000;

export interface MessageLimits {
  words: number;
  chars: number;
  encryptedChars: number;
}

/** Пределы для конкретного тарифа. */
export function messageLimits(premium: boolean): MessageLimits {
  return premium
    ? { words: PREMIUM_MESSAGE_WORDS, chars: PREMIUM_MESSAGE_CHARS, encryptedChars: PREMIUM_ENCRYPTED_CHARS }
    : { words: FREE_MESSAGE_WORDS, chars: FREE_MESSAGE_CHARS, encryptedChars: FREE_ENCRYPTED_CHARS };
}

/** Слова считаем по разделителям — этого достаточно и для русского, и для кода. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export interface LengthCheckOptions {
  /** Есть ли подписка: без неё пределы вдвое меньше. */
  premium?: boolean;
  /** Текст уже зашифрован — считать только символы, слов в шифротексте нет. */
  encrypted?: boolean;
}

/**
 * Проверка перед отправкой. Возвращает готовое сообщение об ошибке или null.
 * Текст один и тот же на клиенте и на сервере, чтобы человек не получал два
 * разных объяснения одного отказа.
 */
export function messageLengthError(text: string, options: LengthCheckOptions = {}): string | null {
  const premium = options.premium === true;
  const limits = messageLimits(premium);
  const maxChars = options.encrypted ? limits.encryptedChars : limits.chars;
  /* Без подписки предел вдвое меньше — говорим об этом прямо, иначе отказ
     выглядит поломкой, а не условием тарифа. */
  const hint = premium ? "" : " С подпиской Premium предел вдвое больше.";

  if (text.length > maxChars) {
    return `Сообщение длиннее ${maxChars.toLocaleString("ru-RU")} знаков — разделите его на несколько.${hint}`;
  }
  if (!options.encrypted && countWords(text) > limits.words) {
    return `Сообщение длиннее ${limits.words.toLocaleString("ru-RU")} слов — разделите его на несколько.${hint}`;
  }
  return null;
}

/** Показывать ли сообщение свёрнутым. Порог общий: он про чтение, не про тариф. */
export function isLongMessage(text: string): boolean {
  return text.length > COLLAPSE_CHARS || countWords(text) > COLLAPSE_WORDS;
}
