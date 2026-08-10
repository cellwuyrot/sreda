import type { SVGProps } from "react";

/*
 * TZ.Connect — монохромные (ЧБ) векторные иконки разделов-блоков.
 *
 * Раньше плитки разделов использовали цветные глянцевые PNG (/icons/block-*.png).
 * По просьбе (и замечанию в чате: «svg как раз лучше») заменены на контурные
 * SVG в едином стиле ConnectIcons: 24×24, stroke = currentColor, толщина 1.8.
 * Цвет наследуется от текста (currentColor), поэтому иконки всегда чёрно-белые
 * и совпадают с темой — без растровых артефактов и «лагов от векторной».
 *
 * Ключи совпадают с прежними именами PNG, чтобы сопоставление по названию
 * раздела и пул иконок в настройках блока не пришлось переписывать.
 */

export type BlockIconKey =
  | "ai"
  | "systems"
  | "cloud"
  | "maintain"
  | "announce"
  | "ads"
  | "create"
  | "support"
  | "telegram"
  | "honest"
  | "crm"
  | "generic";

interface BlockIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: BlockIconKey;
  size?: number;
}

/* Порядок и подписи для пула выбора иконки в настройках блока. */
export const BLOCK_ICON_POOL: { key: BlockIconKey; label: string }[] = [
  { key: "ai", label: "ИИ" },
  { key: "systems", label: "Системы" },
  { key: "cloud", label: "Облако" },
  { key: "maintain", label: "Обслуживание" },
  { key: "announce", label: "Объявления" },
  { key: "ads", label: "Реклама" },
  { key: "create", label: "Разработка" },
  { key: "support", label: "Поддержка" },
  { key: "telegram", label: "Телеграм" },
  { key: "honest", label: "Честный знак" },
  { key: "crm", label: "CRM" },
  { key: "generic", label: "Раздел" },
];

/* Сопоставление ключа по названию раздела (перенесено из SectionsPanel).
 *
 * Порядок значим: список обходится сверху вниз до первого совпадения, поэтому
 * узкое слово должно стоять раньше широкого. «CRM-система» содержит и «crm», и
 * «систем» — пока «систем» стояла выше, такой раздел получал значок «Системы».
 *
 * Совпадение ищется подстрокой, а не по началу слова, и на этом ловится вторая
 * ошибка: «облач» не входит в «облако» («облак» ≠ «облач»), поэтому раздел с
 * названием «Облако» оставался без значка вовсе. Ключ укорочен до общей части. */
const KEYWORDS: { kw: string[]; key: BlockIconKey }[] = [
  { kw: ["ии", "помощник", "ai", "нейрос"], key: "ai" },
  { kw: ["crm", "интеграц"], key: "crm" },
  { kw: ["настройк систем", "настройка систем", "систем"], key: "systems" },
  { kw: ["облак", "облач", "хранил", "cloud"], key: "cloud" },
  { kw: ["обслуж", "баг"], key: "maintain" },
  { kw: ["объявл"], key: "announce" },
  { kw: ["реклам", "кампан"], key: "ads" },
  { kw: ["создан сайт", "создание сайт", "разработк"], key: "create" },
  { kw: ["сопровожд", "tz.ent", "tzent", "поддержк"], key: "support" },
  { kw: ["телеграм", "telegram", "бот"], key: "telegram" },
  { kw: ["честн", "знак"], key: "honest" },
];

/** Ключ иконки по названию раздела, либо null, если явного совпадения нет. */
export function blockIconKeyForName(name: string): BlockIconKey | null {
  const n = (name || "").toLowerCase();
  for (const it of KEYWORDS) {
    if (it.kw.some((k) => n.includes(k))) return it.key;
  }
  return null;
}

/** true, если строка — валидный ключ иконки (для кастомного block.icon). */
export function isBlockIconKey(v: unknown): v is BlockIconKey {
  return typeof v === "string" && BLOCK_ICON_POOL.some((p) => p.key === v);
}

const PATHS: Record<BlockIconKey, React.ReactNode> = {
  // Робот-помощник
  ai: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 5v3" />
      <circle cx="12" cy="4" r="1" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="M9.5 15.5c.7.6 1.6.9 2.5.9s1.8-.3 2.5-.9" />
      <path d="M5 12H3.5M19 12h1.5" />
    </>
  ),
  // Ползунки настроек
  systems: (
    <>
      <path d="M4 7h10M18 7h2" />
      <path d="M4 12h4M12 12h8" />
      <path d="M4 17h12M20 17h0" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="17" r="2" />
    </>
  ),
  // Облако со стрелкой вверх
  cloud: (
    <>
      <path d="M7 18h9a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6 9.5 3.75 3.75 0 0 0 7 18Z" />
      <path d="M11.5 15.5v-4M11.5 11.5 10 13M11.5 11.5 13 13" />
    </>
  ),
  // Гаечный ключ (обслуживание / баг-репорт)
  maintain: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.3-.6-.6-2.3 2.3-2.5Z" />
    </>
  ),
  // Мегафон / объявления
  announce: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1Z" />
      <path d="M17.5 9a3.5 3.5 0 0 1 0 6" />
      <path d="M8 15v3.5" />
    </>
  ),
  // Мишень (реклама / кампании)
  ads: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Код </> (создание сайтов / разработка)
  create: (
    <>
      <path d="M9 8l-4 4 4 4" />
      <path d="M15 8l4 4-4 4" />
      <path d="M13 6l-2 12" />
    </>
  ),
  // Гарнитура (сопровождение / поддержка)
  support: (
    <>
      <path d="M5 13v-1a7 7 0 0 1 14 0v1" />
      <rect x="3.5" y="13" width="3.5" height="5" rx="1.2" />
      <rect x="17" y="13" width="3.5" height="5" rx="1.2" />
      <path d="M19 18v.5a2.5 2.5 0 0 1-2.5 2.5H13" />
    </>
  ),
  // Бумажный самолётик (телеграм / боты)
  telegram: (
    <>
      <path d="M21 5 3 12l6 2 2 6 3-4 4 3 3-14Z" />
      <path d="M9 14l8-7" />
    </>
  ),
  // QR-код (честный знак)
  honest: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <path d="M14 14h3v3M20 14v.01M14 20h.01M20 20v-3M17 20h.01" />
    </>
  ),
  // База данных / CRM
  crm: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" />
    </>
  ),
  // Универсальная плитка-раздел
  generic: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
};

export default function BlockIcon({ name, size = 22, ...props }: BlockIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name] ?? PATHS.generic}
    </svg>
  );
}
