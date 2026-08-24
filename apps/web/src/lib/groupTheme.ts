/* ══════════════════════════════════════════════════════════════════════════
   GROUP-SKIN: оформление сообщества (инструменты дизайна группы)
   ══════════════════════════════════════════════════════════════════════════

   У подписчика уже есть своё оформление (`lib/premiumSkin.ts`) — оно личное и
   едет с ним по всему приложению. Здесь другая задача: сообщество задаёт вид
   своих комнат, и внутри сообщества его оформление главнее личного. Именно
   поэтому правила сообщества в globals.css идут с !important, а личные — без: иначе
   два слоя боролись бы за одно свойство по порядку загрузки, а не по смыслу.
   Флажок `priority` оставляет сообществу возможность уступить вкусу человека.

   Хранится всё одним JSON в `Group.theme`. Отдельные колонки на три десятка
   параметров оформления пришлось бы мигрировать при каждом новом ползунке,
   а выборки по ним никому не нужны. Обратная сторона — всё, что пришло из
   базы, прогоняется через `normalizeGroupTheme`: чужой JSON не должен попасть в CSS. */

export const GROUP_THEME_VERSION = 1;
/** Предел на весь JSON оформления: баннер и фоны могут быть data URL. */
export const GROUP_THEME_MAX_JSON = 1_400_000;

export type SurfaceMode = "theme" | "solid" | "gradient" | "image";
export type SurfaceFit = "cover" | "contain" | "tile";

export interface GroupSurface {
	mode: SurfaceMode;
	/** Однотонный фон. */
	color: string;
	/** Градиент: два или три цвета и угол в градусах. */
	from: string;
	via: string;
	to: string;
	useVia: boolean;
	angle: number;
	/** Картинка: https:// или data:image/*. */
	image: string;
	fit: SurfaceFit;
	/** Затемнение в процентах: без него текст теряется на ярком фоне. */
	dim: number;
}

export type BannerKind = "none" | "image" | "video" | "gradient";

export interface GroupBannerCfg {
	kind: BannerKind;
	/** Картинка/GIF — data URL или адрес; видео — только адрес (mp4/webm). */
	url: string;
	from: string;
	via: string;
	to: string;
	useVia: boolean;
	angle: number;
	/** Анимация градиента/видео. Выключается и самим браузером при prefers-reduced-motion. */
	animated: boolean;
	/** Прозрачность темного слоя поверх баннера, чтобы читалось название. */
	overlay: number;
}

export type ParticleKind =
	| "none"
	| "snow"
	| "stars"
	| "embers"
	| "bubbles"
	| "fireflies"
	| "rain"
	| "petals"
	| "matrix"
	| "confetti";

export interface GroupParticles {
	kind: ParticleKind;
	/** Плотность в процентах от предела вида (предел свой у каждого). */
	density: number;
	/** Скорость в процентах от базовой. */
	speed: number;
	size: number;
	color: string;
	/** Прозрачность слоя в процентах. Выше 60 % читать переписку уже мешает. */
	opacity: number;
	/** Реагировать на курсор. */
	interactive: boolean;
}

export interface GroupFontCfg {
	/** "theme" — шрифт темы, без подмены. */
	mode: "theme" | "builtin";
	family: string;
	/** Масштаб текста в процентах: 90…115. Больше ломает вёрстку панелей. */
	scale: number;
}

export interface GroupTheme {
	version: number;
	enabled: boolean;
	/** id пресета, от которого отталкивались — только для подсветки в редакторе. */
	preset: string;
	/** Оформление сообщества главнее личного Premium-оформления. */
	priority: boolean;
	/** Область переписки. */
	chat: GroupSurface;
	/** Панель текстовых каналов. */
	channels: GroupSurface;
	/** Голосовые каналы и голосовые комнаты. */
	voice: GroupSurface;
	accent: string;
	useAccent: boolean;
	font: GroupFontCfg;
	banner: GroupBannerCfg;
	particles: GroupParticles;
}

/* ───────────────────────── Словари ─────────────────────── */

