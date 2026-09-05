/**
 * Типы и дефолтные данные для блоков страницы /about.
 * Каждый блок хранится в таблице AboutBlock (Prisma) как JSON в поле data.
 */

export type BlockType =
  | 'hero'
  | 'video'
  | 'stats'
  | 'gallery'
  | 'bento'
  | 'timeline'
  | 'team'
  | 'cta';

export interface AboutBlockRow {
  id: string;
  type: BlockType;
  position: number;
  data: unknown;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Block data shapes ───────────────────────────────────────────────────────

export interface HeroData {
  badge?: string;
  title: string;
  subtitle?: string;
  description?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; action?: string; href?: string };
}

export interface VideoData {
  url?: string;          // direct mp4 / hosted
  youtubeId?: string;    // YouTube embed id
  title?: string;
  duration?: string;
  tag?: string;
}

export interface StatsItem { label: string; value: string }
export interface StatsData {
  items: StatsItem[];
}

export interface GalleryItem {
  id: string;
  mediaType: 'image' | 'gif' | 'video';
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
  title: string;
  description: string;
  color: string;
  href?: string;
  wide?: boolean;  // spans 2 columns
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

// ─── Default data per block type ─────────────────────────────────────────────

/** Maps each BlockType to its concrete default data. No `any` needed. */
type BlockDataMap = {
  hero: HeroData;
  video: VideoData;
  stats: StatsData;
  gallery: GalleryData;
  bento: BentoData;
  timeline: TimelineData;
  team: TeamData;
  cta: CtaData;
};

export const BLOCK_DEFAULTS: BlockDataMap = {
  hero: {
    badge: 'Платформа открыта',
    title: 'TRIOZ',
    subtitle: 'Экосистема проектов',
    description:
      'Игры, общение, творчество и знания — всё в одном пространстве. Мы строим уникальную вселенную, где каждый находит своё место.',
    primaryCta: { label: 'Начать сейчас', href: '/connect' },
    secondaryCta: { label: 'Смотреть видео', action: 'video' },
  },

  video: {
    url: '',
    youtubeId: '',
    title: 'Трейлер платформы',
    duration: '0:00',
    tag: '🎬 Официальный трейлер',
  },

  stats: {
    items: [
      { label: 'раздела платформы', value: '4' },
      { label: 'участников', value: '1 200+' },
      { label: 'активных игры', value: '3' },
      { label: 'материалов в библиотеке', value: '500+' },
      { label: 'год основания', value: '2022' },
    ],
  },

  gallery: {
    title: 'Внутри платформы',
    subtitle: 'Скриншоты, трейлеры, гифки и арты — управляется из админки',
    items: [],
  },

  bento: {
    title: 'Что внутри TRIOZ',
    subtitle: 'Четыре направления — одна экосистема',
    items: [
      {
        key: 'connect',
        icon: '💬',
        title: 'TZ.Connect',
        description:
          'Коммуникационная платформа нового поколения — каналы, сообщества, личные сообщения с превью ссылок и медиа.',
        color: '#6366f1',
        href: '/connect',
        wide: true,
      },
      { key: 'games', icon: '🎮', title: 'TZ.Games', description: 'Стратегические онлайн-игры в уникальной вселенной.', color: '#ef4444', href: '/games' },
      { key: 'library', icon: '📚', title: 'TZ.Library', description: 'Библиотека знаний, книг и лора вселенной.', color: '#10b981', href: '/library' },
      { key: 'pero', icon: '✏️', title: 'TZ.Pero', description: 'Творческая мастерская: рассказы, арт, лор.', color: '#8b5cf6', href: '/pero' },
      { key: 'projects', icon: '🏗️', title: 'TZ.Projects', description: 'Витрина проектов и разработок внутри экосистемы.', color: '#f59e0b', href: '/projects' },
    ],
  },

  timeline: {
    title: 'Путь TRIOZ',
    items: [
      { year: '2022', title: 'Основание проекта', description: 'Первая идея и прототип платформы. Запуск первых игровых механик.', color: '#6366f1' },
      { year: '2023', title: 'TZ.Connect — запуск мессенджера', description: 'Собственная коммуникационная платформа с каналами и сообществами.', color: '#8b5cf6' },
      { year: '2024', title: 'Библиотека и творческий модуль', description: 'TZ.Library и TZ.Pero открыты для всех участников. Лор вселенной.', color: '#06b6d4' },
      { year: '2025', title: 'Новый этап · Сейчас', description: 'Полный редизайн, новые игры, открытое API, публичный доступ.', color: '#6366f1', current: true },
    ],
  },

  team: {
    title: 'Кто создаёт TRIOZ',
    members: [
      { id: '1', name: 'Основатель', role: 'Идея · Разработка', emoji: '👤', color: '#6366f1' },
      { id: '2', name: 'Дизайн', role: 'UI · Арт', emoji: '🎨', color: '#06b6d4' },
      { id: '3', name: 'Контент', role: 'Лор · Редактура', emoji: '✏️', color: '#8b5cf6' },
    ],
    joinLabel: 'Присоединиться',
    joinHref: '/connect',
  },

  cta: {
    title: 'Станьте частью TRIOZ',
    subtitle: 'Присоединяйтесь к тысячам участников уже сегодня',
    primaryCta: { label: 'Зарегистрироваться', href: '/auth/signin' },
    secondaryCta: { label: 'Подробнее о проекте', href: '/projects' },
  },
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: '🦸 Hero-секция',
  video: '🎬 Видео / трейлер',
  stats: '📊 Статистика',
  gallery: '🖼 Медиа-галерея',
  bento: '🃏 Карточки разделов',
  timeline: '📅 История проекта',
  team: '👥 Команда',
  cta: '⚡ CTA-блок',
};

export const BLOCK_TYPES: BlockType[] = [
  'hero', 'video', 'stats', 'gallery', 'bento', 'timeline', 'team', 'cta',
];
