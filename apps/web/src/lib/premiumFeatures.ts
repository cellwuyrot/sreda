/**
 * Единый источник правды о том, что даёт TZ Premium.
 *
 * Здесь перечислено ровно то, что РЕАЛЬНО проверяется в коде. Список сверен с
 * местами, где стоит проверка подписки (см. lib/premium → hasPremium):
 *
 *  • VPN «TZ Secure» ............... lib/vpn.ts (hasVpnEntitlement)
 *  • сообщества сверх лимита ....... api/groups POST
 *  • разделы в сообществе .......... api/groups/[id] PATCH (sectionsEnabled)
 *  • премиум-шаблоны ............... lib/communityTemplates + api/groups
 *  • видео 1080p и 60 кадров ....... contexts/VoiceContext (камера и показ экрана)
 *  • битрейт голоса ................ contexts/VoiceContext (PREMIUM_AUDIO_BITRATE)
 *  • мгновенный повтор ............. contexts/VoiceContext (FIX-REPLAY)
 *  • длина сообщения ............... lib/messageLimits
 *  • ник без цифр .................. api/profile PATCH
 *  • оформление профиля ............ api/profile/me (свечение аватара)
 *  • темы «Монохром» / Mono Lite ... app/connect (canMono) + настройки
 *
 * Раньше половины этого в списке не было: он описывал подписку по памяти, а не
 * по коду — человек платил и не знал, за что. Теперь список и таблица сравнения
 * собираются из ОДНОГО массива: разойтись им больше негде.
 *
 * Числовые пределы импортируются из модулей, которые их и применяют, — иначе
 * витрина однажды разойдётся с настоящей проверкой.
 */

import { FREE_MESSAGE_WORDS, PREMIUM_MESSAGE_WORDS } from "./messageLimits";
import {
  FREE_GROUP_EMOJI,
  FREE_PINS,
  FREE_SCHEDULED_QUEUE,
  FREE_UPLOAD_MB,
  PREMIUM_GROUP_EMOJI,
  PREMIUM_PINS,
  PREMIUM_UPLOAD_MB,
} from "./premiumLimits";

/** Сколько своих сообществ может создать обычный (не-premium) аккаунт. */
export const FREE_COMMUNITY_LIMIT = 5;

/** Основное преимущество подписки — выделяется отдельно в настройках и модалке. */
export const PREMIUM_MAIN_ADVANTAGE = {
  badge: "Флагман Premium",
  title: "Надёжное соединение",
  description:
    "Приватное защищённое соединение для сервисов TZ: один тумблер — и весь трафик идёт через закрытый канал TZ Secure.",
} as const;

/**
 * Идентификатор иконки. Не эмодзи: набор иконок в проекте — контурные SVG
 * (24×24, stroke 1.9, currentColor), и эмодзи среди них выглядели чужеродно,
 * к тому же рисуются по-разному в разных системах. Отрисовка — в
 * components/premium/PremiumFeatureIcon.
 */
export type PremiumIconId =
  | "vpn"
  | "communities"
  | "sections"
  | "templates"
  | "video"
  | "audio"
  | "replay"
  | "message"
  | "username"
  | "profile"
  | "themes"
  | "history"
  | "file"
  | "schedule"
  | "pin";

export interface PremiumFeature {
  id: PremiumIconId;
  title: string;
  description: string;
  /** Значение для обычного профиля в таблице сравнения. */
  free: string;
  /** Значение для Premium-профиля в таблице сравнения. */
  premium: string;
  /** Показывать в коротком списке «что входит» и во всплывающем окне. */
  highlight?: boolean;
}

/**
 * Возможности подписки. Порядок = приоритет показа: сначала то, ради чего
 * подписку берут чаще всего.
 */
