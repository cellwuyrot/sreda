"use client";

import { useEffect, useRef, useState } from "react";

/**
 * BRAND-LOADER: живая эмблема в круге, вокруг которого идёт загрузка.
 *
 * ── Где лежит файл ────────────────────────────────────────────────
 *
 * `apps/web/public/brand/dvd.mp4`. В `docs/` видео лежать не может: эта папка не
 * раздаётся браузеру и в сборку не попадает — запрос вернёт 404. Всё, что видит
 * страница по прямому адресу, лежит в `public/`.
 *
 * ── Почему есть подмена картинкой ───────────────────────────────────
 *
 * Это экран загрузки — его видят до того, как что-либо заработало. Если видео не
 * положили, не скачалось на слабой сети или браузер запретил воспроизведение —
 * на месте эмблемы обязана остаться прежняя картинка, а не чёрная дыра.
 *
 * ── Почему размер задаётся числом ──────────────────────────────────
 *
 * Источник — квадрат 1080×1080, а места вывода разные: 56 px на заставке
 * мессенджера, 40 px на общем экране загрузки. Классы тут не подходят: ширина
 * кольца и отступ считаются от диаметра, и при произвольном классе кольцо
 * расходится с кругом.
 */
export const BRAND_VIDEO_SRC = "/brand/dvd.mp4";
export const BRAND_POSTER_SRC = "/logo.png";

export default function BrandLoader({
  /** Диаметр самого круга в пикселях — ровно тот, какой был у статичной иконки. */
  size = 56,
  /** Нарисовать вокруг вращающееся кольцо загрузки. */
  ring = true,
  /** Зазор между кругом и кольцом. */
  gap = 10,
  className = "",
}: {
  size?: number;
  ring?: boolean;
  gap?: number;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    /* Автовоспроизведение беззвучного видео разрешено везде, но обещание всё равно
       может быть отклонено (экономия заряда, жёсткие настройки приватности).
       Необработанный отказ вывел бы в консоль ошибку на каждой загрузке страницы. */
    const played = video.play();
    if (played && typeof played.catch === "function") played.catch(() => setFailed(true));
  }, [failed]);

  const ringSize = size + gap * 2;
  const box = ring ? ringSize : size;

  return (
    <div
      className={`relative grid place-items-center ${className}`}
      style={{ width: box, height: box }}
      role="status"
      aria-label="Загрузка"
    >
      {ring ? (
        <>
          {/* Неподвижный обод даёт кольцу очертание и на светлом фоне. */}
          <span
            className="absolute rounded-full border border-black/10 dark:border-white/10"
            style={{ width: ringSize, height: ringSize }}
          />
          <span
            className="absolute animate-spin rounded-full border-2 border-transparent"
            style={{
              width: ringSize,
              height: ringSize,
              borderTopColor: "var(--cn-accent, #00d4ff)",
              borderRightColor: "var(--cn-accent, #00d4ff)",
            }}
          />
        </>
      ) : null}

      {failed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={BRAND_POSTER_SRC}
          alt="TZ.Connect"
          width={size}
          height={size}
          className="rounded-full object-cover select-none"
          style={{ width: size, height: size }}
          draggable={false}
        />
      ) : (
        <video
          ref={videoRef}
          src={BRAND_VIDEO_SRC}
          poster={BRAND_POSTER_SRC}
          width={size}
          height={size}
          /* Круг из квадрата: `object-cover` страхует от источника с другим
             соотношением сторон — иначе видео сжало бы в овал. */
          className="rounded-full object-cover select-none"
          style={{ width: size, height: size }}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          /* Без этого на телефоне долгое нажатие на заставку предлагает скачать ролик. */
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
          aria-hidden
        />
      )}
    </div>
  );
}
