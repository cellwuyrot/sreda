"use client";

import { useState, useRef, useEffect } from "react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Смайлы",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😋", "😛", "😜", "🤪", "😝",
      "🤑", "🤗", "🤭", "🤫", "🤔", "😐", "😑", "😶", "😏", "😒",
      "🙄", "😬", "😮‍💨", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷",
      "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "😎",
    ],
  },
  {
    label: "Жесты",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎",
      "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏",
    ],
  },
  {
    label: "Сердца",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
    ],
  },
  {
    label: "Объекты",
    emojis: [
      "🔥", "⭐", "🌟", "✨", "💫", "🎉", "🎊", "🏆", "🥇", "🎯",
      "💡", "📌", "📎", "🔗", "⚡", "💎", "🔔", "🚀", "💬", "👀",
    ],
  },
];

/** Свой эмодзи сообщества: в текст уходит «:name:», картинку по этому имени
 *  подставляет разбор разметки (messageFormat). */
export interface GroupEmojiItem {
  id: string;
  name: string;
  url: string;
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Набор текущего сообщества. Приходит сверху одним запросом на сообщество. */
  groupEmojis?: GroupEmojiItem[];
}

/** Ключ вкладки своих эмодзи. Вкладки различаем по ключу, а не по номеру:
 *  набор сообщества догружается, и на номерах активная вкладка «съезжала» бы
 *  на соседнюю в момент появления первого эмодзи. */
const GROUP_TAB = "group";

export default function EmojiPicker({ onSelect, onClose, groupEmojis }: EmojiPickerProps) {
  const [activeTab, setActiveTab] = useState<string>(GROUP_TAB);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  /* Свои эмодзи идут первыми: их в сообществе десяток, и ищут именно их, а
     стандартный набор одинаков везде и никуда не денется. Пустой набор вкладку
     не создаёт — незачем показывать пустоту сообществу без своих эмодзи. */
  const custom = groupEmojis ?? [];
  const tabs = [
    ...(custom.length > 0 ? [{ key: GROUP_TAB, label: "Сообщество" }] : []),
    ...EMOJI_CATEGORIES.map((cat) => ({ key: cat.label, label: cat.label })),
  ];
  const active = tabs.some((tab) => tab.key === activeTab) ? activeTab : tabs[0].key;
  const category = EMOJI_CATEGORIES.find((cat) => cat.label === active);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-72 bg-[var(--cn-sidebar)] border border-[var(--cn-border)] rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      {/* Category tabs */}
      <div className="flex border-b border-[var(--cn-border)] px-1 pt-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 text-[10px] py-1.5 rounded-t-lg transition-colors ${
              active === tab.key
                ? "text-violet-500 dark:text-cyan-400 bg-violet-50 dark:bg-cyan-400/10 font-semibold"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="p-2 h-48 overflow-y-auto">
        <div className="grid grid-cols-8 gap-0.5">
          {active === GROUP_TAB
            ? custom.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(`:${item.name}:`); onClose(); }}
                  title={`:${item.name}:`}
                  className="w-8 h-8 hover:bg-[var(--cn-hover)] rounded-lg flex items-center justify-center transition-colors"
                >
                  {/* Оптимизация картинок в проекте отключена — обычный <img>, как у аватаров. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={`:${item.name}:`} width={24} height={24} loading="lazy" decoding="async" className="w-6 h-6 object-contain" draggable={false} />
                </button>
              ))
            : (category?.emojis ?? []).map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { onSelect(emoji); onClose(); }}
                  className="w-8 h-8 text-lg hover:bg-[var(--cn-hover)] rounded-lg flex items-center justify-center transition-colors"
                >
                  {emoji}
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}
