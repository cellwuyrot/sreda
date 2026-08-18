"use client";

/* FIX-NOSHARP: уменьшение и сжатие картинок ПЕРЕД отправкой, силами браузера.

   Сервер картинки больше не перекодирует (см. lib/imageResize.ts), поэтому
   работу делает та сторона, у которой для этого всё уже есть: canvas
   масштабирует, а `toBlob` кодирует WebP. Получается тот же результат, что
   раньше давал сервер, только без нагрузки на него и без загрузки исходных
   мегабайтов по сети.

   Любая осечка (старый браузер, битый файл, отсутствие WebP) не должна мешать
   отправке: тогда возвращается исходный файл, а размер всё равно ограничен
   проверками на сервере.
*/

export interface DownscaleOptions {
  /** Предел стороны в пикселях; в режиме square — сторона квадрата. */
  maxDimension: number;
  /** Качество кодирования, 0–1. */
  quality?: number;
  /** Вписать в квадрат (для эмодзи), не обрезая содержимое. */
  square?: boolean;
}

/* Анимацию трогать нельзя: canvas отдаст один кадр. */
const SKIP_TYPES = ["image/gif", "image/apng", "image/svg+xml"];

/** Порог, ниже которого пережимать нечего. */
const KEEP_AS_IS_BYTES = 600 * 1024;

function canEncodeWebp(): boolean {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    return probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

type Decoded = { width: number; height: number; draw: CanvasImageSource; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, draw: bitmap, release: () => bitmap.close() };
    } catch {
      /* ниже — обычная картинка через объектный URL */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: img,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function renamed(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${ext}`;
}

/** Уменьшить картинку. Всё, что не картинка или не поддаётся — возвращается как есть. */
export async function downscaleImageFile(file: File, opts: DownscaleOptions): Promise<File> {
  try {
    if (typeof document === "undefined") return file;
    if (!file.type.startsWith("image/")) return file;
    if (SKIP_TYPES.includes(file.type)) return file;

    const decoded = await decode(file);
    if (!decoded) return file;
    if (decoded.width < 1 || decoded.height < 1) {
      decoded.release();
      return file;
    }

    const longest = Math.max(decoded.width, decoded.height);
    if (!opts.square && longest <= opts.maxDimension && file.size <= KEEP_AS_IS_BYTES) {
      decoded.release();
      return file;
    }

    const scale = Math.min(1, opts.maxDimension / longest);
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = opts.square ? opts.maxDimension : w;
    canvas.height = opts.square ? opts.maxDimension : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      decoded.release();
      return file;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      decoded.draw,
      opts.square ? Math.round((canvas.width - w) / 2) : 0,
      opts.square ? Math.round((canvas.height - h) / 2) : 0,
      w,
      h,
    );
    decoded.release();

    const webp = canEncodeWebp();
    const type = webp ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), type, opts.quality ?? 0.82);
    });
    if (!blob || blob.size === 0) return file;
    /* Если «сжатие» вышло тяжелее исходника — исходник и отправляем. */
    if (!opts.square && blob.size >= file.size) return file;

    return new File([blob], renamed(file.name, webp ? "webp" : "jpg"), {
      type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** Вложение в переписку: до 1920 px по длинной стороне. */
export function downscaleForChat(file: File): Promise<File> {
  return downscaleImageFile(file, { maxDimension: 1920, quality: 0.82 });
}

/** Эмодзи сообщества: квадрат 128×128, содержимое вписывается целиком. */
export function downscaleForEmoji(file: File): Promise<File> {
  return downscaleImageFile(file, { maxDimension: 128, quality: 0.92, square: true });
}
