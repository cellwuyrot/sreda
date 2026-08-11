/**
 * PREMIUM-SKIN: свободная кастомизация оболочки для Premium-подписчиков.
 *
 * ── Зачем отдельный модуль, а не ещё одна тема ────────────────────────
 *
 * Темы (dark / light / mono / mono-lite) — это готовые пресеты: набор
 * переменных --cn-*, записанный в globals.css и переключаемый классом на
 * <html>. Здесь задача ровно обратная: человек сам выбирает цвета, фон и
 * шрифт, поэтому значения нельзя зашить в CSS заранее — они ставятся на
 * корень документа в рантайме поверх темы. Поэтому кастомизация и тема
 * не конфликтуют: тема задаёт базу, кастомизация — точечные поправки к ней,
 * и любую из них можно снять, не трогая остальные.
 *
 * ── Почему фон — через background-image, а не через слой-псевдоэлемент ───
 *
 * Очевидное решение — ::before на всю область и картинка в нём. В ленте
 * сообщений это ломается: там уже выстроена своя лестница z-index (шапка,
 * панель ответа, тулбар при наведении, выпадающие меню), и новый слой
 * неизбежно оказывается то поверх сообщений, то под фоном панели. Поэтому
 * фон кладётся свойством background-image на сам контейнер, а затемнение —
 * первым слоем того же свойства (linear-gradient поверх url). Ни одного
 * нового узла в разметке и ни одного нового z-index.
 *
 * ── Где хранится ───────────────────────────────────────────────
 *
 * В localStorage, как и кастомизация чата (lib/chatAppearance.ts). Это свойство
 * устройства: на телефоне и на широком мониторе уместны разные фоны, а
 * тяжёлая картинка на мобильном трафике нужна не всегда. Серверу знать
 * об этом нечего: чужой внешний вид никто кроме владельца не видит.
 *
 * ── Безопасность ────────────────────────────────────────────
 *
 * Всё, что попадает в CSS, проходит через санитайзеры ниже: цвет — только
 * #rrggbb, адрес картинки — только /uploads/… или https://… без кавычек и
 * скобок, имя шрифта — только буквы, цифры, пробел и дефис. Иначе строка
 * вида `red; background: url(javascript:…)` вышла бы из своего значения и стала
 * отдельным правилом. Сам пользователь себя не атакует, но localStorage
 * правится руками и переживает смену аккаунта на общем компьютере.
 */

/* ───────────────────────── Типы ─────────────────────────────── */

/** Чем залита область: ничем (тема), ровным цветом или картинкой. */
export type SkinBackgroundMode = "none" | "color" | "image";

/** Как раскладывается картинка. */
export type SkinFit = "cover" | "contain" | "tile";

export interface SkinBackground {
  mode: SkinBackgroundMode;
  /** #rrggbb — для режима «цвет». */
  color: string;
  /** Адрес картинки: /uploads/… после загрузки или внешний https://… */
  imageUrl: string;
  fit: SkinFit;
  /** Затемнение картинки, %. Без него текст на светлом фото нечитаем. */
  dim: number;
}

/** Цвета областей /connect. Каждое поле — одна переменная --cn-*. */
export interface SkinPalette {
  enabled: boolean;
  /** Узкая левая полоса с сообществами. */
  rail: string;
  /** Колонка каналов и диалогов. */
  sidebar: string;
  /** Основное полотно. */
  main: string;
  /** Линии разделителей. */
  border: string;
  /** Акцент: активные пункты, кнопки, подсветка. */
  accent: string;
  /** Основной цвет текста. */
  text: string;
  /** Второстепенный текст: время, подписи, подсказки. */
  muted: string;
}

/** Откуда берётся шрифт интерфейса. */
export type SkinFontMode = "theme" | "builtin" | "custom";

export interface SkinFont {
  mode: SkinFontMode;
  /** id из BUILTIN_FONTS. */
  builtin: string;
  /** Имя семейства для своего шрифта (и для local(), и для @font-face). */
  customName: string;
  /** Адрес файла шрифта; пусто — берём только установленный в системе. */
  customUrl: string;
}