export const SURFACE_MODE_OPTIONS: { value: SurfaceMode; label: string }[] = [
	{ value: "theme", label: "Как в теме" },
	{ value: "solid", label: "Цвет" },
	{ value: "gradient", label: "Градиент" },
	{ value: "image", label: "Картинка" },
];

export const FIT_OPTIONS: { value: SurfaceFit; label: string }[] = [
	{ value: "cover", label: "Заполнить" },
	{ value: "contain", label: "Целиком" },
	{ value: "tile", label: "Плиткой" },
];

export const PARTICLE_OPTIONS: { value: ParticleKind; label: string; hint: string }[] = [
	{ value: "none", label: "Нет", hint: "Без частиц" },
	{ value: "snow", label: "Снег", hint: "Медленно падающие хлопья" },
	{ value: "stars", label: "Звёзды", hint: "Мерцание на месте" },
	{ value: "embers", label: "Искры", hint: "Угли, летящие вверх" },
	{ value: "bubbles", label: "Пузырьки", hint: "Подводный подъём" },
	{ value: "fireflies", label: "Светлячки", hint: "Плавное блуждание" },
	{ value: "rain", label: "Дождь", hint: "Косые капли" },
	{ value: "petals", label: "Лепестки", hint: "Кружатся и падают" },
	{ value: "matrix", label: "Код", hint: "Вертикальные строки символов" },
	{ value: "confetti", label: "Конфетти", hint: "Праздничные полоски" },
];

