// Browser-side helpers for turning an uploaded image file into a compact data
// URL that can live in localStorage alongside the rest of the board state.

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Read an image file and downscale it (keeping aspect ratio) so the stored
 * data URL stays small enough for localStorage. Falls back to the raw data URL
 * if anything goes wrong.
 */
export async function fileToDataUrl(
  file: File,
  maxDim = 1200,
  quality = 0.85,
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    return canvas.toDataURL(type, quality);
  } catch {
    return dataUrl;
  }
}

/** Guess a file extension from an image data URL's MIME type. */
export function extFromDataUrl(dataUrl: string): string {
  const m = /^data:image\/([a-zA-Z0-9.+-]+)/.exec(dataUrl);
  const t = (m?.[1] || "png").toLowerCase();
  if (t === "jpeg") return "jpg";
  if (t === "svg+xml") return "svg";
  return t;
}

/** Trigger a browser download of an image (data URL) with a safe file name. */
export function downloadImage(dataUrl: string, name: string): void {
  const base = (name || "изображение").replace(/[\\/:*?"<>|]+/g, "").trim() || "изображение";
  const fileName = base.includes(".") ? base : `${base}.${extFromDataUrl(dataUrl)}`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
