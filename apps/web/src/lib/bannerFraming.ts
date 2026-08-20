/**
 * FIX-BGCROP: рамка фонового изображения профиля.
 *
 * ── Зачем это нужно ───────────────────────────────────────────────
 *
 * Шапка профиля широкая и низкая, а люди грузят туда обычные картинки и
 * гифки любых пропорций. Обрезать файл на сервере нельзя: анимированный GIF
 * при любой пересборке (canvas в браузере или библиотека на сервере) теряет
 * все кадры, кроме первого — именно так и выглядело «гифка не загружается».
 *
 * Поэтому файл хранится байт в байт, а «какая его часть видна» хранится тремя
 * числами в адресе картинки: fx/fy — точка внимания в процентах, z — масштаб.
 * Новой колонки в базе для этого не заводим сознательно: фон лежит в трёх местах
 * (User.profileBanner, GroupMember.profileBanner и карточка участника), и миграция
 * потребовала бы три новые колонки и три новых пути чтения; адрес же уже едет
 * везде, где нужно, и лишние параметры статике безразличны.
 *
 * Старые значения (путь без параметров или data URL) читаются как «центр, без
 * масштаба» — ровно то поведение, которое было до этой правки.
 */

import type { CSSProperties } from "react";

/** Предел размера файла фона — столько же принимает POST /api/profile/avatar. */
export const BANNER_MAX_BYTES = 10 * 1024 * 1024;

/** Типы, которые проверяет сервер (lib/fileValidation.ts) — держим список рядом. */
export const BANNER_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export interface BannerFraming {
  /** Адрес целиком — его и нужно подставлять в src. */
  src: string;
  /** Основа адреса без параметров рамки. */
  base: string;
  fx: number;
  fy: number;
  zoom: number;
}

export const BANNER_FRAME_DEFAULT = { fx: 50, fy: 50, zoom: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Разбирает значение фона. Пустота — null, чтобы вызывающий не проверял три вида пустоты. */
export function parseBanner(value: string | null | undefined): BannerFraming | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  /* data URL рамку не несёт: там в адресе сами байты, и добавлять к ним запрос
     нельзя. Такие значения остались от старых профилей сообществ. */
  if (!raw.startsWith("/")) {
    return { src: raw, base: raw, ...BANNER_FRAME_DEFAULT };
  }
  const q = raw.indexOf("?");
  if (q < 0) return { src: raw, base: raw, ...BANNER_FRAME_DEFAULT };
  const base = raw.slice(0, q);
  const params = new URLSearchParams(raw.slice(q + 1));
  const num = (key: string, fallback: number): number => {
    const parsed = Number(params.get(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    src: raw,
    base,
    fx: clamp(num("fx", 50), 0, 100),
    fy: clamp(num("fy", 50), 0, 100),
    zoom: clamp(num("z", 1), 1, 4),
  };
}

/** Собирает адрес с рамкой. Рамка по умолчанию в адрес не пишется. */
export function buildBanner(src: string, fx: number, fy: number, zoom: number): string {
  const base = src.split("?")[0];
  if (!base.startsWith("/")) return base;
  const x = Math.round(clamp(fx, 0, 100));
  const y = Math.round(clamp(fy, 0, 100));
  const z = Math.round(clamp(zoom, 1, 4) * 100) / 100;
  if (x === 50 && y === 50 && z === 1) return base;
  return `${base}?fx=${x}&fy=${y}&z=${z}`;
}

/**
 * Стиль для <img class="object-cover"> внутри рамки.
 *
 * transform-origin совпадает с точкой внимания: иначе приближение уводит кадр от
 * выбранного места, и человек видит не то, что выставлял в настройках.
 */
export function bannerImgStyle(value: string | null | undefined): CSSProperties {
  const framing = parseBanner(value);
  if (!framing) return {};
  return {
    objectFit: "cover",
    objectPosition: `${framing.fx}% ${framing.fy}%`,
    transform: framing.zoom === 1 ? undefined : `scale(${framing.zoom})`,
    transformOrigin: `${framing.fx}% ${framing.fy}%`,
  };
}

/** То же самое для шапки, которая рисуется фоном блока, а не тегом <img>. */
export function bannerBackgroundStyle(value: string | null | undefined): CSSProperties | undefined {
  const framing = parseBanner(value);
  if (!framing) return undefined;
  return {
    backgroundImage: `url("${framing.src}")`,
    /* При масштабе 1 оставляем cover — картинка гарантированно закрывает шапку. */
    backgroundSize: framing.zoom === 1 ? "cover" : `${Math.round(framing.zoom * 100)}% auto`,
    backgroundPosition: `${framing.fx}% ${framing.fy}%`,
    backgroundRepeat: "no-repeat",
  };
}
