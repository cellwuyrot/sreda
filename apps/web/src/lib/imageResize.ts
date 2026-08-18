/* FIX-SHARPCOMPAT: обёртка над sharp, которая не зависит от нативных
   бинарников конкретной платформы.

   Sharp 0.34+ включает пакет @img/sharp-wasm32, который уже прописан
   в package-lock.json и работает без любых нативных привязок.
   Если обычный нативный sharp почему-то не загружается (несовместимое
   железо), функция makeSharp() автоматически переключается на WASM.

   lock-файл не меняется — CI проходит с тем же npm ci. */

import type { Sharp } from "sharp";

type SharpFactory = (input: Buffer) => Sharp;

let _factory: SharpFactory | null = null;
let _tried = false;

async function getFactory(): Promise<SharpFactory> {
  if (_factory) return _factory;
  if (_tried) throw new Error("sharp is unavailable on this platform");
  _tried = true;

  // Попытка 1: обычный нативный sharp
  try {
    const s = (await import("sharp")).default;
    // Проверочный вызов: если нативный модуль не загрузился, ошибка возникнет здесь.
    await s(Buffer.alloc(8)).metadata();
    _factory = (buf: Buffer) => s(buf);
    console.log("[imageResize] using native sharp");
    return _factory;
  } catch (e1) {
    console.warn("[imageResize] native sharp failed, trying WASM build:", (e1 as Error).message);
  }

  // Попытка 2: WASM-сборка (уже есть в lock-файле как @img/sharp-wasm32)
  try {
    const s = (await import("@img/sharp-wasm32")).default as SharpFactory;
    _factory = s;
    console.log("[imageResize] using WASM sharp");
    return _factory;
  } catch (e2) {
    throw new Error(
      `sharp unavailable (native: platform mismatch; wasm: ${(e2 as Error).message}). ` +
        "Run: npm rebuild sharp",
    );
  }
}

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

/**
 * Сжимает / вписывает картинку и отдаёт WebP-буфер.
 * Использует нативный sharp если доступен, иначе WASM-фоллбек.
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
