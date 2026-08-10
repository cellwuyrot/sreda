/**
 * Тесты: src/lib/mediaNote.ts
 *
 * Проверяется порядок состояний мини-редактора заметки — то, что руками на
 * телефоне проверять больно, а сломать легко: отпустил палец, нажал снова,
 * согласился, передумал, вышло время.
 */
import { describe, it, expect } from "vitest";
import {
  MEDIA_NOTE_INITIAL,
  MEDIA_NOTE_MAX_SEC,
  MEDIA_NOTE_MIN_SEC,
  canContinue,
  canSend,
  formatNoteTime,
  mediaNoteReducer,
  noteFileName,
  noteRecorderOptions,
  baseMimeType,
  noteTimeLeft,
  pickNoteMime,
  videoNoteConstraints,
  audioNoteConstraints,
  nextFacing,
  FACING_LABELS,
  squareCropRect,
  seekFraction,
  fractionToTime,
  timeToFraction,
  type MediaNoteEvent,
  type MediaNoteState,
} from "@/lib/mediaNote";

/** Прогнать последовательность событий от начального состояния. */
function run(...events: MediaNoteEvent[]): MediaNoteState {
  return events.reduce(mediaNoteReducer, MEDIA_NOTE_INITIAL);
}

// ─── Запись и пауза ────────────────────────────────────────────────────────────

describe("удержание и отпускание", () => {
  it("нажали — пишем", () => {
    expect(run({ type: "hold" }).status).toBe("recording");
  });

  it("первое удержание — первый отрезок записи", () => {
    expect(run({ type: "hold" }).segments).toBe(1);
  });

  it("отпустили — пауза, а не отправка", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 3 }, { type: "release" });
    expect(state.status).toBe("paused");
    expect(state.recorded).toBe(3);
  });

  it("повторное удержание во время записи ничего не меняет", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 2 }, { type: "hold" });
    expect(state.segments).toBe(1);
    expect(state.status).toBe("recording");
  });

  it("отпускание без записи ничего не меняет", () => {
    expect(run({ type: "release" })).toEqual(MEDIA_NOTE_INITIAL);
  });
});

// ─── Пауза даёт продолжить ─────────────────────────────────────────────────────

describe("продолжение после паузы", () => {
  /**
   * ИНВАРИАНТ: продолжение — это ТА ЖЕ запись, а не вторая. Счётчик отрезков
   * растёт, а записанное время не сбрасывается: иначе дополнение затирало бы
   * начало, и человек терял бы сказанное.
   */
  it("ИНВАРИАНТ: продолжение не обнуляет записанное", () => {
    const state = run(
      { type: "hold" },
      { type: "tick", recorded: 4 },
      { type: "release" },
      { type: "hold" },
    );
    expect(state.status).toBe("recording");
    expect(state.recorded).toBe(4);
    expect(state.segments).toBe(2);
  });

  it("дополнять можно много раз", () => {
    const state = run(
      { type: "hold" },
      { type: "tick", recorded: 2 },
      { type: "release" },
      { type: "hold" },
      { type: "tick", recorded: 5 },
      { type: "release" },
      { type: "hold" },
      { type: "tick", recorded: 8 },
      { type: "release" },
    );
    expect(state.segments).toBe(3);
    expect(state.recorded).toBe(8);
    expect(state.status).toBe("paused");
  });

  it("из паузы видно, что дополнять можно", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 3 }, { type: "release" });
    expect(canContinue(state)).toBe(true);
  });
});

// ─── Приостановка: согласие и отправка ────────────────────────────────────────

