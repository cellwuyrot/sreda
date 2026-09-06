/**
 * Block types and default data for the /about page CMS.
 * Each block is stored in the AboutBlock Prisma table (JSON in `data` field).
 */

export type BlockType =
  | "hero"
  | "video"
  | "stats"
  | "gallery"
  | "bento"
  | "timeline"
  | "team"
  | "cta"
  | "apps";

export interface AboutBlockRow {
  id: string;
  type: BlockType;
  position: number;
  data: unknown;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Block data shapes ────────────────────────────────────────────────────────

export interface HeroData {
  badge?: string;
  title: string;
  subtitle?: string;
  description?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; action?: string; href?: string };
  /** Загруженный фон обложки (файл из /uploads/about/), а не внешняя ссылка. */
  bgUrl?: string;
  bgType?: "image" | "video";
}

export interface VideoData {
  /** Загруженный видеофайл из /uploads/about/. */
  url?: string;
  /** Резервный вариант: идентификатор ролика на YouTube. */
  youtubeId?: string;
  /** Загруженная обложка ролика. */
  posterUrl?: string;
  title?: string;
  duration?: string;
  tag?: string;
}

export interface StatsItem {
  label: string;
  value: string;
}
export interface StatsData {
  items: StatsItem[];
}

export interface GalleryItem {
  id: string;
  mediaType: "image" | "gif" | "video";
  url: string;
  caption?: string;
  tag?: string;
  isGif?: boolean;
}
export interface GalleryData {
  title?: string;
  subtitle?: string;
  items: GalleryItem[];
}

export interface BentoItem {
  key: string;
  icon: string;
  /** Загруженная картинка карточки — показывается вместо эмодзи. */
  imageUrl?: string;
  title: string;
  description: string;
  color: string;
  href?: string;
  wide?: boolean;
}
export interface BentoData {
  title?: string;
  subtitle?: string;
  items: BentoItem[];
}

export interface TimelineItem {
  year: string;
  title: string;
  description?: string;
  color?: string;
  current?: boolean;
}
export interface TimelineData {
  title?: string;
  items: TimelineItem[];
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  emoji?: string;
  avatarUrl?: string;
  color?: string;
}
export interface TeamData {
  title?: string;
  members: TeamMember[];
  joinLabel?: string;
  joinHref?: string;
}

export interface CtaData {
  title: string;
  subtitle?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

// ─── Apps block ───────────────────────────────────────────────────────────────

export type AppPlatform = "android" | "windows" | "macos" | "linux";

export interface AppItem {
  id: string;
  platform: AppPlatform;
  name: string;
  version: string;
  description?: string;
  /** Relative URL served from /uploads/apps/ */
  fileUrl?: string;
  fileName?: string;
  /** File size in bytes */
  fileSize?: number;
  active: boolean;
}

export interface AppsData {
  title?: string;
  subtitle?: string;
  items: AppItem[];
}

// ─── Unified type map ─────────────────────────────────────────────────────────

type BlockDataMap = {
  hero: HeroData;
  video: VideoData;
  stats: StatsData;
  gallery: GalleryData;
  bento: BentoData;
  timeline: TimelineData;
  team: TeamData;
  cta: CtaData;
  apps: AppsData;
};

export const BLOCK_DEFAULTS: BlockDataMap = {
  hero: {
    badge: "Платформа открыта",
    title: "TRIOZ",
    subtitle: "Экосистема проектов",
    description:
      "Игры, общение, творчество и знания — всё в одном пространстве.",
    primaryCta: { label: "Начать", href: "/connect" },
    secondaryCta: { label: "Смотреть видео", action: "video" },
  },

  video: {
    url: "",
    youtubeId: "",
    title: "Трейлер платформы",
    duration: "0:00",
    tag: "Трейлер",
  },

  stats: {
    items: [
      { label: "раздела платформы", value: "4" },
      { label: "участников", value: "1 200+" },
      { label: "активных игр", value: "3" },
      { label: "материалов в библиотеке", value: "500+" },
      { label: "год основания", value: "2022" },
    ],
  },

  gallery: {
    title: "Внутри платформы",
    subtitle: "Скриншоты, трейлеры и арты",
    items: [],
  },

  bento: {
    title: "Что внутри TRIOZ",
    subtitle: "Четыре направления — одна экосистема",
    items: [
      {
        key: "connect",
        icon: "💬",
        title: "TZ.Connect",
        description: "Коммуникационная платформа нового поколения.",
        color: "#6366f1",
        href: "/connect",
        wide: true,
      },
      {
        key: "games",
        icon: "🎮",
        title: "TZ.Games",
        description: "Стратегические онлайн-игры.",
        color: "#ef4444",
        href: "/games",
      },
      {
        key: "library",
        icon: "📚",
        title: "TZ.Library",
        description: "Библиотека знаний и лора.",
        color: "#10b981",
        href: "/library",
      },
      {
        key: "pero",
        icon: "✏️",
        title: "TZ.Pero",
        description: "Творческая мастерская.",
        color: "#8b5cf6",
        href: "/pero",
      },
      {
        key: "projects",
        icon: "🏗️",
        title: "TZ.Projects",
        description: "Витрина проектов.",
        color: "#f59e0b",
        href: "/projects",
      },
    ],
  },

  timeline: {
    title: "Путь TRIOZ",
    items: [
      {
        year: "2022",
        title: "Основание проекта",
        description: "Первая идея и прототип.",
        color: "#6366f1",
      },
      {
        year: "2023",
        title: "TZ.Connect — запуск",
        description: "Мессенджер с каналами.",
        color: "#8b5cf6",
      },
      {
        year: "2024",
        title: "Библиотека и творчество",
        description: "TZ.Library и TZ.Pero.",
        color: "#06b6d4",
      },
      {
        year: "2025",
        title: "Новый этап",
        description: "Полный редизайн, новые игры.",
        color: "#6366f1",
        current: true,
      },
    ],
  },

  team: {
    title: "Кто создаёт TRIOZ",
    members: [
      {
        id: "1",
        name: "Основатель",
        role: "Идея · Разработка",
        emoji: "👤",
        color: "#6366f1",
      },
    ],
    joinLabel: "Присоединиться",
    joinHref: "/connect",
  },

  cta: {
    title: "Станьте частью TRIOZ",
    subtitle: "Присоединяйтесь уже сегодня",
    primaryCta: { label: "Зарегистрироваться", href: "/auth/signin" },
    secondaryCta: { label: "Подробнее", href: "/projects" },
  },

  apps: {
    title: "Приложения TRIOZ",
    subtitle:
      "Установите нативное приложение TZ.Connect — быстрый запуск, системные уведомления и звонки.",
    items: [],
  },
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "🦸 Hero-секция",
  video: "🎬 Видео / трейлер",
  stats: "📊 Статистика",
  gallery: "🖼 Медиа-галерея",
  bento: "🃏 Карточки разделов",
  timeline: "📅 История проекта",
  team: "👥 Команда",
  cta: "⚡ CTA-блок",
  apps: "📱 Приложения",
};

/* Единый список CMS-блоков страницы /about. Правовая информация
   не является CMS-блоком и выводится системно внизу страницы. */
export const BLOCK_TYPES: BlockType[] = [
  "hero",
  "video",
  "stats",
  "gallery",
  "bento",
  "timeline",
  "team",
  "cta",
  "apps",
];
