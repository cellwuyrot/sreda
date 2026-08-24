/* GROUP-SKIN / FIT-BANNER: подгонка загружаемых картинок под нужный размер и
   соотношение сторон прямо в браузере.

   Зачем: баннер и фоны лежат в поле `Group.theme` строкой data URL. Пользователь
   приносит фотографию 4000×3000 на 6 МБ, она не влезает в лимит записи, а если бы
   и влезла — растянулась бы поперёк шапки. Поэтому картинка масштабируется по
   принципу «заполнить» (cover), обрезается по центру до нужной пропорции и
   пережимается в webp с понижением качества, пока не уложится в лимит.

   Анимация (GIF) отдельный случай: перерисовать её через canvas нельзя, кадры
   потеряются. Поэтому анимированный GIF сохраняется как есть, если он проходит по
   размеру; если нет — берётся первый кадр, подогнанный обычным путём, и
   возвращается пометка, чтобы редактор честно сказал об этом.

   Видео в base64 не кладём: даже секунда 1080p раздувает запись. Для видео
   проверяется только вес, пропорции держит `object-fit: cover` в разметке. */

export const BANNER_W = 1280;
export const BANNER_H = 400;
export const SURFACE_W = 1600;
export const SURFACE_H = 1000;

/** Допустимое расхождение пропорции, при котором картинку не трогаем. */
const RATIO_TOLERANCE = 0.04;

export interface FitResult {
	/** Готовый data URL. */
	url: string;
	/** Человеческое пояснение, если файл пришлось изменить. */
	note?: string;
}

function readAsDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(new Error("read"));
		reader.readAsDataURL(file);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("decode"));
		img.src = src;
	});
}

/**
 * Анимированный ли GIF. Считаем блоки Graphic Control Extension (0x21 0xF9):
 * у статичного GIF их не больше одного.
 */
async function isAnimatedGif(file: Blob): Promise<boolean> {
	const buf = new Uint8Array(await file.arrayBuffer());
	let frames = 0;
	for (let i = 0; i < buf.length - 9; i++) {
		if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
			frames++;
			if (frames > 1) return true;
		}
	}
	return false;
}

/** Обрезать по центру до пропорции и сжать до лимита. Возвращает data URL. */
async function renderFitted(
	img: HTMLImageElement,
	targetW: number,
	targetH: number,
	maxBytes: number,
): Promise<string> {
	// Не увеличиваем маленькие картинки: апскейл только портит и весит больше.
	const scale = Math.min(1, img.naturalWidth / targetW, img.naturalHeight / targetH);
	const outW = Math.max(320, Math.round(targetW * (scale || 1)));
	const outH = Math.max(120, Math.round(targetH * (scale || 1)));

	const canvas = document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas");
	ctx.imageSmoothingQuality = "high";

	// cover: берём максимальный прямоугольник исходника с нужной пропорцией.
	const srcRatio = img.naturalWidth / img.naturalHeight;
	const dstRatio = outW / outH;
	let sw = img.naturalWidth;
	let sh = img.naturalHeight;
	if (srcRatio > dstRatio) {
		sw = Math.round(img.naturalHeight * dstRatio);
	} else {
		sh = Math.round(img.naturalWidth / dstRatio);
	}
	const sx = Math.round((img.naturalWidth - sw) / 2);
	const sy = Math.round((img.naturalHeight - sh) / 2);
	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

	// webp с понижением качества, затем уменьшение самого холста.
	for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
		const url = canvas.toDataURL("image/webp", quality);
		if (url.length <= maxBytes) return url;
	}
	let w = outW;
	let h = outH;
	for (let step = 0; step < 4; step++) {
		w = Math.round(w * 0.75);
		h = Math.round(h * 0.75);
		const small = document.createElement("canvas");
		small.width = w;
		small.height = h;
		small.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
		const url = small.toDataURL("image/webp", 0.6);
		if (url.length <= maxBytes) return url;
	}
	throw new Error("too-big");
}

/**
 * Подогнать картинку под баннер (или под фон, если передать свои размеры).
 * Ничего не делает, если файл и так укладывается в лимит и в пропорцию.
 */
export async function fitImageFile(
	file: File,
	opts: { width: number; height: number; maxBytes: number },
): Promise<FitResult> {
	const raw = await readAsDataUrl(file);
	const animated = file.type === "image/gif" && (await isAnimatedGif(file));

	if (animated) {
		if (raw.length <= opts.maxBytes) {
			return {
				url: raw,
				note: "Анимация сохранена целиком, кадрирование по центру выполнит сам баннер.",
			};
		}
		const img = await loadImage(raw);
		const url = await renderFitted(img, opts.width, opts.height, opts.maxBytes);
		return {
			url,
			note: `Анимация весила ${Math.round(raw.length / 1024)} КБ — это больше лимита, поэтому сохранён первый кадр. Для живого баннера используйте ссылку на mp4/webm или градиент с анимацией.`,
		};
	}

	const img = await loadImage(raw);
	const srcRatio = img.naturalWidth / img.naturalHeight;
	const dstRatio = opts.width / opts.height;
	const ratioOk = Math.abs(srcRatio - dstRatio) / dstRatio <= RATIO_TOLERANCE;
	const sizeOk = raw.length <= opts.maxBytes;
	const dimsOk = img.naturalWidth <= opts.width * 1.35;

	if (ratioOk && sizeOk && dimsOk) return { url: raw };

	const url = await renderFitted(img, opts.width, opts.height, opts.maxBytes);
	const parts: string[] = [];
	if (!ratioOk) parts.push(`обрезана по центру до ${opts.width}×${opts.height}`);
	else if (!dimsOk) parts.push(`уменьшена до ${opts.width}×${opts.height}`);
	if (!sizeOk) parts.push(`сжата до ${Math.round(url.length / 1024)} КБ`);
	return { url, note: parts.length ? `Картинка ${parts.join(" и ")}.` : undefined };
}

export function fitBannerFile(file: File, maxBytes: number): Promise<FitResult> {
	return fitImageFile(file, { width: BANNER_W, height: BANNER_H, maxBytes });
}

export function fitSurfaceFile(file: File, maxBytes: number): Promise<FitResult> {
	return fitImageFile(file, { width: SURFACE_W, height: SURFACE_H, maxBytes });
}

/** Понятный текст ошибки вместо голого исключения. */
export function fitErrorText(err: unknown, maxBytes: number): string {
	const code = err instanceof Error ? err.message : "";
	if (code === "decode") return "Не удалось прочитать файл: формат не поддерживается браузером.";
	if (code === "too-big")
		return `Даже после сжатия картинка больше ${Math.round(maxBytes / 1024)} КБ. Возьмите файл попроще или укажите ссылку https://.`;
	return "Не удалось обработать файл. Попробуйте другой.";
}
