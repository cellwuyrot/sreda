"use client";

import { useState, useEffect, useCallback } from "react";

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
}: {
  channelId: string;
  currentUserId: string;
}) {
  const [polls, setPolls] = useState<PollData[]>([]);

  const fetchPolls = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await fetch(`/api/channels/polls?channelId=${channelId}`);
      if (res.ok) setPolls(await res.json());
    } catch {}
  }, [channelId]);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  const vote = async (optionId: string) => {
    await fetch("/api/channels/polls", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    });
    fetchPolls();
  };

  const closePoll = async (pollId: string) => {
    await fetch("/api/channels/polls", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollId, action: "close" }),
    });
    fetchPolls();
  };

  const activePolls = polls.filter((p) => !p.closed);
  if (activePolls.length === 0) return null;

  return (
    <div className="px-3 py-3 border-b border-neutral-200 dark:border-white/10">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
        Активные опросы
      </h3>
      <div className="space-y-2">
        {activePolls.map((poll) => {
          const totalVotes = poll.options.reduce((s, o) => s + o.votes.length, 0);
          return (
            <div
              key={poll.id}
              className="p-2.5 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-neutral-900 dark:text-white leading-snug">
                  {poll.question}
                </p>
                {poll.userId === currentUserId && (
                  <button
                    onClick={() => closePoll(poll.id)}
                    className="text-[10px] text-red-400 hover:text-red-300 whitespace-nowrap"
                  >
                    Закрыть
                  </button>
                )}
              </div>
              <p className="text-[10px] text-neutral-400 mb-2">
                {poll.user.name} • {totalVotes} гол.
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
                      onClick={() => vote(opt.id)}
                      className={`w-full text-left relative overflow-hidden rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
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
