"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatNoteTime, seekFraction, timeToFraction } from "@/lib/mediaNote";

/**
 * Видеосообщение — квадрат.
 *
 * ── Размер: на телефоне во всю ширину переписки ─────────────────────────────
 *
 * Сторона квадрата была одна на всех — 176 пикселей. На большом экране это
 * нормально: заметка стоит в ряду сообщений и не спорит с текстом. На телефоне
 * те же 176 пикселей занимают меньше половины ширины, и лицо в кадре
 * получается размером с ноготь — заметку приходится подносить к глазам.
 *
 * Поэтому на узком экране квадрат растягивается на ширину переписки, а высота
 * следует за шириной (`aspect-square`). Ширина задана как `70vw`, и это не
 * произвольное число: пузырь сообщения ограничен 78% ширины и имеет отступы по
 * 14 пикселей с каждой стороны — на телефоне 360 пикселей это ровно те же ~252
 * пикселя. То есть квадрат встаёт впритык к краям пузыря, не вылезая за них.
 * Потолок в 420 пикселей нужен планшетам, где 70% ширины — это уже нелепо
 * большая заметка.
 *
 * На большом экране (`md` и выше) размер прежний — правка туда не заходит.
 *
 * Отличается от обычного видео во вложении тем, что это не файл, а реплика:
 * поэтому нет ни кнопки «во весь экран», ни настроек скорости — касание играет,
 * касание останавливает.
 *
 * Полоса прокрутки под квадратом есть, и это не украшение: заметку часто
 * переслушивают с середины — «повтори, что ты сказал про сроки». Без полосы
 * единственным способом было бы слушать всё заново.
 *
 * Кадр обрезается по центру до квадрата (`object-cover`). Запись теперь и сама
 * пишет квадрат, но старые заметки записаны обычным кадром — обрезка оставлена,
 * чтобы они не растягивались.
 *
 * Звук включён, но воспроизведение начинается только по касанию: заметка,
 * заигравшая сама при прокрутке переписки, — это громкий голос в автобусе без
 * предупреждения.
 */

interface VideoNotePlayerProps {
  url: string;
  /** Длительность из вложения: показываем до того, как файл сообщит свою. */
  duration?: number;
  /**
   * Сторона квадрата на БОЛЬШОМ экране, в пикселях. На телефоне размер задаётся
   * шириной переписки и от этого значения не зависит.
   */
  size?: number;
}

export default function VideoNotePlayer({ url, duration, size = 176 }: VideoNotePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  /** Длительность из самого файла: точнее, чем присланная во вложении. */
  const [known, setKnown] = useState<number | null>(null);
  /** Файл не загрузился. Показываем это словами, а не чёрным квадратом. */
  const [failed, setFailed] = useState(false);
  /** Первый кадр уже вытянут — второй раз дёргать не нужно. */
  const primedRef = useRef(false);

  const total = known ?? duration ?? 0;

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      /* play() в старых движках возвращает undefined, а не промис — вызов .catch
         на нём уронил бы обработчик касания. */
      const started = video.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setAt(0);
      /* Возвращаемся к началу: заметку часто пересматривают, и оставлять
         последний кадр как заглушку неудобно. */
      video.currentTime = 0;
    };
    const onTime = () => setAt(video.currentTime);
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setKnown(video.duration);
      /* Превью — первый кадр. `preload="metadata"` сам по себе кадр не гарантирует:
         часть движков (в том числе WebView на Android) держит картинку пустой до
         первого воспроизведения, и на месте заметки остаётся чёрный квадрат.
         Мгновенный сдвиг заставляет раскодировать и показать кадр. 0.05 с, а не 0:
         в самом нуле у некоторых записей кадра ещё нет. */
      if (!primedRef.current && video.paused) {
        primedRef.current = true;
        try {
          video.currentTime = 0.05;
        } catch {
          /* Движок может не дать перейти до готовности — не беда, кадр появится
             при воспроизведении. */
        }
      }
    };
    const onError = () => setFailed(true);
    const onLoaded = () => setFailed(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("error", onError);
    video.addEventListener("loadeddata", onLoaded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onLoaded);
    };
  }, []);

  /** Перевод положения пальца в секунды. Зажим — в seekFraction. */
  const seek = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      const video = videoRef.current;
      if (!bar || !video || total <= 0) return;
      const rect = bar.getBoundingClientRect();
      const target = seekFraction(clientX, rect.left, rect.width) * total;
      try {
        video.currentTime = target;
      } catch {
        /* Некоторые движки не дают перейти в неподгруженную часть — не беда. */
      }
      setAt(target);
    },
    [total],
  );

  const fraction = timeToFraction(at, total);
  /* Пока заметка не играла, показываем полную длительность, а не 0:00: человеку
     важно знать, сколько слушать, ещё до нажатия. */
  const label = playing || at > 0 ? formatNoteTime(Math.max(0, total - at)) : formatNoteTime(total);

  return (
    /* Размер стороны на большом экране приходит переменной, а не инлайновым
       width: инлайновый стиль нельзя отменить в медиазапросе, и телефонная
       ширина всегда проигрывала бы ему. */
    <div
      className="mt-1 w-[min(70vw,420px)] md:w-[var(--tz-note-size)]"
      style={{ "--tz-note-size": `${size}px` } as CSSProperties}
    >
      <button
        type="button"
        onClick={toggle}
        className="relative block w-full aspect-square rounded-2xl overflow-hidden bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400"
        aria-label={playing ? "Остановить видеосообщение" : "Воспроизвести видеосообщение"}
      >
        <video
          ref={videoRef}
          src={url}
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
        />
        {failed && (
          <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] leading-snug text-white/80 bg-black/70">
            Видеосообщение не загрузилось
          </span>
        )}
        {!playing && !failed && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <span className="w-11 h-11 rounded-full bg-black/50 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        )}
      </button>

      {/* Полоса прокрутки под квадратом, а не внутри: внутри она оказалась бы
          вложенной в кнопку воспроизведения, и одно касание означало бы сразу два
          действия. */}
      <div className="mt-1 flex items-center gap-2">
        <div
          ref={barRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e.clientX);
          }}
          className="relative h-5 flex-1 flex items-center cursor-pointer touch-none"
          role="slider"
          aria-label="Позиция в заметке"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(at)}
          tabIndex={0}
          onKeyDown={(e) => {
            const video = videoRef.current;
            if (!video || total <= 0) return;
            /* Клавиатура: заметку слушают и с настольной версии, где полосу
               двигают стрелками, а не пальцем. */
            if (e.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 3);
            if (e.key === "ArrowRight") video.currentTime = Math.min(total, video.currentTime + 3);
          }}
        >
          <span className="absolute left-0 right-0 h-[3px] rounded-full bg-neutral-300 dark:bg-white/15" />
          <span
            className="absolute left-0 h-[3px] rounded-full bg-violet-500 dark:bg-cyan-400"
            style={{ width: `${fraction * 100}%` }}
          />
          <span
            className="absolute w-2.5 h-2.5 rounded-full bg-violet-500 dark:bg-cyan-400 -ml-[5px]"
            style={{ left: `${fraction * 100}%` }}
          />
        </div>
        <span className="text-[11px] font-mono text-neutral-400 tabular-nums">{label}</span>
      </div>
    </div>
  );
}