describe("приостановка", () => {
  it("согласие из паузы закрывает запись", () => {
    const state = run(
      { type: "hold" },
      { type: "tick", recorded: 3 },
      { type: "release" },
      { type: "commit" },
    );
    expect(state.status).toBe("done");
  });

  it("согласиться можно и не отпуская: сразу отправить", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 3 }, { type: "commit" });
    expect(state.status).toBe("done");
  });

  /**
   * ИНВАРИАНТ: закрытую запись дополнить нельзя. Иначе после отправки палец на
   * кнопке начал бы новую запись в уже ушедшее сообщение.
   */
  it("ИНВАРИАНТ: после согласия удержание ничего не начинает", () => {
    const state = run(
      { type: "hold" },
      { type: "tick", recorded: 3 },
      { type: "commit" },
      { type: "hold" },
    );
    expect(state.status).toBe("done");
    expect(state.segments).toBe(1);
  });

  it("слишком короткую запись не отправляем: это случайное касание", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 0 }, { type: "commit" });
    expect(state.status).toBe("recording");
    expect(canSend(state)).toBe(false);
  });

  it(`ровно ${MEDIA_NOTE_MIN_SEC} секунда уже отправляется`, () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: MEDIA_NOTE_MIN_SEC });
    expect(canSend(state)).toBe(true);
  });
});

// ─── Отказ ────────────────────────────────────────────────────────────────────

describe("отказ от записи", () => {
  it("стирает всё, включая отрезки", () => {
    const state = run(
      { type: "hold" },
      { type: "tick", recorded: 9 },
      { type: "release" },
      { type: "discard" },
    );
    expect(state).toEqual(MEDIA_NOTE_INITIAL);
  });

  it("работает и на ходу, во время записи", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: 4 }, { type: "discard" });
    expect(state).toEqual(MEDIA_NOTE_INITIAL);
  });
});

// ─── Предел длительности ──────────────────────────────────────────────────────

describe("предел длительности", () => {
  /**
   * ИНВАРИАНТ: на пределе сами встаём на паузу, а не отправляем. Человек мог не
   * смотреть на таймер, и отправка без его согласия — это уже не его сообщение.
   */
  it("ИНВАРИАНТ: у предела запись становится на паузу, а не уходит", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: MEDIA_NOTE_MAX_SEC });
    expect(state.status).toBe("paused");
    expect(state.recorded).toBe(MEDIA_NOTE_MAX_SEC);
  });

  it("время не растёт выше предела", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: MEDIA_NOTE_MAX_SEC + 30 });
    expect(state.recorded).toBe(MEDIA_NOTE_MAX_SEC);
  });

  it("на пределе дополнять уже нечем", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: MEDIA_NOTE_MAX_SEC });
    expect(canContinue(state)).toBe(false);
    expect(mediaNoteReducer(state, { type: "hold" }).status).toBe("paused");
  });

  it("на пределе отправить можно", () => {
    const state = run({ type: "hold" }, { type: "tick", recorded: MEDIA_NOTE_MAX_SEC });
    expect(canSend(state)).toBe(true);
  });

  it("время до предела считается от записанного", () => {
    expect(noteTimeLeft(0)).toBe(MEDIA_NOTE_MAX_SEC);
    expect(noteTimeLeft(MEDIA_NOTE_MAX_SEC - 5)).toBe(5);
    expect(noteTimeLeft(MEDIA_NOTE_MAX_SEC + 5)).toBe(0);
  });

  it("время идёт только во время записи: на паузе счётчик стоит", () => {
    const paused = run({ type: "hold" }, { type: "tick", recorded: 5 }, { type: "release" });
    expect(mediaNoteReducer(paused, { type: "tick", recorded: 40 }).recorded).toBe(5);
  });
});

// ─── Таймер ───────────────────────────────────────────────────────────────────

describe("formatNoteTime", () => {
  it("секунды дополняются нулём", () => {
    expect(formatNoteTime(7)).toBe("0:07");
  });

  it("минуты и секунды", () => {
    expect(formatNoteTime(75)).toBe("1:15");
  });

  it("ноль — это 0:00", () => {
    expect(formatNoteTime(0)).toBe("0:00");
  });

  it("дробное время округляется вниз: таймер не должен опережать запись", () => {
    expect(formatNoteTime(9.9)).toBe("0:09");
  });

  it("отрицательное значение не ломает вид", () => {
    expect(formatNoteTime(-3)).toBe("0:00");
  });
});

// ─── Формат записи ────────────────────────────────────────────────────────────

