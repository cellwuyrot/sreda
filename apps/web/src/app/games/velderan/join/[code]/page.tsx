"use client";

import { useState, useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";

interface RoomPreview {
  id: string;
  name: string;
  status: string;
  maxPlayers: number;
  host: { id: string; name: string; username: string };
  players: { userId: string; user: { name: string } }[];
  _count: { players: number };
}

export default function JoinByCodePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch(`/api/games/invites?code=${code}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setRoom(data);
          const userId = (session.user as { id: string }).id;
          const alreadyIn = data.players.some((p: { userId: string }) => p.userId === userId);
          if (alreadyIn) {
            router.push(`/games/velderan/room/${data.id}`);
          }
        }
      });
  }, [code, session, router]);

  const joinRoom = async () => {
    if (!room) return;
    setJoining(true);

    const res = await fetch(`/api/games/rooms/${room.id}/players`, {
      method: "POST",
    });

    if (res.ok) {
      router.push(`/games/velderan/room/${room.id}`);
    } else {
      const data = await res.json();
      setError(data.error || "Не удалось присоединиться");
    }
    setJoining(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Требуется авторизация</h1>
          <Link href="/auth/signin" className="px-6 py-3 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium">
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md bg-neutral-900 border border-red-500/20 rounded-2xl p-8">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-white mb-2">Ошибка</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <Link href="/games/velderan" className="px-6 py-3 bg-neutral-800 text-white rounded-xl hover:bg-neutral-700 transition-all">
            К списку игр
          </Link>
        </motion.div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Spinner tone="danger" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-neutral-900 border border-amber-500/20 rounded-2xl p-8 shadow-2xl shadow-amber-500/5">
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-white mb-2">{room.name}</h1>
          <p className="text-gray-400 mb-6">
            Хост: {room.host.name} · {room._count.players}/{room.maxPlayers} игроков
          </p>

          <div className="space-y-2 mb-6">
            {room.players.map((p) => (
              <div key={p.userId} className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-amber-400/20 flex items-center justify-center text-xs font-bold text-white">
                  {p.user.name.charAt(0)}
                </div>
                <span className="text-sm text-white">{p.user.name}</span>
              </div>
            ))}
          </div>

          <button onClick={joinRoom} disabled={joining || room.status !== "LOBBY"}
            className="w-full px-6 py-3 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium hover:shadow-xl hover:shadow-red-500/20 transition-all disabled:opacity-50">
            {room.status !== "LOBBY" ? "Игра уже идёт" : joining ? "Присоединение..." : "Присоединиться"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
