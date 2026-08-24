/* FIT-BANNER: подгонка загружаемых картинок и анимаций под шапку сообщества.

   Раньше файл клался в тему как есть: вертикальное фото растягивало шапку, а тяжёлый
   файл просто отклонялся с ошибкой. Теперь кадр обрезается по центру до нужного
   соотношения и сжимается до лимита.

   Анимация (GIF): если файл укладывается в лимит и пропорции близки к нужным —
   сохраняем целиком, иначе берём первый кадр и честно предупреждаем об этом:
   перекодировать анимацию в браузере без тяжёлых библиотек нечем. */

export const BANNER_W = 1280;
export const BANNER_H = 400;
export const SURFACE_W = 1600;
export const SURFACE_H = 1000;

/** Допустимое отклонение пропорций, при котором обрезка не нужна. */
export const RATIO_TOLERANCE = 0.04;

export type FitResult = {
  /** data:-строка, готовая для записи в тему. */
  url: string;
  /** Пояснение для пользователя, если файл пришлось изменить. */
  note?: string;
};

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("decode"));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/** Анимированный GIF определяем по числу блоков Graphic Control Extension. */
async function isAnimatedGif(file: File): Promise<boolean> {
  if (!/gif/i.test(file.type) && !/\.gif$/i.test(file.name)) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let frames = 0;
  for (let i = 0; i < bytes.length - 3; i += 1) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      frames += 1;
      if (frames > 1) return true;
    }
  }
  return false;
}

/** Обрезка по центру (cover) + сжатие в webp до указанного веса. */
function renderFitted(img: HTMLImageElement, width: number, height: number, maxBytes: number): string {
  let w = width;
  let h = height;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");

    const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);

    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const url = canvas.toDataURL("image/webp", quality);
      if (url.length <= maxBytes) return url;
    }

    w *= 0.75;
    h *= 0.75;
  }

  throw new Error("too-big");
}

async function fitImageFile(
  file: File,
  target: { width: number; height: number; maxBytes: number },
): Promise<FitResult> {
  const original = await readAsDataUrl(file);
  const animated = await isAnimatedGif(file);
  const img = await loadImage(original);

  const wanted = target.width / target.height;
  const actual = img.naturalWidth / img.naturalHeight;
  const ratioOk = Math.abs(actual - wanted) / wanted <= RATIO_TOLERANCE;
  const sizeOk = original.length <= target.maxBytes;

  /* Анимацию сохраняем целиком, пока она влезает и не ломает пропорции. */
  if (animated && sizeOk && ratioOk) return { url: original };

  if (!animated && sizeOk && ratioOk) return { url: original };

  const url = renderFitted(img, target.width, target.height, target.maxBytes);

  if (animated) {
    return {
      url,
      note: `Анимация не подошла по ${sizeOk ? "соотношению сторон" : "размеру"}: сохранён первый кадр, обрезанный под ${target.width}×${target.height}. Для живой анимации возьмите градиент или видео-баннер.`,
    };
  }

  return {
    url,
    note: ratioOk
      ? "Картинка была тяжёлой — сжали её автоматически."
      : `Картинка обрезана по центру под ${target.width}×${target.height}.`,
  };
}

export function fitBannerFile(file: File, maxBytes: number): Promise<FitResult> {
  return fitImageFile(file, { width: BANNER_W, height: BANNER_H, maxBytes });
}

export function fitSurfaceFile(file: File, maxBytes: number): Promise<FitResult> {
  return fitImageFile(file, { width: SURFACE_W, height: SURFACE_H, maxBytes });
}

/** Человеческий текст ошибки для диалога. */
export function fitErrorText(err: unknown, maxBytes: number): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "too-big") {
    return `Файл слишком тяжёлый даже после сжатия (лимит около ${Math.round(maxBytes / 1024)} КБ). Возьмите картинку попроще или укажите ссылку https://.`;
  }
  if (code === "canvas") return "Браузер не смог обработать изображение. Попробуйте другой файл.";
  return "Не удалось прочитать файл. Подойдут PNG, JPG, WEBP или GIF.";
}