export const GROUP_FONTS: { id: string; label: string; stack: string }[] = [
	{ id: "inter", label: "Inter (базовый)", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
	{ id: "grotesk", label: "Space Grotesk", stack: "'Space Grotesk', Inter, ui-sans-serif, sans-serif" },
	{ id: "rubik", label: "Rubik", stack: "Rubik, Inter, ui-sans-serif, sans-serif" },
	{ id: "serif", label: "Антиква", stack: "'Georgia', 'Times New Roman', serif" },
	{ id: "mono", label: "Моноширинный", stack: "ui-monospace, 'JetBrains Mono', Consolas, monospace" },
	{ id: "round", label: "Круглый", stack: "'Nunito', 'Segoe UI', ui-rounded, sans-serif" },
	{ id: "system", label: "Системный", stack: "system-ui, 'Segoe UI', Roboto, sans-serif" },
];

/* ──────────────────── Значения по умолчанию ───────────────── */

function surface(partial?: Partial<GroupSurface>): GroupSurface {
	return {
		mode: "theme",
		color: "#12121c",
		from: "#1e1b4b",
		via: "#312e81",
		to: "#0f172a",
		useVia: true,
		angle: 160,
		image: "",
		fit: "cover",
		dim: 25,
		...partial,
	};
}

export const GROUP_THEME_DEFAULT: GroupTheme = {
	version: GROUP_THEME_VERSION,
	enabled: false,
	preset: "none",
	priority: true,
	chat: surface(),
	channels: surface(),
	voice: surface(),
	accent: "#7c3aed",
	useAccent: false,
	font: { mode: "theme", family: "inter", scale: 100 },
	banner: {
		kind: "none",
		url: "",
		from: "#7c3aed",
		via: "#2563eb",
		to: "#06b6d4",
		useVia: true,
		angle: 110,
		animated: true,
		overlay: 35,
	},
	particles: {
		kind: "none",
		density: 45,
		speed: 100,
		size: 3,
		color: "#ffffff",
		opacity: 35,
		interactive: false,
	},
};

export function defaultGroupTheme(): GroupTheme {
	return JSON.parse(JSON.stringify(GROUP_THEME_DEFAULT)) as GroupTheme;
}

/* ──────────────────────── Пресеты ─────────────────────── */

export interface GroupPreset {
	id: string;
	label: string;
	hint: string;
	/** Цвета для плитки выбора в редакторе. */
	swatch: [string, string, string];
	build: () => GroupTheme;
}

function preset(
	id: string,
	label: string,
	hint: string,
	swatch: [string, string, string],
	patch: (t: GroupTheme) => void,
): GroupPreset {
	return {
		id,
		label,
		hint,
		swatch,
		build: () => {
			const t = defaultGroupTheme();
			t.enabled = true;
			t.preset = id;
			patch(t);
			return t;
		},
	};
}

export const GROUP_PRESETS: GroupPreset[] = [
	preset("aurora", "Северное сияние", "Глубокий синий градиент и звёзды", ["#0b1026", "#1e3a8a", "#22d3ee"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#0b1026", via: "#152550", to: "#0b1026", angle: 165, dim: 0 });
		t.channels = surface({ mode: "gradient", from: "#080d1f", via: "#101a3a", to: "#080d1f", angle: 200, dim: 0 });
		t.voice = surface({ mode: "solid", color: "#0a1330" });
		t.accent = "#22d3ee";
		t.useAccent = true;
		t.banner = { ...t.banner, kind: "gradient", from: "#0b1026", via: "#1d4ed8", to: "#22d3ee", angle: 120, animated: true };
		t.particles = { kind: "stars", density: 55, speed: 60, size: 2, color: "#a5f3fc", opacity: 45, interactive: false };
	}),
	preset("ember", "Угли", "Тёмный графит и тёплые искры", ["#141110", "#3f1d0f", "#f97316"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#131110", via: "#1c1512", to: "#0d0b0a", angle: 180, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#100e0d" });
		t.voice = surface({ mode: "solid", color: "#171311" });
		t.accent = "#f97316";
		t.useAccent = true;
		t.banner = { ...t.banner, kind: "gradient", from: "#1c1512", via: "#7c2d12", to: "#f97316", angle: 95, animated: true };
		t.particles = { kind: "embers", density: 40, speed: 110, size: 3, color: "#fb923c", opacity: 40, interactive: false };
	}),
	preset("mint", "Мята", "Светлый минимализм без частиц", ["#f8fafc", "#ccfbf1", "#14b8a6"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#ffffff", via: "#f0fdfa", to: "#ecfeff", angle: 150, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#f8fafc" });
		t.voice = surface({ mode: "solid", color: "#f1f5f9" });
		t.accent = "#0d9488";
		t.useAccent = true;
		t.font = { mode: "builtin", family: "round", scale: 100 };
		t.banner = { ...t.banner, kind: "gradient", from: "#99f6e4", via: "#a5b4fc", to: "#fbcfe8", angle: 120, animated: false, overlay: 15 };
		t.particles = { ...t.particles, kind: "none" };
	}),
	preset("neon", "Неон", "Киберпанк и падающий код", ["#05060a", "#3b0764", "#22c55e"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#05060a", via: "#120b26", to: "#05060a", angle: 190, dim: 0 });
		t.channels = surface({ mode: "gradient", from: "#05060a", via: "#160c2e", to: "#05060a", angle: 210, dim: 0 });
		t.voice = surface({ mode: "solid", color: "#0a0713" });
		t.accent = "#22c55e";
		t.useAccent = true;
		t.font = { mode: "builtin", family: "mono", scale: 100 };
		t.banner = { ...t.banner, kind: "gradient", from: "#3b0764", via: "#7e22ce", to: "#22c55e", angle: 135, animated: true };
		t.particles = { kind: "matrix", density: 50, speed: 120, size: 12, color: "#4ade80", opacity: 30, interactive: false };
	}),
	preset("sakura", "Сакура", "Нежный розовый и лепестки", ["#1a0f16", "#831843", "#fbcfe8"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#1a0f16", via: "#2b1220", to: "#140b12", angle: 170, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#160c13" });
		t.voice = surface({ mode: "solid", color: "#1d1018" });
		t.accent = "#f472b6";
		t.useAccent = true;
		t.banner = { ...t.banner, kind: "gradient", from: "#831843", via: "#db2777", to: "#fbcfe8", angle: 105, animated: true };
		t.particles = { kind: "petals", density: 35, speed: 80, size: 5, color: "#fbcfe8", opacity: 45, interactive: true };
	}),
	preset("deepsea", "Глубина", "Подводный синий и пузырьки", ["#04121c", "#075985", "#38bdf8"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#04121c", via: "#062b3f", to: "#02090f", angle: 200, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#04141f" });
		t.voice = surface({ mode: "gradient", from: "#052437", via: "#075985", to: "#04121c", angle: 220, dim: 0 });
		t.accent = "#38bdf8";
		t.useAccent = true;
		t.banner = { ...t.banner, kind: "gradient", from: "#04121c", via: "#0369a1", to: "#38bdf8", angle: 130, animated: true };
		t.particles = { kind: "bubbles", density: 40, speed: 70, size: 4, color: "#7dd3fc", opacity: 35, interactive: true };
	}),
	preset("gold", "Золото", "Строгий чёрный с золотом", ["#0b0b0d", "#3f3418", "#f5c542"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#0b0b0d", via: "#141310", to: "#0b0b0d", angle: 180, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#0d0d0f" });
		t.voice = surface({ mode: "solid", color: "#111113" });
		t.accent = "#f5c542";
		t.useAccent = true;
		t.font = { mode: "builtin", family: "serif", scale: 100 };
		t.banner = { ...t.banner, kind: "gradient", from: "#0b0b0d", via: "#6b5518", to: "#f5c542", angle: 115, animated: false, overlay: 30 };
		t.particles = { kind: "fireflies", density: 25, speed: 60, size: 3, color: "#fde68a", opacity: 30, interactive: false };
	}),
	preset("winter", "Зима", "Серо-синий и снег", ["#0f172a", "#1e293b", "#e2e8f0"], (t) => {
		t.chat = surface({ mode: "gradient", from: "#0f172a", via: "#1e293b", to: "#0f172a", angle: 175, dim: 0 });
		t.channels = surface({ mode: "solid", color: "#111a2e" });
		t.voice = surface({ mode: "solid", color: "#16203a" });
		t.accent = "#93c5fd";
		t.useAccent = true;
		t.banner = { ...t.banner, kind: "gradient", from: "#0f172a", via: "#334155", to: "#e2e8f0", angle: 125, animated: true };
		t.particles = { kind: "snow", density: 50, speed: 70, size: 3, color: "#ffffff", opacity: 40, interactive: true };
	}),
];

/* ───────────────────── Санитайзеры и разбор ───────────────── */

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeColor(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const v = value.trim();
	return HEX.test(v) ? v.toLowerCase() : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Адрес картинки/видео. Разрешены только https и data для медиа: в CSS и в
 * атрибут src попадает чужой текст, и `javascript:` там не нужно.
 */
export function sanitizeAssetUrl(value: unknown, kinds: ("image" | "video")[] = ["image"]): string {
	if (typeof value !== "string") return "";
	const v = value.trim();
	if (!v) return "";
	if (v.length > 1_200_000) return "";
	if (/^https:\/\/[^\s"']+$/i.test(v)) return v;
	for (const kind of kinds) {
		if (new RegExp(`^data:${kind}\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$`, "i").test(v)) return v;
	}
	return "";
}

function normalizeSurface(raw: unknown, fallback: GroupSurface): GroupSurface {
	const r = (raw ?? {}) as Record<string, unknown>;
	return {
		mode: pick(r.mode, ["theme", "solid", "gradient", "image"] as const, fallback.mode),
		color: sanitizeColor(r.color, fallback.color),
		from: sanitizeColor(r.from, fallback.from),
		via: sanitizeColor(r.via, fallback.via),
		to: sanitizeColor(r.to, fallback.to),
		useVia: bool(r.useVia, fallback.useVia),
		angle: clamp(r.angle, 0, 360, fallback.angle),
		image: sanitizeAssetUrl(r.image, ["image"]),
		fit: pick(r.fit, ["cover", "contain", "tile"] as const, fallback.fit),
		dim: clamp(r.dim, 0, 85, fallback.dim),
	};
}

export function normalizeGroupTheme(raw: unknown): GroupTheme {
	const base = defaultGroupTheme();
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;
	const bannerRaw = (r.banner ?? {}) as Record<string, unknown>;
	const fontRaw = (r.font ?? {}) as Record<string, unknown>;
	const partRaw = (r.particles ?? {}) as Record<string, unknown>;
	const bannerKind = pick(bannerRaw.kind, ["none", "image", "video", "gradient"] as const, base.banner.kind);

	return {
		version: GROUP_THEME_VERSION,
		enabled: bool(r.enabled, base.enabled),
		preset: typeof r.preset === "string" && r.preset.length <= 24 ? r.preset : "custom",
		priority: bool(r.priority, base.priority),
		chat: normalizeSurface(r.chat, base.chat),
		channels: normalizeSurface(r.channels, base.channels),
		voice: normalizeSurface(r.voice, base.voice),
		accent: sanitizeColor(r.accent, base.accent),
		useAccent: bool(r.useAccent, base.useAccent),
		font: {
			mode: pick(fontRaw.mode, ["theme", "builtin"] as const, base.font.mode),
			family: GROUP_FONTS.some((f) => f.id === fontRaw.family) ? (fontRaw.family as string) : base.font.family,
			scale: clamp(fontRaw.scale, 90, 115, base.font.scale),
		},
		banner: {
			kind: bannerKind,
			url: sanitizeAssetUrl(bannerRaw.url, bannerKind === "video" ? ["video"] : ["image"]),
			from: sanitizeColor(bannerRaw.from, base.banner.from),
			via: sanitizeColor(bannerRaw.via, base.banner.via),
			to: sanitizeColor(bannerRaw.to, base.banner.to),
			useVia: bool(bannerRaw.useVia, base.banner.useVia),
			angle: clamp(bannerRaw.angle, 0, 360, base.banner.angle),
			animated: bool(bannerRaw.animated, base.banner.animated),
			overlay: clamp(bannerRaw.overlay, 0, 85, base.banner.overlay),
		},
		particles: {
			kind: pick(
				partRaw.kind,
				PARTICLE_OPTIONS.map((o) => o.value),
				base.particles.kind,
			),
			density: clamp(partRaw.density, 5, 100, base.particles.density),
			speed: clamp(partRaw.speed, 20, 200, base.particles.speed),
			size: clamp(partRaw.size, 1, 16, base.particles.size),
			color: sanitizeColor(partRaw.color, base.particles.color),
			opacity: clamp(partRaw.opacity, 5, 60, base.particles.opacity),
			interactive: bool(partRaw.interactive, base.particles.interactive),
		},
	};
}

/** Разобрать строку из `Group.theme`. Мусор и пустота дают выключенное оформление. */
export function parseGroupTheme(raw: string | null | undefined): GroupTheme {
	if (!raw || typeof raw !== "string") return defaultGroupTheme();
	if (raw.length > GROUP_THEME_MAX_JSON) return defaultGroupTheme();
	try {
		return normalizeGroupTheme(JSON.parse(raw));
	} catch {
		return defaultGroupTheme();
	}
}

export function serializeGroupTheme(theme: GroupTheme): string {
	return JSON.stringify(normalizeGroupTheme(theme));
}

export function isGroupThemeDefault(theme: GroupTheme): boolean {
	return serializeGroupTheme(theme) === serializeGroupTheme(GROUP_THEME_DEFAULT);
}

/* ─────────────────────── CSS-слои ───────────────────── */

export function hexToRgba(hex: string, alpha: number): string {
	const v = HEX.test(hex) ? hex : "#000000";
	const r = parseInt(v.slice(1, 3), 16);
	const g = parseInt(v.slice(3, 5), 16);
	const b = parseInt(v.slice(5, 7), 16);
	const a = Math.min(1, Math.max(0, alpha));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function gradientCss(from: string, via: string, to: string, useVia: boolean, angle: number): string {
	const stops = useVia ? `${from}, ${via}, ${to}` : `${from}, ${to}`;
	return `linear-gradient(${angle}deg, ${stops})`;
}

/**
 * Слой для `background-image`. Затемнение идёт ПЕРВЫМ слоем: в CSS первый слой
 * рисуется поверх остальных — та же схема, что у личных скинов.
 */
export function surfaceLayer(s: GroupSurface): string {
	if (s.mode === "theme") return "none";
	if (s.mode === "solid") return `linear-gradient(${s.color}, ${s.color})`;
	if (s.mode === "gradient") return gradientCss(s.from, s.via, s.to, s.useVia, s.angle);
	if (!s.image) return "none";
	const dim = s.dim > 0 ? `linear-gradient(${hexToRgba("#000000", s.dim / 100)}, ${hexToRgba("#000000", s.dim / 100)}), ` : "";
	return `${dim}url("${s.image}")`;
}

export function surfaceSize(s: GroupSurface): string {
	if (s.mode !== "image") return "auto";
	if (s.fit === "contain") return "contain";
	if (s.fit === "tile") return "auto";
	return "cover";
}

export function surfaceRepeat(s: GroupSurface): string {
	return s.mode === "image" && s.fit === "tile" ? "repeat" : "no-repeat";
}

export function bannerCss(b: GroupBannerCfg): string {
	if (b.kind === "gradient") return gradientCss(b.from, b.via, b.to, b.useVia, b.angle);
	if (b.kind === "image" && b.url) return `url("${b.url}")`;
	return "none";
}

export function fontStack(font: GroupFontCfg): string {
	if (font.mode !== "builtin") return "";
	return GROUP_FONTS.find((f) => f.id === font.family)?.stack ?? "";
}

/* ─────────────────── Применение к документу ──────────────── */

const VARS = [
	"--tz-group-chat-layer",
	"--tz-group-chat-size",
	"--tz-group-chat-repeat",
	"--tz-group-channels-layer",
	"--tz-group-channels-size",
	"--tz-group-channels-repeat",
	"--tz-group-voice-layer",
	"--tz-group-voice-size",
	"--tz-group-voice-repeat",
	"--tz-group-font",
	"--tz-group-font-scale",
	"--cn-accent",
	"--cn-accent-dim",
	"--cn-accent-text",
	"--cn-pill",
];

/**
 * Поставить оформление сообщества на <html>.
 *
 * Атрибуты `data-tz-group` и `data-tz-group-font` включают правила в globals.css.
 * Переменные без атрибута ничего не меняют — это важно при выходе из группы:
 * чистим одним снятием атрибута, а не перебором десятков свойств.
 */
export function applyGroupTheme(theme: GroupTheme | null): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;

	if (!theme || !theme.enabled) {
		clearGroupTheme();
		return;
	}

	root.dataset.tzGroup = "on";
	root.dataset.tzGroupPriority = theme.priority ? "on" : "off";

	const surfaces: [string, GroupSurface][] = [
		["chat", theme.chat],
		["channels", theme.channels],
		["voice", theme.voice],
	];
	for (const [name, s] of surfaces) {
		root.style.setProperty(`--tz-group-${name}-layer`, surfaceLayer(s));
		root.style.setProperty(`--tz-group-${name}-size`, surfaceSize(s));
		root.style.setProperty(`--tz-group-${name}-repeat`, surfaceRepeat(s));
	}

	if (theme.useAccent) {
		root.style.setProperty("--cn-accent", theme.accent);
		root.style.setProperty("--cn-accent-dim", hexToRgba(theme.accent, 0.12));
		root.style.setProperty("--cn-accent-text", theme.accent);
		root.style.setProperty("--cn-pill", theme.accent);
	} else {
		for (const name of ["--cn-accent", "--cn-accent-dim", "--cn-accent-text", "--cn-pill"]) root.style.removeProperty(name);
	}

	const stack = fontStack(theme.font);
	if (stack) {
		root.style.setProperty("--tz-group-font", stack);
		root.dataset.tzGroupFont = "on";
	} else {
		root.style.removeProperty("--tz-group-font");
		delete root.dataset.tzGroupFont;
	}
	root.style.setProperty("--tz-group-font-scale", `${theme.font.scale / 100}`);
}

export function clearGroupTheme(): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	for (const name of VARS) root.style.removeProperty(name);
	delete root.dataset.tzGroup;
	delete root.dataset.tzGroupFont;
	delete root.dataset.tzGroupPriority;
}
