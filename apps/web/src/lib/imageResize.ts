/* FIX-NOSHARP: на сервере больше нет обработки картинок нативной библиотекой.

   Почему. `sharp` с версии 0.33 поставляет готовые бинарники под
   микроархитектуру x86-64-v2. Процессор этой машины таких флагов не отдаёт,
   поэтому модуль не грузится ни в рантайме, ни на шаге сборки («Collecting
   page data»), а WASM-вариант в этой связке не подхватился. Собрать sharp из
   исходников тоже нельзя: системный libvips в Ubuntu 22.04 старше требуемого.

   Что вместо. Уменьшение и сжатие делает БРАУЗЕР перед отправкой — см.
   `lib/clientImageResize.ts`: canvas умеет и масштабировать, и кодировать
   WebP, причём без нагрузки на сервер. Серверу остаётся то, чему нельзя верить
   на слово: проверка сигнатуры (lib/fileValidation) и защита от
   «картинки-бомбы» — файла с огромными сторонами. Байты сохраняются как есть,
   поэтому в этом модуле нет ни одной зависимости.
*/

export interface ImageInfo {
  width: number;
  height: number;
}

/** Предел стороны: выше — это уже не фотография, а попытка занять память. */
export const MAX_IMAGE_DIMENSION = 12000;

/** Размеры картинки по заголовку: PNG, JPEG, GIF, WebP. null — формат незнаком. */
export function imageSize(buf: Buffer): ImageInfo | null {
  if (buf.length < 24) return null;

  /* PNG: подпись, затем блок IHDR с размерами. */
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  /* GIF87a / GIF89a: размеры сразу после подписи, порядок байтов обратный. */
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  /* WebP: контейнер RIFF, дальше вид блока. */
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) {
      return {
        width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
    if (chunk === "VP8 " && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }

  /* JPEG: идём по маркерам до кадра SOF — только там лежат размеры. */
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      if (len < 2) return null;
      i += 2 + len;
    }
  }

  return null;
}

/** Текст ошибки, если сторона больше предела. null — картинка нормальная. */
export function imageDimensionError(buf: Buffer, max: number = MAX_IMAGE_DIMENSION): string | null {
  const size = imageSize(buf);
  if (!size) return null;
  if (size.width > max || size.height > max) {
    return `Слишком большое изображение: ${size.width}×${size.height} (предел ${max} px по стороне)`;
  }
  return null;
}

/** Расширение по типу картинки. */
export function imageExtension(mime: string): string {
  switch (mime.split(";")[0].trim().toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/** Расширение по САМИМ байтам — присланный тип здесь не участвует. */
export function imageExtensionFromBuffer(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export interface StoredImage {
  buffer: Buffer;
  ext: string;
  mime: string;
}

/**
 * Что положить на диск. Байты не меняются: формат остаётся тем, в котором
 * картинку прислали, а имя файла получает соответствующее расширение — иначе
 * имя `.webp` с содержимым JPEG сломало бы отдачу и просмотр.
 */
export function prepareImage(buffer: Buffer, mime: string): StoredImage {
  const ext = imageExtensionFromBuffer(buffer) ?? imageExtension(mime);
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  return { buffer, ext, mime: byExt[ext] ?? mime };
}
