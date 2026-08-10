/**
 * TPL: шаблоны сообществ — набор каналов, с которым создаётся новая группа.
 *
 * ── Что шаблон обязан создавать ─────────────────────────────────────────────
 *
 * Рабочие МОДУЛИ (см. lib/channelModules.ts) плюс чат и голос. Модуль — это то,
 * ради чего шаблон и берут: готовые «Новости», «Задачи», «Календарь» вместо
 * пустой группы с одним каналом.
 *
 * Раньше каналы шаблона были помечены полем `section: true`, а маршрут создания
 * группы включал по этой пометке блочный режим (`sectionsEnabled`). В итоге
 * любая группа по премиум-шаблону открывалась как ГЛАВНОЕ сообщество TZ Connect
 * — блочным интерфейсом разделов, — а панель «Разделы — рабочие модули группы»
 * не появлялась вовсе. Пометки больше нет: блочный режим включается только
 * переключателем в настройках группы, осознанно и владельцем.
 *
 * ── Почему у модулей нет своих имён и иконок ────────────────────────────────
 *
 * Имя модульного канала берётся из `defaultName` в channelModules.ts — того же,
 * что подставляет ручное добавление модуля в настройках. Иначе развёрнутое
 * шаблоном и добавленное руками выглядит по-разному («важная-информация» против
 * «Новости»), и человек ищет знакомый раздел глазами. Иконка модулю тоже не
 * нужна: панель рисует её по типу канала. Прежние значения (`announce`,
 * `generic`, `create`, `support`) — ключи BlockIcons, иконок блочного режима;
 * панель модулей их не читает вовсе, то есть они молча ничего не делали.
 *
 * Эмодзи остаются только у каналов переписки: их иконку рисует список каналов.
 */
import type { ChannelModuleType } from "./channelModules";

export type CommunityTemplateId = "blank" | "gaming" | "project" | "support" | "learning";

export interface CommunityTemplateChannel {
  name: string;
  /**
   * Тип канала. Модульные типы перечислены одним списком в channelModules.ts —
   * так шаблон физически не может создать канал, которого не знает панель
   * модулей (APPEALS сюда не входит: это канал платформенной поддержки, а не
   * модуль группы, см. пояснение там же).
   */
  type: "TEXT" | "VOICE" | ChannelModuleType;
  icon?: string;
  postAccess?: "ALL" | "MOD" | "ADMIN";
  sortOrder?: number;
}

export interface CommunityTemplate {
  id: CommunityTemplateId;
  name: string;
  description: string;
  premium: boolean;
  channels: CommunityTemplateChannel[];
}

export const COMMUNITY_TEMPLATES: CommunityTemplate[] = [
  {
    id: "blank",
    name: "Базовое сообщество",
    description: "Общий чат и голосовой канал",
    premium: false,
    channels: [
      { name: "общий", type: "TEXT", icon: "💬", sortOrder: 0 },
      { name: "голосовой", type: "VOICE", icon: "🎙️", sortOrder: 1 },
    ],
  },
  {
    id: "gaming",
    name: "Игровое сообщество",
    description: "Новости, поиск команды, события, активность участников и голосовые комнаты",
    premium: true,
    channels: [
      { name: "общий", type: "TEXT", icon: "💬", sortOrder: 0 },
      { name: "Новости", type: "NEWS", postAccess: "MOD", sortOrder: 10 },
      // Обычный текстовый канал, а не модуль: это переписка, ей место в списке каналов.
      { name: "поиск-команды", type: "TEXT", sortOrder: 20 },
      { name: "Календарь", type: "CALENDAR", sortOrder: 30 },
      // Онбординг новичков с выдачей роли — в игровом сообществе состав меняется чаще всего.
      { name: "Общественность", type: "COMMUNITY", sortOrder: 40 },
      { name: "Лобби", type: "VOICE", icon: "🎙️", sortOrder: 50 },
      { name: "Команда 1", type: "VOICE", icon: "🎧", sortOrder: 51 },
      { name: "Команда 2", type: "VOICE", icon: "🎧", sortOrder: 52 },
    ],
  },
  {
    id: "project",
    name: "Проектная команда",
    description: "Объявления, задачи, документы, база знаний, встречи и совместные холсты",
    premium: true,
    channels: [
      { name: "общий", type: "TEXT", icon: "💬", sortOrder: 0 },
      { name: "Новости", type: "NEWS", postAccess: "MOD", sortOrder: 10 },
      { name: "Задачи", type: "TASKS", sortOrder: 20 },
      { name: "Документы", type: "DOCS", sortOrder: 30 },
      { name: "База знаний", type: "WIKI", sortOrder: 40 },
      { name: "Календарь", type: "CALENDAR", sortOrder: 50 },
      // Совместные холсты: планирование и схемы, ради которых команда иначе уходит в чужой сервис.
      { name: "Рабочая среда", type: "CANVAS", sortOrder: 60 },
      { name: "Командная встреча", type: "VOICE", icon: "🎙️", sortOrder: 70 },
    ],
  },
  {
    id: "support",
    name: "Поддержка",
    description: "Новости, вопросы-ответы, инструкции и онбординг новичков",
    premium: true,
    channels: [
      { name: "общий", type: "TEXT", icon: "💬", sortOrder: 0 },
      { name: "Новости", type: "NEWS", postAccess: "MOD", sortOrder: 10 },
      { name: "Вопросы-ответы", type: "QA", sortOrder: 20 },
      { name: "База знаний", type: "WIKI", sortOrder: 30 },
      // Вместо канала обращений: разбирать обращения может только глобальный
      // администратор платформы, владельцу группы такой канал показывал бы
      // пустой список. Онбординг с выдачей роли поддержке нужнее.
      { name: "Общественность", type: "COMMUNITY", sortOrder: 40 },
      { name: "Комната поддержки", type: "VOICE", icon: "🎙️", sortOrder: 50 },
    ],
  },
  {
    id: "learning",
    name: "Учебная группа",
    description: "Объявления, материалы, вопросы, задания, расписание и общий холст",
    premium: true,
    channels: [
      { name: "общий", type: "TEXT", icon: "💬", sortOrder: 0 },
      { name: "Новости", type: "NEWS", postAccess: "MOD", sortOrder: 10 },
      { name: "Документы", type: "DOCS", sortOrder: 20 },
      { name: "Вопросы-ответы", type: "QA", sortOrder: 30 },
      { name: "Задачи", type: "TASKS", sortOrder: 40 },
      { name: "Календарь", type: "CALENDAR", sortOrder: 50 },
      // Разбор задач на общем холсте — то, что на занятии делают у доски.
      { name: "Рабочая среда", type: "CANVAS", sortOrder: 60 },
      { name: "Аудитория", type: "VOICE", icon: "🎙️", sortOrder: 70 },
    ],
  },
];

export function getCommunityTemplate(id: unknown): CommunityTemplate | null {
  if (typeof id !== "string") return null;
  return COMMUNITY_TEMPLATES.find((template) => template.id === id) ?? null;
}