export interface PremiumSkin {
  /** Общий выключатель: снять всё сразу, не теряя настроенное. */
  enabled: boolean;
  /** Фон ленты сообщений — и в каналах, и в личных. */
  chat: SkinBackground;
  palette: SkinPalette;
  font: SkinFont;
}

/* ──────────────────── Справочники и умолчания ─────────────────── */

export const SKIN_STORAGE_KEY = "tz-premium-skin";

/** Событие о смене оформления в этой же вкладке. */
export const PREMIUM_SKIN_EVENT = "tz-premium-skin-change";

/** id элемента <style>, в который кладётся @font-face своего шрифта. */
const FONT_STYLE_ID = "tz-skin-font-face";

/**
 * Готовые семейства. Все стеки — из шрифтов, которые уже есть в системе
 * или уже загружены проектом (Inter и Playfair подключены в layout.tsx).
 * Ничего не тянется по сети ради одного пункта списка.
 */
export const BUILTIN_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "inter", label: "Inter", stack: "var(--font-inter), Inter, system-ui, sans-serif" },
  { id: "system", label: "Системный", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "playfair", label: "Playfair", stack: "var(--font-playfair), 'Playfair Display', Georgia, serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "mono", label: "Моноширинный", stack: "ui-monospace, SFMono-Regular, 'JetBrains Mono', Consolas, monospace" },
];

export const FIT_OPTIONS: { value: SkinFit; label: string }[] = [
  { value: "cover", label: "Заполнить" },
  { value: "contain", label: "Целиком" },
  { value: "tile", label: "Плиткой" },
];

export const BACKGROUND_MODE_OPTIONS: { value: SkinBackgroundMode; label: string }[] = [
  { value: "none", label: "Как в теме" },
  { value: "color", label: "Цвет" },
  { value: "image", label: "Картинка" },
];

/**
 * Области палитры в том же порядке, в каком они идут на экране слева
 * направо. Отсюда же строится форма в настройках — чтобы добавление
 * области не требовало правок в двух местах.
 */
export const PALETTE_FIELDS: {
  key: keyof Omit<SkinPalette, "enabled">;
  label: string;
  hint: string;
}[] = [
  { key: "rail", label: "Левая полоса", hint: "Узкая колонка со значками сообществ и разделов." },
  { key: "sidebar", label: "Список каналов", hint: "Вторая колонка: каналы, диалоги, друзья." },
  { key: "main", label: "Полотно", hint: "Основная область: переписка и экраны разделов." },
  { key: "border", label: "Разделители", hint: "Линии между колонками, шапкой и полем ввода." },
  { key: "accent", label: "Акцент", hint: "Активный канал, кнопки, подсветка и счётчики." },
  { key: "text", label: "Цвет шрифта", hint: "Основной текст интерфейса и сообщений." },
  { key: "muted", label: "Второстепенный текст", hint: "Время, подписи, подсказки и подсказки полей." },
];

/**
 * Умолчания повторяют тёмную тему — чтобы человек, включив палитру,
 * увидел привычный экран и правил его, а не собирал цвета с нуля.
 */
export const PREMIUM_SKIN_DEFAULT: PremiumSkin = {
  enabled: false,
  chat: { mode: "none", color: "#12121c", imageUrl: "", fit: "cover", dim: 35 },
  palette: {
    enabled: false,
    rail: "#070709",
    sidebar: "#0f0f17",
    main: "#12121c",
    border: "#1d2733",
    accent: "#00d4ff",
    text: "#e8eaf0",
    muted: "#8b93a3",
  },
  font: { mode: "theme", builtin: "inter", customName: "", customUrl: "" },
};