describe("pickNoteMime", () => {
  it("для видео предпочитает webm с vp9", () => {
    expect(pickNoteMime("video", () => true)).toBe("video/webm;codecs=vp9,opus");
  });

  it("для голоса предпочитает webm с opus", () => {
    expect(pickNoteMime("audio", () => true)).toBe("audio/webm;codecs=opus");
  });

  it("если vp9 не поддержан — берёт vp8", () => {
    const support = (mime: string) => !mime.includes("vp9");
    expect(pickNoteMime("video", support)).toBe("video/webm;codecs=vp8,opus");
  });

  /**
   * ИНВАРИАНТ: неизвестный движок не должен оставлять человека без записи.
   * Пустая строка означает «решай сам» — запись начнётся в формате движка.
   */
  it("ИНВАРИАНТ: когда не поддержано ничего — пустая строка, а не отказ", () => {
    expect(pickNoteMime("video", () => false)).toBe("");
    expect(pickNoteMime("audio", () => false)).toBe("");
  });
});

describe("noteFileName", () => {
  it("видеозаметка — note с расширением формата", () => {
    expect(noteFileName("video", "video/webm;codecs=vp9,opus")).toBe("note.webm");
    expect(noteFileName("video", "video/mp4")).toBe("note.mp4");
  });

  it("голос — voice", () => {
    expect(noteFileName("audio", "audio/webm;codecs=opus")).toBe("voice.webm");
    expect(noteFileName("audio", "audio/ogg")).toBe("voice.ogg");
  });

  it("без известного формата остаётся webm — движки отдают его чаще всего", () => {
    expect(noteFileName("video", "")).toBe("note.webm");
  });
});

// ─── Запрос к камере и микрофону ──────────────────────────────────────────────

describe("ограничения записи", () => {
  /* Квадрат у камеры больше не просим: телефоны это ограничение игнорируют, и
     вырез делаем сами (squareCropRect). Просим кадр с запасом по стороне, чтобы
     после обрезки было из чего масштабировать. */
  it("видеозаметка просит переднюю камеру и кадр с запасом", () => {
    const video = videoNoteConstraints().video as MediaTrackConstraints;
    expect(video.facingMode).toBe("user");
    const width = video.width as { ideal: number };
    expect(width.ideal).toBeGreaterThan(480);
  });

  it("можно попросить заднюю камеру", () => {
    const video = videoNoteConstraints("environment").video as MediaTrackConstraints;
    expect(video.facingMode).toBe("environment");
  });

  it("видеозаметка пишет и звук: без него это гифка, а не сообщение", () => {
    expect(videoNoteConstraints().audio).toBeTruthy();
  });

  it("голосовая заметка камеру не просит", () => {
    expect(audioNoteConstraints().video).toBeUndefined();
  });

  it("битрейт задаётся только видео", () => {
    const video = noteRecorderOptions("video", "video/webm");
    expect(video.videoBitsPerSecond).toBeGreaterThan(0);
    const audio = noteRecorderOptions("audio", "audio/webm");
    expect(audio.videoBitsPerSecond).toBeUndefined();
  });

  it("пустой формат в настройки записи не попадает", () => {
    expect(noteRecorderOptions("video", "").mimeType).toBeUndefined();
  });
});

// ─── Переключение камеры ──────────────────────────────────────────────────────

describe("nextFacing", () => {
  it("передняя переключается на заднюю и обратно", () => {
    expect(nextFacing("user")).toBe("environment");
    expect(nextFacing("environment")).toBe("user");
  });

  it("двойное переключение возвращает к исходной", () => {
    expect(nextFacing(nextFacing("user"))).toBe("user");
  });

  it("у каждой стороны есть человеческая подпись", () => {
    expect(FACING_LABELS.user).toMatch(/[Пп]ередняя/);
    expect(FACING_LABELS.environment).toMatch(/[Зз]адняя/);
  });
});

// ─── Обрезка до квадрата ──────────────────────────────────────────────────────

