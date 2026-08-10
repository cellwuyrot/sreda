"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  FACING_LABELS,
  MEDIA_NOTE_INITIAL,
  MEDIA_NOTE_MAX_SEC,
  VIDEO_NOTE_SIDE,
  audioNoteConstraints,
  baseMimeType,
  canContinue,
  canSend,
  formatNoteTime,
  mediaNoteReducer,
  nextFacing,
  noteRecorderOptions,
  noteTimeLeft,
  pickNoteMime,
  seekFraction,
  squareCropRect,
  timeToFraction,
  videoNoteConstraints,
  type MediaNoteKind,
  type NoteFacing,
} from "@/lib/mediaNote";

/**
 * Запись заметки: голос или квадратное видео.
 *
 * ── Как этим пользуются ─────────────────────────────────────────────────────
 *
 *   короткое нажатие  — переключить режим: микрофон ⇄ квадрат;
 *   нажать и держать  — запись идёт, пока держишь;
 *   отпустить         — ПАУЗА: дубль можно посмотреть полосой прокрутки;
 *   держать снова     — продолжить ту же запись;
 *   значок камеры     — сменить камеру, в том числе посреди записи;
 *   «Отправить»       — ПРИОСТАНОВКА: согласился, запись уходит;
 *   «Перезаписать»    — начать дубль заново;
 *   «Удалить»         — закрыть запись совсем.
 *
 * Пауза и приостановка разведены намеренно: отпустить палец и согласиться с
 * результатом — разные действия. Отпускание в Telegram отправляет сразу, и
 * оговорку уже не поправить; здесь между ними есть шаг.
 *
 * ── Откуда берутся кадры ────────────────────────────────────────────────────
 *
 * Пишем НЕ прямо с камеры, а с полотна (`canvas.captureStream`): каждый кадр
 * камеры перерисовывается в квадрат 480×480 с обрезкой по центру. Это даёт две
 * вещи, которых иначе не получить:
 *
 *   1. файл действительно квадратный, а не «квадратный при показе»;
 *   2. источник кадров можно подменить на ходу — на этом и держится смена
 *      камеры посреди записи: запись видит одно и то же полотно и ничего не
 *      замечает.
 *
 * Это не второй проход кодирования: рисование кадра — копирование, сжатие
 * по-прежнему одно, его делает запись.
 *
 * Звук берём отдельной дорожкой и при смене камеры НЕ трогаем — иначе на стыке
 * пропадал бы голос.
 *
 * ── Одна запись, а не склейка ───────────────────────────────────────────────
 *
 * Продолжение — `pause()`/`resume()` одной и той же записи. Склеить два webm
 * сложением байтов нельзя: у второго куска свой заголовок, файл не откроется.
 * По той же причине нет «перезаписать с середины»: у записи нет обратного хода,
 * отрезать хвост можно только перекодированием файла на телефоне. Поэтому полоса
 * прокрутки здесь — посмотреть, что получилось, а рядом «Перезаписать».
 *
 * ── Почему только на телефоне ───────────────────────────────────────────────
 *
 * Компонент подставляется вместо обычной кнопки микрофона на узких экранах (то
 * есть и в оболочке Android). На настольной версии остаётся прежняя запись
 * голоса: удержание кнопки мышью — не жест настольного приложения, а камера у
 * монитора для «кружков» не годится.
 *
 * Правила переходов живут отдельно, в `lib/mediaNote.ts`, и покрыты тестами:
 * здесь только камера, таймер и разметка.
 */

interface MediaNoteRecorderProps {
  onRecorded: (blob: Blob, duration: number, kind: MediaNoteKind) => void;
  disabled?: boolean;
  /**
   * Разрешён ли квадрат. Выключен в деловом чате (там переписка с
   * администрацией, видеозаметка не к месту) и в защищённом режиме: файлы там
   * шифруются, а сервер такую загрузку помечает голосовой — квадрат приехал бы
   * получателю как голос.
   */
  allowVideo?: boolean;
}