/* ────────────────────── Санитайзеры значений ──────────────────── */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Цвет — только #rrggbb. Всё остальное заменяется значением по умолчанию. */
export function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/**
 * Адрес картинки или шрифта. Разрешены только свой /uploads/… и внешний
 * https://… без символов, которыми можно закрыть url(…) и дописать своё правило.
 */
export function sanitizeAssetUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url) return "";
  if (url.length > 500) return "";
  if (/["'()\\\s<>]/.test(url)) return "";
  if (url.startsWith("/uploads/")) return url;
  if (url.startsWith("https://")) return url;
  return "";
}

/** Имя шрифта: буквы, цифры, пробел и дефис — этого хватает любому семейству. */
export function sanitizeFontName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/[^\p{L}\p{N} \-]/gu, "");
  return name.slice(0, 60);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeBackground(raw: unknown, d: SkinBackground): SkinBackground {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof SkinBackground, unknown>>;
  return {
    mode: oneOf(input.mode, ["none", "color", "image"] as const, d.mode),
    color: sanitizeColor(input.color, d.color),
    imageUrl: sanitizeAssetUrl(input.imageUrl),
    fit: oneOf(input.fit, ["cover", "contain", "tile"] as const, d.fit),
    dim: clamp(Math.round(typeof input.dim === "number" ? input.dim : d.dim), 0, 85),
  };
}

/**
 * Приводит что угодно к валидному оформлению. В localStorage может лежать
 * старая версия без половины полей — недостающее берётся из умолчаний.
 */
export function normalizePremiumSkin(raw: unknown): PremiumSkin {
  const d = PREMIUM_SKIN_DEFAULT;
  if (!raw || typeof raw !== "object") return structuredCopy(d);
  const input = raw as Partial<Record<keyof PremiumSkin, unknown>>;
  const paletteInput = (input.palette && typeof input.palette === "object" ? input.palette : {}) as Partial<
    Record<keyof SkinPalette, unknown>
  >;
  const fontInput = (input.font && typeof input.font === "object" ? input.font : {}) as Partial<
    Record<keyof SkinFont, unknown>
  >;

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : d.enabled,
    chat: normalizeBackground(input.chat, d.chat),
    palette: {
      enabled: typeof paletteInput.enabled === "boolean" ? paletteInput.enabled : d.palette.enabled,
      rail: sanitizeColor(paletteInput.rail, d.palette.rail),
      sidebar: sanitizeColor(paletteInput.sidebar, d.palette.sidebar),
      main: sanitizeColor(paletteInput.main, d.palette.main),
      border: sanitizeColor(paletteInput.border, d.palette.border),
      accent: sanitizeColor(paletteInput.accent, d.palette.accent),
      text: sanitizeColor(paletteInput.text, d.palette.text),
      muted: sanitizeColor(paletteInput.muted, d.palette.muted),
    },
    font: {
      mode: oneOf(fontInput.mode, ["theme", "builtin", "custom"] as const, d.font.mode),
      builtin: BUILTIN_FONTS.some((f) => f.id === fontInput.builtin) ? String(fontInput.builtin) : d.font.builtin,
      customName: sanitizeFontName(fontInput.customName),
      customUrl: sanitizeAssetUrl(fontInput.customUrl),
    },
  };
}

/** Копия без общих ссылок: умолчания не должны меняться из формы. */
function structuredCopy(skin: PremiumSkin): PremiumSkin {
  return {
    enabled: skin.enabled,
    chat: { ...skin.chat },
    palette: { ...skin.palette },
    font: { ...skin.font },
  };
}

export function defaultPremiumSkin(): PremiumSkin {
  return structuredCopy(PREMIUM_SKIN_DEFAULT);
}

/* ──────────────────────── Сборка значений для CSS ────────────────── */