describe("squareCropRect", () => {
  it("вертикальный кадр обрезается сверху и снизу поровну", () => {
    const crop = squareCropRect(720, 960);
    expect(crop.sw).toBe(720);
    expect(crop.sh).toBe(720);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(120);
  });

  it("горизонтальный кадр обрезается слева и справа поровну", () => {
    const crop = squareCropRect(960, 720);
    expect(crop.sx).toBe(120);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBe(720);
  });

  it("уже квадратный кадр не режется", () => {
    const crop = squareCropRect(600, 600);
    expect(crop).toMatchObject({ sx: 0, sy: 0, sw: 600, sh: 600 });
  });

  /**
   * ИНВАРИАНТ: сторона выреза не больше короткой стороны кадра. Иначе пришлось бы
   * дорисовывать пустоту по краям — вместо лица чёрные поля.
   */
  it("ИНВАРИАНТ: вырез не выходит за кадр", () => {
    for (const [w, h] of [[100, 700], [700, 100], [333, 444]]) {
      const crop = squareCropRect(w, h);
      expect(crop.sw).toBeLessThanOrEqual(Math.min(w, h));
      expect(crop.sx + crop.sw).toBeLessThanOrEqual(w);
      expect(crop.sy + crop.sh).toBeLessThanOrEqual(h);
    }
  });

  it("кадр без размеров не ломает расчёт: камера ещё не отдала первый кадр", () => {
    expect(squareCropRect(0, 0).sw).toBe(0);
    expect(squareCropRect(Number.NaN, 480).sw).toBe(0);
  });

  it("сторону квадрата можно задать", () => {
    expect(squareCropRect(720, 960, 240).side).toBe(240);
  });
});

// ─── Полоса прокрутки ─────────────────────────────────────────────────────────

describe("полоса прокрутки", () => {
  it("нажатие в начале полосы — ноль, в конце — единица", () => {
    expect(seekFraction(100, 100, 200)).toBe(0);
    expect(seekFraction(300, 100, 200)).toBe(1);
  });

  it("середина полосы — половина", () => {
    expect(seekFraction(200, 100, 200)).toBeCloseTo(0.5);
  });

  /**
   * ИНВАРИАНТ: палец уходит за края полосы постоянно — при перетаскивании это
   * норма. Без зажима заметка прыгала бы на отрицательное время или за конец.
   */
  it("ИНВАРИАНТ: выход за края зажимается", () => {
    expect(seekFraction(0, 100, 200)).toBe(0);
    expect(seekFraction(9999, 100, 200)).toBe(1);
  });

  it("полоса нулевой ширины не даёт делить на ноль", () => {
    expect(seekFraction(50, 0, 0)).toBe(0);
  });

  it("доля переводится во время и обратно", () => {
    expect(fractionToTime(0.5, 30)).toBe(15);
    expect(timeToFraction(15, 30)).toBe(0.5);
  });

  it("неизвестная длительность даёт ноль, а не бесконечность", () => {
    expect(fractionToTime(0.5, Number.NaN)).toBe(0);
    expect(timeToFraction(5, 0)).toBe(0);
    expect(timeToFraction(5, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("время за пределом длительности зажимается", () => {
    expect(timeToFraction(45, 30)).toBe(1);
  });
});

// ─── Тип файла без параметров ─────────────────────────────────────────────────

describe("baseMimeType", () => {
  /**
   * ИНВАРИАНТ: кодеки из типа убираются. Из-за них запись не отправлялась вовсе:
   * сервер сверял тип со списком разрешённых точным равенством и отвечал 415.
   */
  it("ИНВАРИАНТ: кодеки отбрасываются", () => {
    expect(baseMimeType("video/webm;codecs=vp9")).toBe("video/webm");
    expect(baseMimeType("video/webm;codecs=vp8,opus")).toBe("video/webm");
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("тип без параметров не меняется", () => {
    expect(baseMimeType("video/mp4")).toBe("video/mp4");
  });

  it("регистр и пробелы приводятся к порядку", () => {
    expect(baseMimeType(" VIDEO/WEBM ; codecs=vp9 ")).toBe("video/webm");
  });

  it("пустое значение остаётся пустым, а не превращается в мусор", () => {
    expect(baseMimeType("")).toBe("");
    expect(baseMimeType(null)).toBe("");
    expect(baseMimeType(undefined)).toBe("");
  });

  /**
   * ИНВАРИАНТ: обрезка параметров не должна расширять список разрешённого —
   * контейнер остаётся тем, что прислали.
   */
  it("ИНВАРИАНТ: контейнер не подменяется", () => {
    expect(baseMimeType("video/x-flv;codecs=vp9")).toBe("video/x-flv");
  });
});
