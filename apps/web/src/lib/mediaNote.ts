/**
 * Запись сообщения-заметки: голос и квадратное видео («кружок», только квадрат).
 *
 * Здесь только правила и состояния — ни камеры, ни DOM. Вынесено отдельно
 * затем, что самое хрупкое в этой затее не съёмка, а порядок состояний:
 * отпустил палец — пауза, нажал снова — продолжил, согласился — отправка. Такую
 * логику проверяют тестами, а не руками на телефоне.
 *
 * ── Пауза и приостановка — разные вещи ──────────────────────────────────────
 *
 * ПАУЗА: запись остановлена, но не закончена. Видно, что получилось, и можно
 * дописать — нажал и держишь снова, продолжается та же запись.
 *
 * ПРИОСТАНОВКА: человек согласился с тем, что получилось. Дописывать больше
 * нечего, запись закрывается и уходит собеседнику.
 *
 * Между ними нет промежуточного «сохранено, но не отправлено»: черновиков
 * голосовых в проекте нет, и заводить их ради одной кнопки не стоит.
 *
 * ── Почему одна запись, а не склейка кусков ─────────────────────────────────
 *
 * Продолжение сделано через `MediaRecorder.pause()` / `.resume()`, то есть это
 * ОДНА запись с паузами внутри, а не несколько отдельных файлов. Склеить два
 * webm простым сложением байтов нельзя — у второго куска свой заголовок, и
 * получившийся файл не откроется ни у кого. Пауза записи — единственный способ
 * получить один правильный файл без перекодирования на телефоне.
 *
 * ── Чего по той же причине НЕТ ──────────────────────────────────────────────
 *
 * Нет «перезаписать с середины». Запись только дописывается: отрезать хвост и
 * продолжить с выбранного места нельзя — у записи нет обратного хода. Сделать
 * это можно лишь перекодированием файла на телефоне, а это десятки секунд
 * ожидания и горячий телефон ради правки, которую проще сделать заново.
 *
 * Поэтому полоса прокрутки в мини-редакторе — для того, чтобы ПОСМОТРЕТЬ, что
 * получилось, а рядом с ней «Перезаписать»: начать дубль заново.
 */

/** Предел длительности заметки. Дальше это уже не заметка, а видео файлом. */
export const MEDIA_NOTE_MAX_SEC = 60;

/** Короче этого запись считаем случайным касанием и выбрасываем. */
export const MEDIA_NOTE_MIN_SEC = 1;

/**
 * Сторона квадрата видеозаметки. 480 — осознанный компромисс: на экране телефона
 * заметка занимает четверть ширины, разглядывать в ней нечего, а каждый лишний
 * пиксель — это байты через мобильную сеть и секунды ожидания отправки.
 */
export const VIDEO_NOTE_SIDE = 480;

/**
 * Поток данных. 700 кбит/с на видео даёт около 6 МБ на минуту — влезает и в
 * предел загрузки без подписки (10 МБ), и в ограничение nginx (30 МБ).
 */
export const VIDEO_NOTE_VIDEO_BPS = 700_000;
export const VIDEO_NOTE_AUDIO_BPS = 64_000;

export type MediaNoteKind = "audio" | "video";

/**
 * Состояние мини-редактора.
 *
 *   idle      — ничего не записано;
 *   recording — идёт запись;
 *   paused    — пауза: можно дополнить или согласиться;
 *   done      — человек согласился, запись уходит наружу.
 */
export type MediaNoteStatus = "idle" | "recording" | "paused" | "done";

export interface MediaNoteState {
  status: MediaNoteStatus;
  /** Сколько секунд уже записано, без учёта пауз. */
  recorded: number;
  /** Сколько раз запись продолжали после паузы. Показываем человеку. */
  segments: number;
}

export const MEDIA_NOTE_INITIAL: MediaNoteState = { status: "idle", recorded: 0, segments: 0 };

export type MediaNoteEvent =
  /** Нажали и держат: начать или продолжить запись. */
  | { type: "hold" }
  /** Отпустили: пауза. */
  | { type: "release" }
  /** Согласились с записанным: приостановка и отправка. */
  | { type: "commit" }
  /** Передумали: всё стереть. */
  | { type: "discard" }
  /** Прошло время записи (в секундах, накопленное значение). */
  | { type: "tick"; recorded: number };

