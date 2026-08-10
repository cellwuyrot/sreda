"use client";

/**
 * Тестовый чат: как выглядит лента со всеми возможностями сразу.
 *
 * Настройки внешнего вида применяются к настоящему чату, но проверять их там
 * неудобно — нужно уйти со страницы настроек, найти канал, где есть и роли, и
 * ответы, и непрочитанное, и вернуться. Здесь всё собрано в одной ленте:
 * группировка, цвета ролей, теги, ответ, реакции, отметки о прочтении,
 * разделитель непрочитанного и карточка ссылки.
 *
 * Лента ненастоящая: сообщения захардкожены, ничего не грузится и никуда не
 * отправляется. Зато она использует те же CSS-классы и переменные, что и чат,
 * поэтому любая правка в кастомизации видна здесь сразу.
 */

import { useEffect, useState } from "react";
import {
  CHAT_APPEARANCE_DEFAULT,
  CHAT_APPEARANCE_EVENT,
  ChatAppearance,
  formatMessageTime,
  loadChatAppearance,
} from "@/lib/chatAppearance";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface DemoAuthor {
  name: string;
  username: string;
  initial: string;
  color: string | null;
  tag: string | null;
  avatarClass: string;
}

interface DemoMessage {
  id: string;
  author: DemoAuthor;
  text: string;
  minutesAgo: number;
  grouped?: boolean;
  reply?: { name: string; text: string };
  reactions?: { emoji: string; count: number }[];
  own?: boolean;
  readBy?: number;
  link?: { site: string; title: string; description: string };
  unreadBefore?: boolean;
}

const MIKHAIL: DemoAuthor = {
  name: "Михаил", username: "mikhail", initial: "М",
  color: "#a78bfa", tag: "Команда",
  avatarClass: "from-violet-400 to-indigo-500",
};
const ANNA: DemoAuthor = {
  name: "Анна", username: "anna", initial: "А",
  color: "#34d399", tag: "Модератор",
  avatarClass: "from-emerald-400 to-teal-500",
};
const GUEST: DemoAuthor = {
  name: "Костя", username: "kostya", initial: "К",
  color: null, tag: null,
  avatarClass: "from-amber-400 to-orange-500",
};

const DEMO: DemoMessage[] = [
  { id: "1", author: MIKHAIL, text: "Привет, сегодня собираемся на созвон", minutesAgo: 42 },
  { id: "2", author: MIKHAIL, text: "В шесть по Москве, как договаривались", minutesAgo: 41, grouped: true },
  {
    id: "3", author: ANNA, text: "Принято. Повестку скину заранее",
    minutesAgo: 38,
    reply: { name: "Михаил", text: "Привет, сегодня собираемся на созвон" },
    reactions: [{ emoji: "👍", count: 3 }, { emoji: "🔥", count: 1 }],
  },
  {
    id: "4", author: GUEST, text: "Вот материалы к обсуждению: https://example.com/roadmap",
    minutesAgo: 30,
    link: {
      site: "example.com",
      title: "Дорожная карта проекта",
      description: "Что делаем в этом квартале и в каком порядке. Обновляется каждую пятницу.",
    },
  },
  {
    id: "5", author: MIKHAIL, text: "Спасибо, посмотрю до созвона", minutesAgo: 12,
    own: true, readBy: 4, unreadBefore: true,
  },
];

function Avatar({ author, show }: { author: DemoAuthor; show: boolean }) {
  if (!show) return <div className="w-9 flex-shrink-0" />;
  return (
    <div
      className={`w-9 h-9 flex-shrink-0 rounded-full bg-gradient-to-br ${author.avatarClass} flex items-center justify-center text-white text-sm font-bold`}
    >
      {author.initial}
    </div>
  );
}

