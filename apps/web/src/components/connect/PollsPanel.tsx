"use client";

/**
 * Опросы канала.
 *
 * FIX-POLLBLOCK (место). Панель стояла отдельной полосой — в правой колонке и
 * во всю ширину. Опрос — часть разговора, а не элемент обстановки: теперь это
 * обычный блок в ленте, ограниченный по ширине как сообщение (variant="chat").
 *
 * FIX-POLLBLOCK (закрытие). Список показывал только незакрытые опросы, а ошибки
 * запросов молча глотались. Из-за этого нажатие «Закрыть» выглядело одинаково и
 * когда опрос действительно закрылся, и когда сервер отказал (403 для не
 * автора/не модератора): блок просто исчезал или оставался без объяснений.
 * Теперь закрытый опрос остаётся на месте с пометкой и итогами (голосовать в нём
 * нельзя), отказ и ошибка сети видны текстом, а убрать завершённый опрос с глаз
 * можно вручную (итоги сервер всё равно публикует сообщением в ленту).
 */

import { useState, useEffect, useCallback } from "react";
import { PollIcon } from "@/components/ui/ConnectIcons";

interface VoteStub { userId: string; }
interface PollOptionData { id: string; text: string; votes: VoteStub[]; }
interface UserStub { id: string; name: string | null; }
interface PollData {
  id: string;
  question: string;
  closed: boolean;
  userId: string;
  user: UserStub;
  options: PollOptionData[];
}

export default function PollsPanel({
  channelId,
  currentUserId,
  variant = "sidebar",
}: {
  channelId: string;
  currentUserId: string;
  /** "chat" — блок внутри ленты ограниченной ширины, "sidebar" — колонка. */
  variant?: "sidebar" | "chat";
}) {
  const [polls, setPolls] = useState<PollData[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** Завершённые опросы, которые человек убрал у себя с глаз. */
  const [dismissed, setDismissed] = useState<string[]>([]);

  const fetchPolls = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await fetch(`/api/channels/polls?channelId=${channelId}`);
      if (res.ok) setPolls(await res.json());
    } catch {}
  }, [channelId]);

  useEffect(() => {
    /* Сменили канал — скрытое здесь больше не значит ничего. */
    setDismissed([]);
    setError("");
    fetchPolls();
  }, [fetchPolls]);

  const vote = async (pollId: string, optionId: string) => {
    setBusy(pollId); setError("");
    try {
      const res = await fetch("/api/channels/polls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(
          d.error === "Poll closed or not found" ? "Опрос уже закрыт" :
          d.error === "Forbidden" ? "Нет доступа к этому опросу" :
          "Не удалось проголосовать",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проголосовать");
    }
    /* Перечитываем в любом случае: при отказе причина часто в том, что опрос уже
       закрыли рядом, — надо показать его настоящее состояние. */
    await fetchPolls();
    setBusy(null);
  };

  const closePoll = async (pollId: string) => {
    setBusy(pollId); setError("");
    try {
      const res = await fetch("/api/channels/polls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId, action: "close" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(
          d.error === "Forbidden" ? "Закрыть опрос может автор или модератор" :
          d.error === "Not found" ? "Опрос не найден" :
          "Не удалось закрыть опрос",
        );
      }
      /* Отметку ставим сразу: сервер закрытие подтвердил, а перечитывание
         списка — ещё один запрос, и до его ответа опрос не должен выглядеть
         открытым — иначе по нему успеют нажать ещё раз. */
      setPolls((prev) => prev.map((p) => (p.id === pollId ? { ...p, closed: true } : p)));
      await fetchPolls();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось закрыть опрос");
    }
    setBusy(null);
  };

  const visible = polls.filter((p) => !dismissed.includes(p.id));
  if (visible.length === 0) return null;

  /* В ленте блок шириной как сообщение, а не на всю полосу. */
  const wrapCls =
    variant === "chat"
      ? "px-3 md:px-5 pt-3 pb-1 w-full max-w-[520px] space-y-2"
      : "px-3 py-3 border-b border-neutral-200 dark:border-white/10 space-y-2";

  return (
    <div className={wrapCls}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        <PollIcon size={14} tone="inactive" />
        Опросы
      </h3>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="space-y-2">
        {visible.map((poll) => {
          const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0);
          const mayClose = poll.userId === currentUserId;
          return (
            <div
              key={poll.id}
              className={`p-2.5 rounded-xl border ${
                poll.closed
                  ? "bg-neutral-100/60 dark:bg-white/[0.03] border-neutral-200 dark:border-white/5"
                  : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-neutral-900 dark:text-white leading-snug">
                  {poll.question}
                </p>
                {poll.closed ? (
                  <button
                    onClick={() => setDismissed((prev) => [...prev, poll.id])}
                    className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 whitespace-nowrap"
                  >
                    Скрыть
                  </button>
                ) : mayClose ? (
                  <button
                    onClick={() => closePoll(poll.id)}
                    disabled={busy === poll.id}
                    className="text-[10px] text-red-400 hover:text-red-300 whitespace-nowrap disabled:opacity-50"
                  >
                    {busy === poll.id ? "…" : "Закрыть"}
                  </button>
                ) : null}
              </div>
              <p className="text-[10px] text-neutral-400 mb-2">
                {poll.user?.name || "Удалённый пользователь"} • {totalVotes} гол.
                {poll.closed && " • Опрос закрыт"}
              </p>
              <div className="space-y-1">
                {poll.options.map((opt) => {
                  const pct = totalVotes
                    ? Math.round((opt.votes.length / totalVotes) * 100)
                    : 0;
                  const voted = opt.votes.some((v) => v.userId === currentUserId);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => vote(poll.id, opt.id)}
                      /* В закрытом опросе строки — итог, а не кнопка: сервер такой
                         голос всё равно отклонит, незачем предлагать жать. */
                      disabled={poll.closed || busy === poll.id}
                      className={`w-full text-left relative overflow-hidden rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                        poll.closed ? "cursor-default" : ""
                      } ${
                        voted
                          ? "bg-violet-500/15 dark:bg-cyan-400/15 text-accent"
                          : "bg-neutral-200/60 dark:bg-white/5 text-neutral-700 dark:text-gray-200 hover:bg-neutral-200"
                      }`}
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-violet-500/15 dark:bg-cyan-400/15"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="relative flex justify-between">
                        <span>{opt.text}</span>
                        <span className="tabular-nums">{pct}%</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