/** Задержка, после которой нажатие считается удержанием, а не тапом. */
const HOLD_MS = 180;
/** Сторона живого квадрата в панели записи. 96 — чтобы рядом оставалось место
    таймеру и полосе даже на экране в 320 точек. */
const PREVIEW_PX = 96;

/** Значок микрофона — тот же, что у прежней кнопки записи. */
function MicGlyph() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11a7 7 0 01-14 0m14 0a7 7 0 00-14 0m14 0v1a7 7 0 01-14 0v-1m7 8v4m-4 0h8"
      />
    </svg>
  );
}

/** Значок квадрата — режим видеосообщения. */
function SquareGlyph() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="4" strokeWidth={2} />
      <circle cx="12" cy="12" r="3.2" strokeWidth={2} />
    </svg>
  );
}

/**
 * Перерисовка кадров камеры в квадратное полотно.
 *
 * Живёт вне компонента: цикл ссылается на самого себя, а значение, созданное
 * хуком и названное внутри собственного объявления, React-правила справедливо
 * запрещают. Одна отрисовка — копирование кадра, не сжатие.
 */
function drawSquareFrames(
  source: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  raf: { current: number | null },
): void {
  function step() {
    if (source.videoWidth > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const crop = squareCropRect(source.videoWidth, source.videoHeight, VIDEO_NOTE_SIDE);
        if (crop.sw > 0) {
          ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.side, crop.side);
        }
      }
    }
    raf.current = requestAnimationFrame(step);
  }
  raf.current = requestAnimationFrame(step);
}