/**
 * Переходы мини-редактора.
 *
 * Функция чистая: она не умеет ни писать, ни отправлять — только говорит, в
 * каком состоянии оказались. Так порядок состояний виден целиком в одном месте,
 * а не разбросан по обработчикам нажатий.
 */
export function mediaNoteReducer(state: MediaNoteState, event: MediaNoteEvent): MediaNoteState {
  switch (event.type) {
    case "hold":
      /* Продолжать можно только из паузы и только пока есть куда: у предела
         длительности удержание уже ничего не добавляет. */
      if (state.status === "recording" || state.status === "done") return state;
      if (state.recorded >= MEDIA_NOTE_MAX_SEC) return state;
      return {
        status: "recording",
        recorded: state.recorded,
        segments: state.segments + 1,
      };

    case "release":
      if (state.status !== "recording") return state;
      return { ...state, status: "paused" };

    case "commit":
      /* Согласиться можно и на ходу — человек может отпустить кнопку и сразу
         нажать «отправить», не дожидаясь отдельной паузы. Пустую запись не
         отправляем: это случайное касание. */
      if (state.status !== "recording" && state.status !== "paused") return state;
      if (state.recorded < MEDIA_NOTE_MIN_SEC) return state;
      return { ...state, status: "done" };

    case "discard":
      return { ...MEDIA_NOTE_INITIAL };

    case "tick": {
      if (state.status !== "recording") return state;
      const recorded = Math.min(event.recorded, MEDIA_NOTE_MAX_SEC);
      /* Дойдя до предела, сами встаём на паузу, а не обрываем отправкой: человек
         должен решить, отправлять ли, — он мог не заметить, что время вышло. */
      if (recorded >= MEDIA_NOTE_MAX_SEC) return { ...state, status: "paused", recorded };
      return { ...state, recorded };
    }

    default:
      return state;
  }
}

/** Можно ли сейчас дополнять запись. */
export function canContinue(state: MediaNoteState): boolean {
  return (
    (state.status === "idle" || state.status === "paused") && state.recorded < MEDIA_NOTE_MAX_SEC
  );
}

/** Можно ли отправлять то, что записано. */
export function canSend(state: MediaNoteState): boolean {
  return (
    (state.status === "recording" || state.status === "paused") &&
    state.recorded >= MEDIA_NOTE_MIN_SEC
  );
}

/** «0:07» — привычный вид таймера записи. */
export function formatNoteTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Сколько осталось до предела — для подсказки у таймера. */
export function noteTimeLeft(recorded: number): number {
  return Math.max(0, MEDIA_NOTE_MAX_SEC - Math.floor(recorded));
}

type SupportCheck = (mime: string) => boolean;

function defaultSupport(mime: string): boolean {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime);
}

/**
 * Порядок предпочтений по формату.
 *
 * Первым идёт то, что заведомо есть в движке Chromium (и значит в оболочке
 * Android, и в браузере на телефоне). Последний вариант — пустая строка:
 * «решай сам», иначе на неожиданном движке запись не началась бы вовсе.
 */
const AUDIO_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
const VIDEO_MIMES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export function pickNoteMime(kind: MediaNoteKind, isSupported: SupportCheck = defaultSupport): string {
  const list = kind === "video" ? VIDEO_MIMES : AUDIO_MIMES;
  for (const mime of list) {
    if (isSupported(mime)) return mime;
  }
  return "";
}

/**
 * Тип файла без параметров: `video/webm;codecs=vp9` → `video/webm`.
 *
 * `MediaRecorder` отдаёт тип вместе с кодеками, и именно эта строка уходит на
 * сервер как Content-Type части запроса. Сервер сверял её со списком разрешённых
 * точным равенством — и отвечал 415, то есть заметка не отправлялась вовсе
 * (проверено в браузере: `recorder.mimeType` = `video/webm;codecs=vp9`).
 *
 * Сервер теперь режет параметры сам, но отправлять чистый тип всё равно правильно:
 * он же попадает во вложение сообщения, и получателю «;codecs=vp9» ни к чему.
 */
