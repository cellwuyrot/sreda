/* FIX-SHARPCOMPAT: совместимость sharp с любым железом.
​
   Sharp 0.34+ включает @img/sharp-wasm32 как опциональную зависимость и
   автоматически переключается на неё если нативный бинарь не подходит
   к платформе. Ручной импорт WASM не нужен — sharp делает это сам.
​
   Здесь мы только скрываем ошибку загрузки (MODULE_NOT_FOUND при неожиданной
   архитектуре) и логируем её, чтобы было понятно что происходит.  Если sharp
   не загрузился совсем — выбрасываем понятное сообщение. */
​
import type { Sharp } from "sharp";
​
type SharpFactory = (input: Buffer) => Sharp;
​
let _factory: SharpFactory | null = null;
let _tried = false;
​
async function getFactory(): Promise<SharpFactory> {
  if (_factory) return _factory;
  if (_tried) throw new Error("[imageResize] sharp unavailable — run: npm rebuild sharp");
  _tried = true;
​
  // sharp 0.34+ сам выбирает нативный бинарь или WASM-сборку;
  // нам достаточно просто импортировать пакет.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharpMod = await import("sharp").catch((err: Error) => {
    throw new Error(`[imageResize] failed to load sharp: ${err.message}. Run: npm rebuild sharp`);
  });
  _factory = sharpMod.default as unknown as SharpFactory;
  return _factory;
}
​
export interface ResizeOptions {
  /** Максимальный размер стороны (для scaleToFit). */
  maxDimension: number;
  /** Качество WebP (1–100). */
  quality: number;
  /** Если true — вписать в квадрат через contain (для эмодзи). */
  contain?: boolean;
  /** Размер квадрата (contain-режим). */
  containSize?: number;
}
​
/**
 * Сжимает / вписывает картинку и отдаёт WebP-буфер.
 * Использует нативный sharp или WASM-сборку — sharp выбирает сам.
 */
export async function resizeToWebp(input: Buffer, opts: ResizeOptions): Promise<Buffer> {
  const factory = await getFactory();
  if (opts.contain && opts.containSize) {
    return factory(input)
      .resize(opts.containSize, opts.containSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: opts.quality })
      .toBuffer();
  }
  return factory(input)
    .resize(opts.maxDimension, opts.maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: opts.quality })
    .toBuffer();
}
​