export default function MediaNoteRecorder({ onRecorded, disabled, allowVideo }: MediaNoteRecorderProps) {
  const [kind, setKind] = useState<MediaNoteKind>("audio");
  const [facing, setFacing] = useState<NoteFacing>("user");
  const [state, dispatch] = useReducer(mediaNoteReducer, MEDIA_NOTE_INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [switching, setSwitching] = useState(false);
  /* Умеет ли движок ставить запись на паузу. Значение влияет на разметку — кнопку
     «Продолжить» без поддержки паузы показывать нечестно, — поэтому состояние, а
     не ref: из разметки ref читать нельзя. На месте вызова возможность всё равно
     проверяется у самого объекта записи (`typeof recorder.pause`). */
  const [canPause, setCanPause] = useState(true);
  /** Адрес дубля для просмотра на паузе. */
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  /** Где сейчас просмотр дубля, в секундах. */
  const [takeAt, setTakeAt] = useState(0);

  /** Сырой поток камеры — его и подменяем при смене камеры. */
  const cameraStreamRef = useRef<MediaStream | null>(null);
  /** Дорожка звука: живёт отдельно и смену камеры переживает. */
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  /** Поток, который видит запись: полотно плюс звук. */
  const recordedStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const rafRef = useRef<number | null>(null);
  /** Накопленное записанное время и начало текущего отрезка. */
  const recordedRef = useRef(0);
  const segmentStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  /** Палец на кнопке прямо сейчас. Нужен из-за задержки на выдачу разрешения. */
  const holdingRef = useRef(false);
  /** Скрытое видео с камеры — источник кадров для полотна. */
  const sourceRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Проигрыватель дубля на паузе. */
  const takeRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Что делать, когда запись закончится: отдать, забыть или начать новый дубль. */
  const finishRef = useRef<"send" | "drop" | "restart">("drop");

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopDrawing = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  /** Убрать адрес дубля: без этого браузер держит запись в памяти. */
  const releaseTake = useCallback(() => {
    setTakeUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setTakeAt(0);
  }, []);

  /** Полная остановка: камера гаснет, микрофон отпускается. */
  const teardown = useCallback(() => {
    clearTimer();
    stopDrawing();
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    canvasStreamRef.current?.getTracks().forEach((track) => track.stop());
    canvasStreamRef.current = null;
    audioTrackRef.current?.stop();
    audioTrackRef.current = null;
    recordedStreamRef.current = null;
    chunksRef.current = [];
    recordedRef.current = 0;
    releaseTake();
  }, [releaseTake]);

  /* Уходя со страницы, гасим камеру. Без этого индикатор съёмки на телефоне
     остаётся горящим — человек справедливо решит, что за ним подсматривают. */
  useEffect(() => teardown, [teardown]);

  const startTicking = useCallback(() => {
    clearTimer();
    segmentStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const live = recordedRef.current + (Date.now() - segmentStartRef.current) / 1000;
      dispatch({ type: "tick", recorded: live });
      if (live >= MEDIA_NOTE_MAX_SEC) {
        /* Предел: сами встаём на паузу. Отправлять без согласия нельзя. */
        recordedRef.current = MEDIA_NOTE_MAX_SEC;
        clearTimer();
        const recorder = recorderRef.current;
        if (recorder?.state === "recording" && typeof recorder.pause === "function") recorder.pause();
        dispatch({ type: "tick", recorded: MEDIA_NOTE_MAX_SEC });
      }
    }, 200);
  }, []);

  /** Записанное время с учётом идущего прямо сейчас отрезка. */
  const liveRecorded = useCallback(() => {
    const running = recorderRef.current?.state === "recording";
    const extra = running ? (Date.now() - segmentStartRef.current) / 1000 : 0;
    return Math.min(recordedRef.current + extra, MEDIA_NOTE_MAX_SEC);
  }, []);

  const pause = useCallback(() => {
    clearTimer();
    recordedRef.current = liveRecorded();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      if (typeof recorder.pause === "function") recorder.pause();
      /* Без поддержки паузы дописать уже нельзя: останавливаем запись, но кадры
         не выбрасываем — отправить записанное человек всё ещё может. */
      else recorder.stop();
    }
    /* Порядок важен: сначала доводим время до фактического (пока состояние ещё
       «пишем» — иначе tick будет отброшен), потом ставим паузу. */
    dispatch({ type: "tick", recorded: recordedRef.current });
    dispatch({ type: "release" });

    /* Дубль для просмотра. Файл ещё не закрыт, поэтому длительность движок может
       не знать — полосу считаем по записанному времени, а не по `duration`. */
    if (chunksRef.current.length > 0) {
      const blob = new Blob(chunksRef.current, { type: baseMimeType(mimeRef.current) });
      const url = URL.createObjectURL(blob);
      setTakeUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
      setTakeAt(0);
    }
  }, [liveRecorded]);

  /* Пересоздание записи для «Перезаписать» зовёт эту же функцию, поэтому ссылка
     держится в ref: функция, названная внутри собственного объявления, не даёт
     вывести тип. */
  const createRecorderRef = useRef<(stream: MediaStream, forKind: MediaNoteKind) => MediaRecorder>(
    () => {
      throw new Error("запись ещё не готова");
    },
  );

  /** Собрать запись на уже готовом потоке. Отдельно — её же пересоздаёт «Перезаписать». */
  const createRecorder = useCallback(
    (stream: MediaStream, forKind: MediaNoteKind) => {
      const mime = pickNoteMime(forKind);
      const recorder = new MediaRecorder(stream, noteRecorderOptions(forKind, mime));
      /* Формат берём у самой записи: движок мог выбрать другой, и собрать Blob
         нужно именно с ним, иначе файл не откроется. */
      mimeRef.current = recorder.mimeType || mime || (forKind === "video" ? "video/webm" : "audio/webm");
      setCanPause(typeof recorder.pause === "function");
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const parts = chunksRef.current;
        const seconds = Math.round(recordedRef.current);
        const finish = finishRef.current;
        finishRef.current = "drop";
        chunksRef.current = [];
        recordedRef.current = 0;
        recorderRef.current = null;

        if (finish === "send" && parts.length > 0) {
          onRecorded(new Blob(parts, { type: baseMimeType(mimeRef.current) }), seconds, forKind);
        }
        if (finish === "restart") {
          /* Новый дубль на том же потоке: камера и микрофон остаются включёнными,
             иначе после «Перезаписать» человек ждал бы разрешение и прогрев
             камеры заново. */
          const live = recordedStreamRef.current;
          if (live) {
            recorderRef.current = createRecorderRef.current(live, forKind);
            dispatch({ type: "discard" });
            return;
          }
        }
        teardown();
        dispatch({ type: "discard" });
      };
      return recorder;
    },
    [onRecorded, teardown],
  );

  useEffect(() => {
    createRecorderRef.current = createRecorder;
  }, [createRecorder]);

  /** Первый вход: спросить доступ, собрать поток и запись. */
  const begin = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (kind === "audio") {
        const stream = await navigator.mediaDevices.getUserMedia(audioNoteConstraints());
        audioTrackRef.current = stream.getAudioTracks()[0] ?? null;
        recordedStreamRef.current = stream;
        recorderRef.current = createRecorder(stream, "audio");
      } else {
        /* Звук и камеру берём одним запросом: два запроса — два разрешения, а
           человеку нужно нажать «разрешить» один раз. Дальше при смене камеры
           просим только видео. */
        const stream = await navigator.mediaDevices.getUserMedia(videoNoteConstraints(facing));
        audioTrackRef.current = stream.getAudioTracks()[0] ?? null;
        const camera = new MediaStream(stream.getVideoTracks());
        cameraStreamRef.current = camera;

        const source = sourceRef.current;
        if (!source) throw new Error("нет элемента предпросмотра");
        source.srcObject = camera;
        const started = source.play();
        if (started && typeof started.catch === "function") started.catch(() => {});

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("нет полотна");
        canvas.width = VIDEO_NOTE_SIDE;
        canvas.height = VIDEO_NOTE_SIDE;
        stopDrawing();
        drawSquareFrames(source, canvas, rafRef);

        const canvasStream = canvas.captureStream(24);
        canvasStreamRef.current = canvasStream;
        const combined = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...(audioTrackRef.current ? [audioTrackRef.current] : []),
        ]);
        recordedStreamRef.current = combined;
        recorderRef.current = createRecorder(combined, "video");
      }

      recorderRef.current?.start(250);
      dispatch({ type: "hold" });
      startTicking();
      /* Разрешение спрашивается не мгновенно, и палец за это время могли
         отпустить. Без этой проверки запись продолжалась бы сама по себе. */
      if (!holdingRef.current) pause();
    } catch {
      /* Отказ в доступе — единственная частая причина. Текст короткий: человек
         сам решит, идти ли в настройки телефона. */
      setError(kind === "video" ? "Нет доступа к камере" : "Нет доступа к микрофону");
      teardown();
    } finally {
      setStarting(false);
    }
  }, [createRecorder, facing, kind, pause, startTicking, teardown]);

  /**
   * Смена камеры — в том числе посреди записи.
   *
   * Запись не трогаем вообще: она смотрит на полотно, а мы лишь подменяем
   * источник кадров. Поэтому стык получается без обрыва файла и без потери
   * звука — звуковая дорожка остаётся та же.
   */
  const flipCamera = useCallback(async () => {
    if (kind !== "video" || switching) return;
    const target = nextFacing(facing);
    setSwitching(true);
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: videoNoteConstraints(target).video,
      });
      const old = cameraStreamRef.current;
      cameraStreamRef.current = fresh;
      const source = sourceRef.current;
      if (source) {
        source.srcObject = fresh;
        const started = source.play();
        if (started && typeof started.catch === "function") started.catch(() => {});
      }
      /* Старую камеру гасим ПОСЛЕ подмены: иначе между остановкой и стартом
         полотно рисовало бы пустоту, и в записи мелькнул бы чёрный кадр. */
      old?.getTracks().forEach((track) => track.stop());
      setFacing(target);
    } catch {
      setError("Вторая камера недоступна");
    } finally {
      setSwitching(false);
    }
  }, [facing, kind, switching]);

  /** Приостановка: согласились с записанным. */
  const commit = useCallback(() => {
    const recorded = liveRecorded();
    if (!canSend({ ...state, recorded })) return;
    recordedRef.current = recorded;
    finishRef.current = "send";
    dispatch({ type: "tick", recorded });
    dispatch({ type: "commit" });
    clearTimer();
    releaseTake();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else if (chunksRef.current.length > 0) {
      /* Движок без паузы: запись уже остановлена, собираем сами. */
      onRecorded(
        new Blob(chunksRef.current, { type: baseMimeType(mimeRef.current) }),
        Math.round(recordedRef.current),
        kind,
      );
      teardown();
      dispatch({ type: "discard" });
    }
  }, [kind, liveRecorded, onRecorded, releaseTake, state, teardown]);

  /** Перезаписать: тот же режим и та же камера, дубль с нуля. */
  const restart = useCallback(() => {
    clearTimer();
    releaseTake();
    recordedRef.current = 0;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      finishRef.current = "restart";
      recorder.stop();
      return;
    }
    /* Записи нет — просто сбрасываем состояние. */
    dispatch({ type: "discard" });
  }, [releaseTake]);

  const discard = useCallback(() => {
    finishRef.current = "drop";
    teardown();
    dispatch({ type: "discard" });
  }, [teardown]);

  /** Продолжение после паузы: та же запись. */
  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || typeof recorder.resume !== "function") return;
    releaseTake();
    if (recorder.state === "paused") recorder.resume();
    dispatch({ type: "hold" });
    startTicking();
  }, [releaseTake, startTicking]);

  /* ── Жесты ──────────────────────────────────────────────────────────────── */

  const onPointerDown = useCallback(() => {
    if (disabled || starting) return;
    holdingRef.current = true;
    heldRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      heldRef.current = true;
      if (recorderRef.current) resume();
      else void begin();
    }, HOLD_MS);
  }, [begin, disabled, resume, starting]);

  const onPointerUp = useCallback(() => {
    holdingRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (heldRef.current) {
      heldRef.current = false;
      if (state.status === "recording") pause();
      return;
    }
    /* Короткое нажатие — переключение режима. Только когда ничего не записано:
       посреди записи смена микрофона на камеру означала бы выбросить сказанное. */
    if (allowVideo && !recorderRef.current) {
      setError(null);
      setKind((current) => (current === "audio" ? "video" : "audio"));
    }
  }, [allowVideo, pause, state.status]);

  /* ── Полоса просмотра дубля ─────────────────────────────────────────────── */

  /** Посмотреть или прослушать дубль. Играет тот же элемент, что ведёт полоса. */
  const playTake = useCallback(() => {
    const media = takeRef.current;
    if (!media) return;
    if (media.paused) {
      const started = media.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    } else {
      media.pause();
    }
  }, []);

  const seekTake = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      const media = takeRef.current;
      if (!bar || !media) return;
      const rect = bar.getBoundingClientRect();
      const fraction = seekFraction(clientX, rect.left, rect.width);
      const target = fraction * Math.max(state.recorded, 0.1);
      try {
        media.currentTime = target;
      } catch {
        /* Незакрытый файл может не дать перейти в самый конец — не беда. */
      }
      setTakeAt(target);
    },
    [state.recorded],
  );

  const recording = state.status === "recording";
  const paused = state.status === "paused";
  const active = recording || paused;
  const left = noteTimeLeft(state.recorded);
  const isVideo = kind === "video";
  const takeFraction = timeToFraction(takeAt, state.recorded);

  /**
   * Одно дерево на все состояния — и это важно, а не вопрос вкуса.
   *
   * Полотно и скрытое видео-источник обязаны оставаться теми же элементами: поток
   * записи привязан к КОНКРЕТНОМУ полотну. Если рисовать разные ветки разметки на
   * покое и на записи, React пересоздаст полотно, запись останется привязанной к
   * выброшенному, и в файл уйдёт чернота. Поэтому переключаем классы, а не ветки.
   *
   * ── Почему панель, а не кнопки в строке ─────────────────────────────────────
   *
   * Сначала мини-редактор жил в том же месте, где стоит кнопка отправки, — то есть
   * в слоте шириной под один значок. На телефоне таймер, полоса и четыре кнопки
   * туда не влезали и разъезжались. Теперь на время записи редактор превращается в
   * ПАНЕЛЬ во всю ширину строки ввода: она перекрывает поле ввода и соседние
   * кнопки, потому что во время записи они всё равно ни к чему.
   *
   * Панель абсолютная, а не вставленная в поток: так соседние элементы не
   * пересчитываются, и полотно не пересоздаётся при переходе. Родителю нужен
   * `relative` — он есть в обеих строках ввода (канальной и личных сообщений).
   */
  return (
    <>
      {/* Источник кадров: видео с камеры, на экране не нужно. */}
      <video ref={sourceRef} muted playsInline className="hidden" />

      {/* Кнопка в покое: микрофон или квадрат. */}
      <div className={active ? "hidden" : "flex flex-col items-end"}>
        {error && <span className="mb-1 text-[10px] text-red-500">{error}</span>}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          disabled={disabled || starting}
          className="p-2.5 select-none touch-none text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors disabled:opacity-50"
          title={
            isVideo
              ? "Видеосообщение: удерживайте для записи, короткое нажатие — голос"
              : allowVideo
                ? "Голосовое: удерживайте для записи, короткое нажатие — видео"
                : "Голосовое сообщение: удерживайте для записи"
          }
          aria-label={isVideo ? "Записать видеосообщение" : "Записать голосовое сообщение"}
        >
          {isVideo ? <SquareGlyph /> : <MicGlyph />}
        </button>
      </div>

      {/* Панель записи во всю ширину строки ввода. */}
      <div
        className={
          active
            ? "absolute left-0 right-0 bottom-0 z-30 p-2 rounded-2xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] shadow-lg"
            : "hidden"
        }
      >
        <div className="flex items-start gap-2">
          {/* Квадрат: живой кадр, а на паузе — дубль поверх него. */}
          <div
            className={
              isVideo
                ? "relative flex-shrink-0 rounded-xl overflow-hidden bg-black"
                : "hidden"
            }
            style={isVideo ? { width: PREVIEW_PX, height: PREVIEW_PX } : undefined}
          >
            {/* Полотно отражаем только на экране: человек смотрит на себя как в
                зеркало, а в файл должно уйти неотражённое изображение. */}
            <canvas
              ref={canvasRef}
              width={VIDEO_NOTE_SIDE}
              height={VIDEO_NOTE_SIDE}
              className="w-full h-full object-cover"
              style={facing === "user" ? { transform: "scaleX(-1)" } : undefined}
            />
            {active && paused && takeUrl && (
              <video
                ref={(node) => {
                  takeRef.current = node;
                }}
                src={takeUrl}
                playsInline
                className="absolute inset-0 w-full h-full object-cover bg-black"
                onTimeUpdate={(e) => setTakeAt(e.currentTarget.currentTime)}
              />
            )}
            {active && (
              <button
                type="button"
                onClick={() => void flipCamera()}
                disabled={switching}
                className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center disabled:opacity-40"
                title={FACING_LABELS[facing]}
                aria-label="Сменить камеру"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.9}>
                  <path d="M4 8h10l-2-2M20 16H10l2 2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="2.4" />
                </svg>
              </button>
            )}
          </div>

          {/* Состояние записи и полоса. min-w-0 обязателен: без него длинная
              подпись растягивает колонку и панель начинает переполняться. */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  recording ? "bg-red-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              <span
                className={`text-sm font-mono flex-shrink-0 ${
                  recording ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"
                }`}
              >
                {formatNoteTime(paused && takeAt ? takeAt : state.recorded)}
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                {recording
                  ? left <= 10
                    ? `осталось ${left} с`
                    : "запись"
                  : canContinue(state)
                    ? state.segments > 1
                      ? `пауза · ${state.segments} фрагмента`
                      : "пауза · можно дополнить"
                    : "пауза · предел длительности"}
              </span>
            </div>

            {/* Полоса просмотра дубля: только на паузе — во время записи смотреть
                нечего, а место она бы занимала. */}
            {paused && takeUrl && (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={playTake}
                  className="w-7 h-7 flex-shrink-0 rounded-full bg-[var(--cn-card)] border border-[var(--cn-border)] text-neutral-600 dark:text-neutral-300 flex items-center justify-center"
                  aria-label="Посмотреть, что получилось"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <div
                  ref={barRef}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    seekTake(e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTake(e.clientX);
                  }}
                  className="relative h-6 flex-1 min-w-0 flex items-center cursor-pointer touch-none"
                  role="slider"
                  aria-label="Позиция в записи"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(state.recorded)}
                  aria-valuenow={Math.round(takeAt)}
                  tabIndex={0}
                >
                  <span className="absolute left-0 right-0 h-1 rounded-full bg-neutral-300 dark:bg-white/15" />
                  <span
                    className="absolute left-0 h-1 rounded-full bg-violet-500 dark:bg-cyan-400"
                    style={{ width: `${takeFraction * 100}%` }}
                  />
                  <span
                    className="absolute w-3 h-3 rounded-full bg-violet-500 dark:bg-cyan-400 -ml-1.5"
                    style={{ left: `${takeFraction * 100}%` }}
                  />
                </div>
                {/* Голосовой дубль слушают тем же способом: элемент скрыт, им
                    управляют та же кнопка и та же полоса. */}
                {!isVideo && (
                  <audio
                    ref={(node) => {
                      takeRef.current = node;
                    }}
                    src={takeUrl}
                    className="hidden"
                    onTimeUpdate={(e) => setTakeAt(e.currentTarget.currentTime)}
                  />
                )}
              </div>
            )}

            {error && <span className="text-[10px] text-red-500 truncate">{error}</span>}
          </div>
        </div>

        {/* Кнопки — отдельным рядом под панелью, а не сбоку: на узком экране в один
            ряд с квадратом и таймером они не помещаются. Подписи убраны в
            значки, кроме главного действия: «Отправить» должно читаться словом. */}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={discard}
            className="w-9 h-9 flex-shrink-0 rounded-xl border border-[var(--cn-border)] text-red-500 flex items-center justify-center active:bg-red-500/10"
            title="Удалить запись"
            aria-label="Удалить запись"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {paused && (
            <button
              type="button"
              onClick={restart}
              className="w-9 h-9 flex-shrink-0 rounded-xl border border-[var(--cn-border)] text-neutral-500 dark:text-neutral-300 flex items-center justify-center active:bg-[var(--cn-hover)]"
              title="Перезаписать заново"
              aria-label="Перезаписать заново"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Главная кнопка записи: держать — писать. Тянется в остаток строки,
              чтобы попадать по ней большим пальцем не глядя. */}
          <button
            type="button"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex-1 min-w-0 h-9 rounded-xl select-none touch-none inline-flex items-center justify-center gap-1.5 text-[12px] font-medium transition-colors ${
              recording
                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                : "bg-[var(--cn-card)] border border-[var(--cn-border)] text-neutral-600 dark:text-neutral-300"
            }`}
            aria-label="Держите для записи"
          >
            {isVideo ? <SquareGlyph /> : <MicGlyph />}
            <span className="truncate">
              {recording ? "идёт запись" : canContinue(state) && canPause ? "держать — дополнить" : "держать"}
            </span>
          </button>

          <button
            type="button"
            onClick={commit}
            disabled={!canSend(state)}
            className="h-9 px-3 flex-shrink-0 rounded-xl text-[12px] font-medium bg-violet-500 dark:bg-cyan-600 text-white disabled:opacity-40"
          >
            Отправить
          </button>
        </div>
      </div>
    </>
  );
}