export function baseMimeType(value: string | undefined | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Имя файла для загрузки. Расширение выводим из формата, а не выдумываем. */
export function noteFileName(kind: MediaNoteKind, mime: string): string {
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  return kind === "video" ? `note.${ext}` : `voice.${ext}`;
}

/** Какой камерой пишем. Заметку обычно пишут, глядя в экран, — значит передней. */
export type NoteFacing = "user" | "environment";

/** Переключение камеры. Ровно две стороны, потому и не список. */
export function nextFacing(current: NoteFacing): NoteFacing {
  return current === "user" ? "environment" : "user";
}

export const FACING_LABELS: Record<NoteFacing, string> = {
  user: "Передняя камера",
  environment: "Задняя камера",
};

/**
 * Что просим у камеры.
 *
 * Просим кадр С ЗАПАСОМ (по большей стороне), а квадрат вырезаем сами — см.
 * `squareCropRect`. Ограничение `aspectRatio: 1` телефоны игнорируют, и полагаться
 * на него нельзя.
 *
 * Раньше здесь стояла оговорка, что резать кадр самим — «второй проход
 * кодирования». Это была ошибка: рисование кадра в canvas — копирование, а не
 * кодирование; сжатие по-прежнему одно, его делает запись. Зато у синтетического
 * потока с canvas два важных свойства: файл получается действительно квадратным,
 * и источник кадров можно подменить на ходу — на этом и держится переключение
 * камеры посреди записи.
 */
export function videoNoteConstraints(facing: NoteFacing = "user"): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true },
    video: {
      facingMode: facing,
      /* Просим больше стороны квадрата: после обрезки по центру должно остаться
         из чего масштабировать, иначе заметка выйдет мыльной. */
      width: { ideal: VIDEO_NOTE_SIDE * 1.5 },
      height: { ideal: VIDEO_NOTE_SIDE * 1.5 },
      frameRate: { ideal: 24, max: 30 },
    },
  };
}

export interface SquareCrop {
  /** Что берём из кадра камеры. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Сторона квадрата, в который рисуем. */
  side: number;
}

/**
 * Обрезка кадра камеры до квадрата по центру.
 *
 * По центру, а не по верху: в заметке человек держит телефон перед собой, и лицо
 * оказывается в середине кадра. Обрезка по верху уводила бы его вниз на
 * вертикальном кадре и вбок на горизонтальном.
 *
 * Сторона квадрата не больше короткой стороны кадра — иначе пришлось бы
 * дорисовывать пустоту.
 */
export function squareCropRect(width: number, height: number, side = VIDEO_NOTE_SIDE): SquareCrop {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0, side };
  }
  const source = Math.min(width, height);
  return {
    sx: Math.round((width - source) / 2),
    sy: Math.round((height - source) / 2),
    sw: source,
    sh: source,
    side,
  };
}

/**
 * Доля позиции по полосе прокрутки: 0 — начало, 1 — конец.
 *
 * Считается по нажатию в любом месте полосы и при перетаскивании, поэтому
 * значение обязательно зажимается: палец легко уходит за края полосы, и без
 * зажима заметка прыгала бы на отрицательное время.
 */
export function seekFraction(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clampFraction((clientX - left) / width);
}

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Доля в секунды. Нужна и полосе записи, и полосе проигрывателя. */
export function fractionToTime(fraction: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clampFraction(fraction) * duration;
}

/** Секунды в долю — обратный перевод для отрисовки положения. */
export function timeToFraction(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clampFraction(time / duration);
}

/** Что просим у микрофона для голосовой заметки. */
export function audioNoteConstraints(): MediaStreamConstraints {
  return { audio: { echoCancellation: true, noiseSuppression: true } };
}

/** Настройки записи: битрейт задаём только для видео. */
export function noteRecorderOptions(kind: MediaNoteKind, mime: string): MediaRecorderOptions {
  const options: MediaRecorderOptions = {};
  if (mime) options.mimeType = mime;
  if (kind === "video") {
    options.videoBitsPerSecond = VIDEO_NOTE_VIDEO_BPS;
    options.audioBitsPerSecond = VIDEO_NOTE_AUDIO_BPS;
  }
  return options;
}
