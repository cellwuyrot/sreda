"use client";

// FIX-INVITE-OG: клиентская часть страницы приглашения вынесена из page.tsx,
// чтобы сама страница стала серверным компонентом и могла отдавать
// generateMetadata (персональное OG-превью сообщества для мессенджеров).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Button from "@/components/ui/Button";

type InvitePayload = {
  code: string;
  expiresAt: string | null;
  group: {
    id: string;
    name: string;
    icon: string | null;
    description: string;
    _count: { members: number };
  };
};

export default function InviteClient() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { status } = useSession();
  const code = useMemo(() => String(params?.code || "").trim(), [params]);
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError("");
    fetch(`/api/invites/${code}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Приглашение недоступно");
        }
        setInvite(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Приглашение недоступно");
      })
      .finally(() => setLoading(false));
  }, [code]);

  const handleJoin = async () => {
    if (!code) return;

    if (status !== "authenticated") {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(`/invite/${code}`)}`);
      return;
    }

    setJoining(true);
    setError("");
    try {
      const res = await fetch(`/api/invites/${code}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        setError(data.error || "Не удалось присоединиться");
        setJoining(false);
        return;
      }
      router.push("/connect");
      router.refresh();
    } catch {
      setError("Ошибка сети");
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl p-6">
        {loading ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Загрузка приглашения...</p>
        ) : error && !invite ? (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Приглашение недоступно</h1>
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
            <Button onClick={() => router.push("/")} size="md" fullWidth>На главную</Button>
          </div>
        ) : invite ? (
          <div className="space-y-5">
            <div className="text-center">
              {invite.group.icon && invite.group.icon.startsWith("/") && !imgError ? (
                <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto mb-4">
                  <Image src={invite.group.icon} alt={invite.group.name} width={80} height={80} className="w-full h-full object-cover" onError={() => setImgError(true)} />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-violet-100 dark:bg-cyan-400/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-violet-500 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
              )}
              <p className="text-sm uppercase tracking-[0.2em] text-violet-500 dark:text-cyan-400">Приглашение в группу</p>
              <h1 className="mt-2 text-2xl font-bold text-neutral-900 dark:text-white">{invite.group.name}</h1>
              {invite.group.description && <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{invite.group.description}</p>}
            </div>

            <div className="rounded-2xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 p-4 space-y-2">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">Участников: <span className="font-semibold text-neutral-900 dark:text-white">{invite.group._count.members}</span></p>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">Ссылка активна до: <span className="font-semibold text-neutral-900 dark:text-white">{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString("ru-RU") : "без ограничения"}</span></p>
              {status !== "authenticated" && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Если вы ещё не зарегистрированы, сначала пройдёте вход/регистрацию, затем сможете присоединиться к группе.</p>
              )}
            </div>

            {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

            <Button onClick={handleJoin} disabled={joining} size="md" fullWidth>
              {joining ? "Подключение..." : status === "authenticated" ? "Вступить в группу" : "Войти или зарегистрироваться"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
