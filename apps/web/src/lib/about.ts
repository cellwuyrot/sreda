/**
 * Shared definition of the /about ("О проекте") page content.
 *
 * Both the public page (`/about`) and the admin editor (`/admin/about`) read
 * from this single source of truth so their content keys never drift apart.
 *
 * Editable copy is persisted through the generic site-content store
 * (`/api/site-content`, keys prefixed with `content:` in the DB). Each editable
 * string has a stable `contentKey`; the values below are the fallback defaults
 * shown when an admin has not overridden them yet.
 */

export interface AboutSection {
  /** Stable slug used to build content keys and React keys. */
  key: string;
  /** Default heading for the ecosystem block. */
  title: string;
  /** Default description shown under the heading. */
  description: string;
  /** Accent colour (hex) that themes the block's glow, icon and links. */
  color: string;
  /** Destination route for the block. */
  href: string;
}

/** The four ecosystem pillars featured on the About page. */
export const ABOUT_SECTIONS: AboutSection[] = [
  {
    key: "trioz",
    title: 'Проекты Т.Р.И.О."Z"',
    description:
      "Глобальная MMORPG с элементами стратегии, полной социальной сферой и бесконечным миром для исследования. Мир тёмного фэнтези с уникальной лор-системой.",
    color: "#ff4444",
    href: "/projects",
  },
  {
    key: "pero",
    title: "Перо Измерений",
    description:
      "Развлекательные товары направленные на развитие мышления — от книг до уникальных настольных игр. Погружение в лор вселенной через физические носители.",
    color: "#8b5cf6",
    href: "/pero",
  },
  {
    key: "connect",
    title: "TZ.Connect",
    description:
      "Коммуникационная платформа и комплексные IT-решения для современного бизнеса. Мессенджер, голосовая связь, IT-услуги.",
    color: "#00f0ff",
    href: "/connect",
  },
  {
    key: "library",
    title: "TZ.Library",
    description:
      "Хранилище знаний и лора вселенной — от древних легенд до новейших открытий. Вики, база знаний, история мира.",
    color: "#10b981",
    href: "/library",
  },
];

/** Default copy for the standalone (non-repeating) pieces of the page. */
export const ABOUT_DEFAULTS = {
  eyebrow: "Экосистема",
  title: "TrioZ",
  subtitle:
    "Масштабная экосистема проектов в стиле dark fantasy и cyberpunk. Один мир. Множество измерений. Игры, книги, коммуникации, технологии.",
  footer: "© 2024 T.Р.И.О.Z — Экосистема проектов",
};

/** Content-key helpers — keep the string layout in one place. */
export const aboutKeys = {
  eyebrow: "about.eyebrow",
  title: "about.title",
  subtitle: "about.subtitle",
  footer: "about.footer",
  /** Heading of an ecosystem block. */
  sectionTitle: (key: string) => `about.section.${key}.title`,
  /**
   * Description of an ecosystem block. Kept as the bare `about.section.<key>`
   * for backwards compatibility with content saved before titles were editable.
   */
  sectionDesc: (key: string) => `about.section.${key}`,
};