export const PREMIUM_FEATURES: PremiumFeature[] = [
  {
    id: "vpn",
    title: "Надёжное соединение",
    description: "Приватное защищённое соединение для сервисов TZ.",
    free: "—",
    premium: "✓",
    highlight: true,
  },
  {
    id: "message",
    title: "Длинные сообщения",
    description: `До ${PREMIUM_MESSAGE_WORDS.toLocaleString("ru-RU")} слов в одном сообщении вместо ${FREE_MESSAGE_WORDS.toLocaleString("ru-RU")}.`,
    free: `${FREE_MESSAGE_WORDS.toLocaleString("ru-RU")} слов`,
    premium: `${PREMIUM_MESSAGE_WORDS.toLocaleString("ru-RU")} слов`,
    highlight: true,
  },
  {
    id: "file",
    title: "Файлы крупнее",
    description: `До ${PREMIUM_UPLOAD_MB} МБ на файл вместо ${FREE_UPLOAD_MB} МБ, и без замедления загрузки.`,
    free: `${FREE_UPLOAD_MB} МБ`,
    premium: `${PREMIUM_UPLOAD_MB} МБ`,
    highlight: true,
  },
  {
    id: "communities",
    title: "Безлимит сообществ",
    description: `Создавайте сколько угодно своих сообществ (обычный аккаунт — до ${FREE_COMMUNITY_LIMIT}).`,
    free: `до ${FREE_COMMUNITY_LIMIT}`,
    premium: "Безлимит",
    highlight: true,
  },
  {
    id: "video",
    title: "Видео 1080p и 60 кадров",
    description: "Камера и демонстрация экрана в Full HD; обычный аккаунт — 720p и 30 кадров.",
    free: "720p · 30",
    premium: "1080p · 60",
    highlight: true,
  },
  {
    id: "audio",
    title: "Голос вдвое чётче",
    description: "Исходящий звук передаётся на удвоенном битрейте — меньше «телефонного» призвука.",
    free: "64 кбит/с",
    premium: "128 кбит/с",
    highlight: true,
  },
  {
    id: "replay",
    title: "Мгновенный повтор",
    description: "Последние 30 секунд голоса и трансляции одной кнопкой; длительность настраивается до 3 минут.",
    free: "—",
    premium: "✓",
    highlight: true,
  },
  {
    id: "schedule",
    title: "Отложенная отправка",
    description: `Очередь отложенных сообщений без счёта; без подписки — до ${FREE_SCHEDULED_QUEUE} одновременно.`,
    free: `${FREE_SCHEDULED_QUEUE} в очереди`,
    premium: "Без счёта",
  },
  {
    id: "pin",
    title: "Больше закреплённых",
    description: `До ${PREMIUM_PINS} закреплённых сообщений в канале и в переписке вместо ${FREE_PINS}.`,
    free: `${FREE_PINS}`,
    premium: `${PREMIUM_PINS}`,
  },
  {
    id: "audio",
    title: "Эквалайзер голоса",
    description: "Пять полос, пресеты и монитор — слышать свой голос в наушниках.",
    free: "—",
    premium: "✓",
  },
  {
    id: "communities",
    title: "Свои эмодзи в сообществе",
    description: `До ${PREMIUM_GROUP_EMOJI} своих эмодзи в сообществе вместо ${FREE_GROUP_EMOJI}; считается по подписке владельца.`,
    free: `${FREE_GROUP_EMOJI}`,
    premium: `${PREMIUM_GROUP_EMOJI}`,
  },
  {
    id: "sections",
    title: "Разделы в сообществе",
    description: "Каналы группируются по разделам — в больших сообществах без этого не разобраться.",
    free: "—",
    premium: "✓",
  },
  {
    id: "templates",
    title: "Премиум-шаблоны сообществ",
    description: "Готовая структура каналов и ролей под задачу при создании сообщества.",
    free: "—",
    premium: "✓",
  },
  {
    id: "username",
    title: "Ник без цифр",
    description: "Короткий юзернейм из одних букв — обычным аккаунтам нужна хотя бы одна цифра.",
    free: "—",
    premium: "✓",
  },
  {
    id: "profile",
    title: "Оформление профиля",
    description: "Свечение аватара и выбор его цветов.",
    free: "—",
    premium: "✓",
  },
  {
    id: "themes",
    title: "Темы «Монохром» и Mono Lite",
    description: "Две дополнительные темы оформления приложения.",
    free: "—",
    premium: "✓",
  },
];

/** Короткий список для витрины: только то, что вынесено в highlight. */
export const PREMIUM_KEY_FEATURES: PremiumFeature[] = PREMIUM_FEATURES.filter((f) => f.highlight);

export interface PremiumComparisonRow {
  feature: string;
  free: string;
  premium: string;
}

/**
 * Табличное сравнение собирается из того же массива — отдельного списка больше
 * нет, поэтому строка не может «потеряться» в одном месте и остаться в другом.
 */
export const PREMIUM_COMPARISON: PremiumComparisonRow[] = PREMIUM_FEATURES.map((f) => ({
  feature: f.title,
  free: f.free,
  premium: f.premium,
}));