export default function ChatShowcase() {
  const [prefs, setPrefs] = useState<ChatAppearance>(CHAT_APPEARANCE_DEFAULT);

  /* Читаем после монтирования и слушаем правки: витрина должна меняться
     одновременно с настройками, которые стоят на этой же странице. */
  useEffect(() => {
    setPrefs(loadChatAppearance());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ChatAppearance>).detail;
      if (next) setPrefs(next);
    };
    window.addEventListener(CHAT_APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(CHAT_APPEARANCE_EVENT, onChange);
  }, []);

  const now = Date.now();
  const pad = prefs.density === "compact" ? 0 : prefs.density === "roomy" ? 7 : 2;

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
          Тестовый чат
          <InfoTooltip text="Лента со всеми возможностями сразу: группировка, цвета ролей, теги, ответы, реакции и карточки ссылок. Сообщения ненастоящие — меняйте настройки выше и сразу смотрите результат." side="bottom" />
        </h2>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-white/5 bg-neutral-50 dark:bg-white/[0.03] p-4 overflow-hidden">
        <div style={{ maxWidth: prefs.maxWidth > 0 ? prefs.maxWidth : undefined }}>
          {DEMO.map((m, i) => {
            const grouped = !!m.grouped && prefs.groupWindowMin > 0;
            const time = formatMessageTime(new Date(now - m.minutesAgo * 60000), prefs.timeFormat);
            return (
              <div key={m.id}>
                {m.unreadBefore && (
                  <div className="flex items-center gap-3 mt-4 mb-1">
                    <div className="flex-1 h-px bg-red-400/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
                      Непрочитанные
                    </span>
                    <div className="flex-1 h-px bg-red-400/60" />
                  </div>
                )}
                <div
                  className={`flex items-start gap-3 ${grouped ? "mt-1" : i === 0 ? "" : "mt-3"}`}
                  style={{ paddingBlock: pad }}
                >
                  {prefs.showAvatars && <Avatar author={m.author} show={!grouped} />}
                  <div className="min-w-0 flex-1">
                    {m.reply && (
                      <div className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-gray-400 mb-1 border-l-2 border-violet-400 dark:border-cyan-400 pl-2 pr-2 py-0.5 rounded-r-md bg-violet-50/60 dark:bg-cyan-400/[0.06] max-w-fit">
                        <span className="font-semibold text-violet-600 dark:text-cyan-300">{m.reply.name}:</span>
                        <span className="truncate max-w-[240px]">{m.reply.text}</span>
                      </div>
                    )}

                    {!grouped && (
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className="tz-chat-author text-neutral-900 dark:text-white"
                          style={prefs.nameColor === "role" && m.author.color ? { color: m.author.color } : undefined}
                        >
                          {m.author.name}
                        </span>
                        {prefs.showUsername && (
                          <span className="text-xs text-neutral-400 dark:text-gray-500">@{m.author.username}</span>
                        )}
                        {prefs.showRoleTags && m.author.tag && m.author.color && (
                          <span
                            className="text-[10px] leading-none px-1.5 py-0.5 rounded-md border"
                            style={{ color: m.author.color, borderColor: `${m.author.color}55`, background: `${m.author.color}14` }}
                          >
                            {m.author.tag}
                          </span>
                        )}
                        <span className="text-xs text-neutral-400 dark:text-gray-600">{time}</span>
                        {m.own && (
                          <span className="text-[11px] text-violet-500 dark:text-cyan-400">
                            ✓✓ {prefs.sendReadReceipts ? m.readBy : "—"}
                          </span>
                        )}
                      </div>
                    )}

                    <p className="tz-chat-body text-neutral-700 dark:text-gray-300 mt-0.5 break-words">{m.text}</p>

                    {m.link && prefs.linkPreviews && (
                      <div className="mt-1.5 flex gap-3 max-w-[440px] rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-2.5">
                        <div className="w-16 h-16 rounded-lg flex-shrink-0 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-white/10 dark:to-white/5" />
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wide text-neutral-400 truncate">{m.link.site}</p>
                          <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">{m.link.title}</p>
                          <p className="text-[11px] text-neutral-500 dark:text-gray-400 line-clamp-2 mt-0.5">{m.link.description}</p>
                        </div>
                      </div>
                    )}

                    {m.reactions && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {m.reactions.map((r) => (
                          <span
                            key={r.emoji}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/5 text-neutral-500"
                          >
                            {r.emoji} {r.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3">
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">Уведомление на экране</p>
        <div className="mt-2 rounded-lg bg-neutral-100 dark:bg-white/5 px-3 py-2">
          <p className="text-xs font-semibold text-neutral-900 dark:text-white">Михаил</p>
          <p className="text-[11px] text-neutral-500 dark:text-gray-400">
            {prefs.hideNotificationText ? "Новое сообщение" : "Привет, сегодня собираемся на созвон"}
          </p>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-400">
          {prefs.hideNotificationText
            ? "Текст скрыт: во всплывающем окне видно только отправителя."
            : "Текст виден всем, кто смотрит на экран. Скрывается на вкладке «Приватность»."}
        </p>
      </div>
    </div>
  );
}
