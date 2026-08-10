/**
 * Иконки возможностей Premium.
 *
 * Раньше в списке стояли эмодзи (🔒 ♾️ 🎥 ⏪ 🎨). В общий язык проекта они не
 * попадают: весь набор — контурные SVG 24×24, stroke 1.9, currentColor (см.
 * ConnectIcons, voiceIcons). Эмодзи рисуются шрифтом системы, поэтому на
 * Windows, macOS и Android выглядят по-разному, не перекрашиваются под тему и
 * тем более не работают в монохромной, где цвет вообще один.
 *
 * Здесь тот же контур и та же толщина линии, что и у остальных иконок, — цвет
 * наследуется от родителя, значит и в светлой теме, и в тёмной, и в «Монохроме»
 * иконка окажется правильного цвета сама.
 */

import type { ReactNode } from "react";
import type { PremiumIconId } from "@/lib/premiumFeatures";

const PATHS: Record<PremiumIconId, ReactNode> = {
  // Щит с замком — защищённое соединение.
  vpn: (
    <>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-3z" />
      <path d="M12 11v3" />
    </>
  ),
  // Стопка карточек — свои сообщества.
  communities: (
    <>
      <rect x="3" y="4" width="13" height="9" rx="2" />
      <path d="M8 17h13M8 20h9" />
    </>
  ),
  // Колонки с заголовком — разделы в списке каналов.
  sections: (
    <>
      <path d="M4 6h16" />
      <path d="M4 11h7v9H4zM15 11h5v9h-5z" />
    </>
  ),
  // Сетка-заготовка — шаблон сообщества.
  templates: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </>
  ),
  // Камера — видео в голосовом канале.
  video: (
    <>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </>
  ),
  // Звуковая волна — качество голоса.
  audio: <path d="M3 12h2l2-6 3 15 3-12 2 6h6" />,
  // Стрелка назад по кругу — мгновенный повтор.
  replay: (
    <>
      <path d="M1 4v6h6" />
      <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
    </>
  ),
  // Облако реплики со строками — длинное сообщение.
  message: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
      <path d="M8 8h9M8 12h6" />
    </>
  ),
  // Собачка — юзернейм.
  username: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 5 2.2A9 9 0 1 0 18 20" />
    </>
  ),
  // Человек в рамке со свечением — оформление профиля.
  profile: (
    <>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M12 2v1.5M20.5 5.5l-1 1M22 14h-1.5M3.5 5.5l1 1M2 14h1.5" />
    </>
  ),
  // Часы со стрелкой назад — глубина истории.
  history: (
    <>
      <path d="M3 5v5h5" />
      <path d="M3.5 13a8.5 8.5 0 1 0 2-6.4L3 10" />
      <path d="M12 8.5V12l2.5 1.5" />
    </>
  ),
  // Лист с отогнутым углом — вложение.
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  // Календарь с отметкой — отложенная отправка.
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M12 14v3l2 1" />
    </>
  ),
  // Канцелярская кнопка — закреплённые сообщения.
  pin: (
    <>
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
      <path d="M12 14v7" />
    </>
  ),
  // Половина круга залита — монохромные темы.
  themes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function PremiumFeatureIcon({
  id,
  size = 20,
  className = "",
}: {
  id: PremiumIconId;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[id]}
    </svg>
  );
}