/** #rrggbb + прозрачность → rgba(). Нужно для производных от акцента цветов. */
export function hexToRgba(hex: string, alpha: number): string {
  const safe = HEX_RE.test(hex) ? hex : "#000000";
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Сл��й background-image для области.
 *
 * Затемнение идёт первым слоем того же свойства, а не отдельным элементом:
 * в CSS первый слой рисуется поверх остальных, так что полупрозрачный
 * градиент гасит картинку без единого лишнего узла в DOM.
 */
export function backgroundLayer(bg: SkinBackground): string {
  if (bg.mode === "color") {
    const c = sanitizeColor(bg.color, "#000000");
    return `linear-gradient(${c}, ${c})`;
  }
  if (bg.mode === "image") {
    const url = sanitizeAssetUrl(bg.imageUrl);
    if (!url) return "none";
    const dim = clamp(bg.dim, 0, 85) / 100;
    const shade = `rgba(0, 0, 0, ${dim})`;
    return `linear-gradient(${shade}, ${shade}), url("${url}")`;
  }
  return "none";
}

export function backgroundSize(bg: SkinBackground): string {
  if (bg.mode !== "image") return "auto";
  if (bg.fit === "contain") return "contain";
  if (bg.fit === "tile") return "auto";
  return "cover";
}

export function backgroundRepeat(bg: SkinBackground): string {
  return bg.mode === "image" && bg.fit === "tile" ? "repeat" : "no-repeat";
}

/** Итоговый стек шрифта; пустая строка — шрифт темы без изменений. */
export function fontStack(font: SkinFont): string {
  if (font.mode === "builtin") {
    return BUILTIN_FONTS.find((f) => f.id === font.builtin)?.stack ?? "";
  }
  if (font.mode === "custom") {
    const name = sanitizeFontName(font.customName);
    if (!name) return "";
    return `"${name}", var(--font-inter), system-ui, sans-serif`;
  }
  return "";
}

/** Формат файла шрифта для @font-face — браузеру легче с явной подсказкой. */
function fontFormat(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".woff2")) return "woff2";
  if (lower.endsWith(".woff")) return "woff";
  if (lower.endsWith(".ttf")) return "truetype";
  if (lower.endsWith(".otf")) return "opentype";
  return "";
}

/**
 * Правило @font-face для своего шрифта.
 *
 * local() стоит первым: если шрифт уже установлен в системе, качать его не
 * надо вовсе, и адрес файла тогда необязателен.
 */
export function fontFaceRule(font: SkinFont): string {
  if (font.mode !== "custom") return "";
  const name = sanitizeFontName(font.customName);
  if (!name) return "";
  const url = sanitizeAssetUrl(font.customUrl);
  const sources = [`local("${name}")`];
  if (url) {
    const format = fontFormat(url);
    sources.push(format ? `url("${url}") format("${format}")` : `url("${url}")`);
  }
  return `@font-face { font-family: "${name}"; src: ${sources.join(", ")}; font-display: swap; }`;
}

/* ──────────────────── Применение к документу ──────────────────── */

/** Переменные темы, которые перекрывает палитра. Снятие — по этому же списку. */
const PALETTE_VARS = [
  "--cn-rail",
  "--cn-sidebar",
  "--cn-main",
  "--cn-border",
  "--cn-accent",
  "--cn-accent-dim",
  "--cn-accent-text",
  "--cn-pill",
  "--cn-text",
  "--cn-muted",
  "--cn-hover",
];

const SKIN_VARS = [
  "--tz-skin-chat-layer",
  "--tz-skin-chat-size",
  "--tz-skin-chat-repeat",
  "--tz-skin-font",
];

/**
 * Ставит оформление на корень документа.
 *
 * Инлайн-стиль на <html> сильнее любого :root из таблицы стилей, поэтому
 * палитра ложится поверх текущей темы без каких-либо !important.
 */
