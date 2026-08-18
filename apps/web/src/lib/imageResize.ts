/* FIX-SHARPSTATIC: sharp импортируется СТАТИЧЕСКИ.

   Почему это важно. Предыдущая версия грузила sharp через `await import("sharp")`.
   В сборке `output: "standalone"` (Next 16, Turbopack) трассировщик файлов не
   видит нативный модуль за динамическим импортом и не копирует его бинари в
   standalone-каталог. Сборка проходит, а в рантайме первый же вызов падает —
   маршрут загрузки отвечал 500 и в чате появлялось «Не удалось загрузить файл»
   при вставке картинки из буфера обмена.

   Статический импорт возвращает трассировку: так было до правки совместимости и
   так работает. Выбор нативный бинарь / WASM sharp 0.34+ делает сам, ручной
   импорт @img/sharp-wasm32 не нужен (и ломает типизацию — см. прошлый CI).
*/

import sharp from "sharp";

export interface ResizeOptions {
  /** Максимальный размер стороны (fit: inside). */
  maxDimension: number;
  /** Качество WebP (1–100). */
  quality: number;
  /** Если true — вписать в квадрат через contain (для эмодзи). */
  contain?: boolean;
  /** Размер квадрата (contain-режим). */
  containSize?: number;
}

/** Сжимает / вписывает картинку и отдаёт WebP-буфер. */
export async function resizeToWebp(input: Buffer, opts: ResizeOptions): Promise<Buffer> {
  if (opts.contain && opts.containSize) {
    return sharp(input)
      .resize(opts.containSize, opts.containSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: opts.quality })
      .toBuffer();
  }
  return sharp(input)
    .resize(opts.maxDimension, opts.maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: opts.quality })
    .toBuffer();
}