export function applyPremiumSkin(skin: PremiumSkin): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const on = skin.enabled;

  /* Выключено — снимаем всё, что ставили, и возвращаем чистую тему. */
  if (!on) {
    for (const name of [...PALETTE_VARS, ...SKIN_VARS]) root.style.removeProperty(name);
    delete root.dataset.tzSkin;
    delete root.dataset.tzSkinFont;
    document.getElementById(FONT_STYLE_ID)?.remove();
    return;
  }

  root.dataset.tzSkin = "on";

  /* Фон ленты сообщений. */
  root.style.setProperty("--tz-skin-chat-layer", backgroundLayer(skin.chat));
  root.style.setProperty("--tz-skin-chat-size", backgroundSize(skin.chat));
  root.style.setProperty("--tz-skin-chat-repeat", backgroundRepeat(skin.chat));

  /* Палитра. Производные от акцента считаются, а не спрашиваются: просить
     человека подобрать ещё три почти одинаковых оттенка — верный способ
     получить несогласованный интерфейс. */
  if (skin.palette.enabled) {
    const p = skin.palette;
    root.style.setProperty("--cn-rail", p.rail);
    root.style.setProperty("--cn-sidebar", p.sidebar);
    root.style.setProperty("--cn-main", p.main);
    root.style.setProperty("--cn-border", p.border);
    root.style.setProperty("--cn-accent", p.accent);
    root.style.setProperty("--cn-accent-dim", hexToRgba(p.accent, 0.12));
    root.style.setProperty("--cn-accent-text", p.accent);
    root.style.setProperty("--cn-pill", p.accent);
    root.style.setProperty("--cn-text", p.text);
    root.style.setProperty("--cn-muted", p.muted);
    root.style.setProperty("--cn-hover", hexToRgba(p.text, 0.06));
  } else {
    for (const name of PALETTE_VARS) root.style.removeProperty(name);
  }

  /* Шрифт. Атрибут, а не переменная-выключатель: правило в globals.css должно
     существовать только при выбранном шрифте, иначе оно перебивало бы
     шрифт темы пустым значением. */
  const stack = fontStack(skin.font);
  if (stack) {
    root.style.setProperty("--tz-skin-font", stack);
    root.dataset.tzSkinFont = "on";
  } else {
    root.style.removeProperty("--tz-skin-font");
    delete root.dataset.tzSkinFont;
  }

  const face = fontFaceRule(skin.font);
  const existing = document.getElementById(FONT_STYLE_ID);
  if (!face) {
    existing?.remove();
  } else {
    const el = existing ?? document.createElement("style");
    el.id = FONT_STYLE_ID;
    if (el.textContent !== face) el.textContent = face;
    if (!existing) document.head.appendChild(el);
  }
}

/* ─────────────────────────── Хранилище ────────────────────────── */

export function loadPremiumSkin(): PremiumSkin {
  if (typeof window === "undefined") return defaultPremiumSkin();
  try {
    const stored = window.localStorage.getItem(SKIN_STORAGE_KEY);
    if (!stored) return defaultPremiumSkin();
    return normalizePremiumSkin(JSON.parse(stored));
  } catch {
    return defaultPremiumSkin();
  }
}

export function savePremiumSkin(skin: PremiumSkin): PremiumSkin {
  const normalized = normalizePremiumSkin(skin);
  applyPremiumSkin(normalized);
  if (typeof window === "undefined") return normalized;
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* Приватный режим или переполненное хранилище — оформление уже применено. */
  }
  window.dispatchEvent(new CustomEvent(PREMIUM_SKIN_EVENT, { detail: normalized }));
  return normalized;
}

/**
 * Снять оформление с экрана, не трогая сохранённое.
 *
 * Нужно ровно для одного случая: подписка закончилась. Настройки при этом
 * остаются в localStorage и вернутся сами после продления — заставлять человека
 * заново подбирать семь цветов было бы наказанием.
 */
export function suspendPremiumSkin(): void {
  applyPremiumSkin({ ...defaultPremiumSkin(), enabled: false });
}

/** Есть ли хоть одно отличие от умолчаний — для кнопки «Сбросить». */
export function isPremiumSkinDefault(skin: PremiumSkin): boolean {
  return JSON.stringify(normalizePremiumSkin(skin)) === JSON.stringify(PREMIUM_SKIN_DEFAULT);
}
