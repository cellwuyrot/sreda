"use client";

import { useState, useEffect, useRef } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

const FACTIONS = [
  { id: "empire", name: "Империя", color: "#ef4444", desc: "Красный цвет, Империя людей на севере Вайн'Вуделла, главный враг Республики и Вальгаллов", enemy: "Республика, Вальгаллы" },
  { id: "republic", name: "Республика", color: "#3b82f6", desc: "Синий цвет, Республика людей на юге Вайн'Вуделла, главный враг Империи и Серебряного Мятежа", enemy: "Империя, Серебряный мятеж" },
  { id: "subbgars", name: "Суббгары", color: "#a855f7", desc: "Фиолетовый цвет, фракция викингообразных гигантов на фьордах. Могут «летать» между своими городами и на Лагерь Наёмников за один ход", enemy: "—" },
  { id: "dwarves", name: "Дворфы", color: "#eab308", desc: "Жёлтый цвет, фракция бородатых карликов в горных крепостях, главные враги Суббгаров и Аваллов", enemy: "Суббгары, Аваллы" },
  { id: "delions", name: "Дэлионы", color: "#171717", desc: "Чёрный цвет, Низшие Эльфы лесов Алвинда, главные враги Авайнов", enemy: "Авайны" },
  { id: "avains", name: "Авайны", color: "#f5f5f5", desc: "Белый цвет, Высшие Эльфы лесов и гор Алдесвинда, главные враги Дэлионов", enemy: "Дэлионы" },
  { id: "ancients", name: "Союз Древних", color: "#92400e", desc: "Коричневый цвет, объединенные Вальгаллы и Аваллы, законные владельцы Нортвилда и Валдесорта", enemy: "—" },
  { id: "trolls", name: "Тролли", color: "#22c55e", desc: "Зелёный цвет, разваленная временем и невзгодами Империя Троллей, пытающаяся возродить своё влияние", enemy: "—" },
  { id: "dark", name: "Тёмные", color: "#67e8f9", desc: "Светло-голубой цвет, Культ Ситаса – фанатики подчиняющиеся богу Пустоты", enemy: "—" },
  { id: "rebellion", name: "Серебряный мятеж", color: "#9ca3af", desc: "Серый цвет, предатели Империи и Республики, восставшие войны в Вестфолле требующие свободы", enemy: "—" },
];

const GODS = [
  { num: 2, name: "Джалайна", effect: "Воскрешает любой свой отряд или гвардию в любой точке карты, кроме святилища" },
  { num: 3, name: "Авалайс", effect: "Даёт возможность утопить любую армию противника на морских путях. Даётся одна карта бога. Использовать можно в любой свой ход" },
  { num: 4, name: "Стратос", effect: "Уничтожает ваш отряд на святилище, в котором был призван" },
  { num: 5, name: "Ситас", effect: "Даёт возможность пропустить ход любому игроку. Даётся одна карта бога. Использовать можно в любой свой ход" },
  { num: 6, name: "Шент'Ар", effect: "При победе побеждённый отряд становится союзным (макс. 11 отрядов). Даются 2 карты. Активировать ПЕРЕД сражением" },
  { num: 7, name: "Гиордг", effect: "Божественная защита. Даются 2 карты. Активировать ПЕРЕД сражением: при проигрыше сражение переигрывается. Карта сгорает в любом случае" },
  { num: 8, name: "Сихварис", effect: "Переносит ваш отряд в любую точку карты, кроме святилища" },
  { num: 9, name: "Вьеронх", effect: "Позволяет перенести армию соперника в любую точку карты. Даётся одна карта бога. Использовать можно в любой свой ход" },
  { num: 10, name: "Ангелона", effect: "Призывает к святилищу, в котором был вызван, 2 вражеских отряда" },
  { num: 11, name: "Антегриз", effect: "Позволяет уничтожить любой вражеский отряд на суше" },
  { num: 12, name: "Выбор", effect: "Вы выбираете любое божество в помощь" },
];

function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    const res = await fetch("/api/games/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "Партия в Вельд'Эран", maxPlayers }),
    });
    if (res.ok) {
      const room = await res.json();
      router.push(`/games/velderan/room/${room.id}`);
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="bg-neutral-900 border border-red-500/20 rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-red-500/10"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-display font-bold text-white mb-4">Создать комнату</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Название</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Партия в Вельд'Эран" className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-500" />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Игроков: {maxPlayers}</label>
            <input type="range" min={2} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="w-full accent-red-500" />
            <div className="flex justify-between text-xs text-gray-500"><span>2</span><span>10</span></div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} disabled={loading}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50">
              {loading ? "Создание..." : "Создать"}
            </button>
            <button onClick={onClose} className="px-4 py-3 bg-neutral-800 text-gray-400 rounded-xl hover:bg-neutral-700 transition-all">
              Отмена
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface RoomListItem {
  id: string;
  name: string;
  status: string;
  maxPlayers: number;
  inviteCode: string;
  host: { id: string; name: string; username: string; avatar: string | null };
  players: { userId: string; user: { name: string } }[];
  _count: { players: number };
}

function OpenRoomsSection() {
  const { data: session } = useSession();
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [myRooms, setMyRooms] = useState<RoomListItem[]>([]);
  const [allRooms, setAllRooms] = useState<RoomListItem[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const user = session?.user as { id?: string; username?: string; role?: string } | undefined;
  const isAdmin = user && ((user.username || "").includes("acoulbot") || user.role === "ADMIN");
  const userId = user?.id;

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/games/rooms?browse=1").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setRooms(d); });
    fetch("/api/games/rooms").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setMyRooms(d); });
    if (isAdmin) {
      fetch("/api/games/rooms?browse=all").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setAllRooms(d); });
    }
  }, [session, isAdmin]);

  const joinRoom = async (roomId: string) => {
    setJoining(roomId);
    const res = await fetch(`/api/games/rooms/${roomId}/players`, { method: "POST" });
    if (res.ok) {
      router.push(`/games/velderan/room/${roomId}`);
    }
    setJoining(null);
  };

  const deleteRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirmDialog({ message: "Удалить эту партию?", confirmText: "Удалить", danger: true }))) return;
    setDeleting(roomId);
    const res = await fetch(`/api/games/rooms/${roomId}`, { method: "DELETE" });
    if (res.ok) {
      setMyRooms((prev) => prev.filter((r) => r.id !== roomId));
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      setAllRooms((prev) => prev.filter((r) => r.id !== roomId));
    }
    setDeleting(null);
  };

  const publicRooms = rooms.filter((r) => !myRooms.some((m) => m.id === r.id));

  if (!session) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 pb-12">
      {myRooms.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-display font-bold text-white mb-4">Мои комнаты</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myRooms.map((r) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-neutral-900 border border-amber-500/20 rounded-xl p-4 hover:border-amber-500/40 transition-all cursor-pointer"
                onClick={() => router.push(`/games/velderan/room/${r.id}`)}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-sm truncate">{r.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.status === "LOBBY" ? "bg-green-500/20 text-green-400" : r.status === "PLAYING" ? "bg-amber-500/20 text-amber-400" : "bg-gray-500/20 text-gray-400"}`}>
                      {r.status === "LOBBY" ? "Лобби" : r.status === "PLAYING" ? "Игра" : r.status}
                    </span>
                    <button onClick={(e) => deleteRoom(r.id, e)} disabled={deleting === r.id}
                      className="text-red-400/50 hover:text-red-400 text-xs transition-colors disabled:opacity-50" title="Удалить">
                      {deleting === r.id ? "..." : "✕"}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Хост: {r.host.name} · {r._count.players}/{r.maxPlayers} игроков
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {publicRooms.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-display font-bold text-white mb-4">Открытые комнаты</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {publicRooms.map((r) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-neutral-900 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-sm truncate">{r.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Лобби</span>
                    {isAdmin && (
                      <button onClick={(e) => deleteRoom(r.id, e)} disabled={deleting === r.id}
                        className="text-red-400/50 hover:text-red-400 text-xs transition-colors disabled:opacity-50" title="Удалить">
                        {deleting === r.id ? "..." : "✕"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  Хост: {r.host.name} · {r._count.players}/{r.maxPlayers} игроков
                </div>
                {r._count.players < r.maxPlayers && r.host.id !== userId ? (
                  <button onClick={() => joinRoom(r.id)} disabled={joining === r.id}
                    className="w-full px-3 py-2 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50">
                    {joining === r.id ? "Присоединение..." : "Присоединиться"}
                  </button>
                ) : r._count.players >= r.maxPlayers ? (
                  <span className="block text-center text-xs text-gray-500">Комната полна</span>
                ) : null}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && allRooms.length > 0 && (
        <div>
          <h2 className="text-2xl font-display font-bold text-white mb-4">
            Все партии <span className="text-sm text-purple-400 font-normal">(админ)</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {allRooms.map((r) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-neutral-900 border border-purple-500/20 rounded-xl p-4 hover:border-purple-500/40 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-sm truncate">{r.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.status === "LOBBY" ? "bg-green-500/20 text-green-400" : r.status === "PLAYING" ? "bg-amber-500/20 text-amber-400" : r.status === "FINISHED" ? "bg-gray-500/20 text-gray-400" : "bg-gray-500/20 text-gray-400"}`}>
                      {r.status === "LOBBY" ? "Лобби" : r.status === "PLAYING" ? "Игра" : r.status === "FINISHED" ? "Завершена" : r.status}
                    </span>
                    <button onClick={(e) => deleteRoom(r.id, e)} disabled={deleting === r.id}
                      className="text-red-400/60 hover:text-red-400 text-sm transition-colors disabled:opacity-50" title="Удалить партию">
                      {deleting === r.id ? "..." : "✕"}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Хост: {r.host.name} · {r._count.players}/{r.maxPlayers} игроков
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GodCard({ god, isAdmin }: { god: typeof GODS[number]; isAdmin: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgSrc, setImgSrc] = useState(`/games/velderan/gods/god-${god.num}.png`);
  const [uploading, setUploading] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("godNum", String(god.num));
    const res = await fetch("/api/games/gods/upload", { method: "POST", body: form });
    if (res.ok) {
      const data = await res.json();
      setImgSrc(data.url);
      setImgKey((k) => k + 1);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="group bg-neutral-800/40 border border-amber-500/10 rounded-xl overflow-hidden hover:border-amber-500/30 transition-all relative">
      <div className="relative aspect-[3/4] overflow-hidden">
        <Image
          key={imgKey}
          src={imgSrc}
          alt={god.name}
          fill
          className="object-contain group-hover:scale-105 transition-transform duration-300"
        />
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute top-1 right-1 bg-black/70 hover:bg-black/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
            >
              {uploading ? "..." : "\u270E"}
            </button>
          </>
        )}
      </div>
      <div className="p-3">
        <p className="text-amber-300 text-xs font-bold mb-1">{god.num}. {god.name}</p>
        <p className="text-gray-400 text-xs leading-relaxed">{god.effect}</p>
      </div>
    </div>
  );
}

export default function VelderanPage() {
  const { data: session } = useSession();
  const [showRules, setShowRules] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const user = session?.user as { id?: string; username?: string; role?: string } | undefined;
  const isAdmin = user && ((user.username || "").includes("acoulbot") || user.role === "ADMIN");

  return (
    <div className="min-h-screen bg-neutral-950">
      {/* Hero section with map */}
      <div className="relative h-[60vh] overflow-hidden">
        <Image src="/games/velderan/map.png" alt="Карта Вельд'Эран" fill className="object-cover opacity-40" priority />
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/30 via-transparent to-neutral-950" />

        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }} className="text-center px-4">
            <h1 className="text-4xl md:text-6xl font-display font-bold text-white mb-4">
              Перо Измерений
            </h1>
            <p className="text-xl md:text-2xl text-amber-400/80 font-display mb-2">Мир Вельд&apos;Эран</p>
            <p className="text-gray-400 max-w-xl mx-auto mb-8">
              Стратегическая настольная игра для 2-10 игроков. Управляйте фракциями, ведите армии через моря и континенты, призывайте древних богов.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              {session ? (
                <button onClick={() => setShowCreate(true)}
                  className="px-8 py-3 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium hover:shadow-xl hover:shadow-red-500/20 transition-all text-lg">
                  Создать комнату
                </button>
              ) : (
                <Link href="/auth/signin"
                  className="px-8 py-3 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium hover:shadow-xl hover:shadow-red-500/20 transition-all text-lg">
                  Войти для игры
                </Link>
              )}
              <button onClick={() => setShowRules(!showRules)}
                className="px-8 py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-all text-lg backdrop-blur-sm border border-white/10">
                {showRules ? "Скрыть правила" : "Правила игры"}
              </button>
              {session && ((session.user as { username?: string })?.username || "").includes("acoulbot") && (
                <Link href="/games/velderan/admin"
                  className="px-6 py-3 bg-purple-600/30 text-purple-300 rounded-xl font-medium hover:bg-purple-600/50 transition-all text-lg border border-purple-500/30">
                  🗺️ Редактор карты
                </Link>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Open Rooms */}
      <OpenRoomsSection />

      {/* Factions */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <motion.h2 initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="text-3xl font-display font-bold text-white mb-8 text-center">
          Фракции
        </motion.h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {FACTIONS.map((f, i) => (
            <motion.div key={f.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.05 }}
              className="group bg-neutral-900 border border-white/5 rounded-xl p-4 hover:border-white/20 transition-all duration-300"
              style={{ borderLeftColor: f.color, borderLeftWidth: 3 }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: f.color, border: f.id === "delions" ? "1px solid #555" : undefined }} />
                <span className="text-white font-medium text-sm">{f.name}</span>
              </div>
              <p className="text-gray-500 text-xs leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Rules */}
      <AnimatePresence>
        {showRules && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="max-w-4xl mx-auto px-4 pb-16">
              <div className="bg-neutral-900 border border-white/10 rounded-2xl p-8 space-y-8">
                <h2 className="text-2xl font-display font-bold text-white">Перо Измерений: Мир Вельд&apos;Эран</h2>

                <Section title="Описание игры">
                  <p className="text-gray-400 text-sm leading-relaxed">Перед вами карта удивительного мира Вельд&apos;Эран. На ней вы видите много обозначений. Для успешной игры вам потребуется разбираться в них.</p>
                </Section>

                <Section title="Обозначения на карте">
                  <Rule icon="🏰" label="Город" text="Помечен кругом с цветом фракции. Является точкой хода." />
                  <Rule icon="🛤️" label="Дорога" text="Пути, по которым могут двигаться ваши отряды. Соединяют все ключевые места на материках." />
                  <Rule icon="⚔️" label="Место сражения" text="Расположены на дорогах в виде скрещенных мечей. Является точкой хода." />
                  <Rule icon="💎" label="Святилище" text="Особое место, где ваши гвардии могут взаимодействовать с богами. Обозначаются алмазами на карте. Является точкой хода." />
                </Section>

                <Section title="Спецвход">
                  <p className="text-gray-400 text-sm leading-relaxed">Для прохода в «Пески Сихвариса» и «Твердь Гиордта» необходимо бросить кубики. Для прохода в Пески должно выпасть чётное число, для Тверди — нечётное. При неудаче отряд возвращается на точку, с которой был совершён ход.</p>
                </Section>

                <Section title="Морские пути">
                  <Rule icon="🧭" label="Роза ветров" text="Ход возможен на ближайшую точку или на порт (обозначаемый якорем). Является точкой хода." />
                </Section>

                <Section title="Спецлокации">
                  <Rule icon="🏴‍☠️" label="Пиратская бухта" text="Место, обозначаемое пиратским флагом (слева снизу). Игрок, контролирующий точку, получает возможность сразиться с любым отрядом на морских путях и портах. Действует 2 раза для одной фишки игрока. При проигрыше отряд не теряется." />
                  <div className="ml-9 mt-1 p-2 bg-red-900/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400/80 text-xs italic">Предательство пиратов: Если после двух использований не уйти с пиратской бухты сразу, то при попытке уйти пираты нападают на вас, действуют правила сражений с пиратами.</p>
                  </div>
                  <Rule icon="⛵" label="Логово контрабандистов" text="Место, обозначаемое штурвалом (на центральных островах). Игрок, контролирующий место, получает возможность через круг перенести отряд в любой порт на карте. (Фишка убирается с карты и по истечении круга выставляется на любой порт)." />
                  <Rule icon="☠️" label="Призрачный Храм" text="Место, обозначаемое Руинами храма (слева сверху). Игрок получает призрачный отряд и может дважды сразиться с любым вражеским отрядом на любой точке кроме святилищ. При проигрыше отряд не теряется." />
                  <div className="ml-9 mt-1 p-2 bg-red-900/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400/80 text-xs italic">Дань смерти: После исчерпания карт призрачного отряда, ваш отряд находящийся в храме погибает. Уйти из Призрачного Храма невозможно.</p>
                  </div>
                  <Rule icon="🏕️" label="Пустынные наёмники (Шейбаниды)" text="Место, обозначаемое палаткой с костром (справа снизу). Игрок получает карты и может дважды сразиться с любым отрядом противника на суше, кроме святилищ. Из Лагеря наёмников можно попасть в Пески Сихвариса, кинув кубики." />
                  <div className="ml-9 mt-2 p-2 bg-amber-900/10 border border-amber-500/20 rounded-lg">
                    <p className="text-amber-400/80 text-xs italic">Важно: карточки бонусных точек возможно использовать лишь при поставленной на этих местах фишке. При уходе с данных точек – карты изымаются.</p>
                  </div>
                </Section>

                <Section title="Распределение">
                  <p className="text-gray-400 text-sm leading-relaxed">Перед началом партии каждый игрок выбирает фракцию. От выбора зависит расположение армий на карте, количество подконтрольных городов и цвет фигурок. Два игрока не могут выбрать одинаковую фракцию.</p>
                  <p className="text-gray-400 text-sm leading-relaxed mt-2">После выбора фракции игроки ставят фишки по всем своим городам. Оставшиеся в запасе фишки выставляются в последующие ходы (по 2 фишки за круг на свои города не захваченные противником).</p>
                </Section>

                <Section title="Начало игры">
                  <p className="text-gray-400 text-sm leading-relaxed">Победа достается игроку победившему остальных.</p>
                </Section>

                <Section title="Боевые карты">
                  <p className="text-gray-400 text-sm leading-relaxed">Перед началом игры каждому игроку раздаётся по 5 боевых карт из колоды. Карты имеют номинал от 1 до 5 и используются для сражений. Другие игроки не должны видеть или знать номиналы ваших карт.</p>
                </Section>

                <Section title="Первый цикл">
                  <p className="text-gray-400 text-sm leading-relaxed">Путём голосования выбирается игрок, который будет ходить первым. Он передвигает свои армии на ближайшие точки хода. Далее остальные игроки по часовой стрелке передвигают свои армии. На одной точке хода может одновременно находиться не более двух фишек одного игрока (за исключением моментов «воскрешения»). Отряды (маленькие фишки) делают два хода за круг. Гвардии (большие фишки) призывают «Богов» на святилищах, но делают лишь один ход. Методы сражения одинаковы как у отрядов, так и у Гвардий.</p>
                </Section>

                <Section title="Сражения">
                  <p className="text-gray-400 text-sm leading-relaxed">Когда две армии игроков встречаются на одной точке хода, они начинают сражение. Игроки выкладывают по одной боевой карте рубашкой вверх. Далее делают предположения о карте соперника. Побеждает тот, кто точно угадал номинал карты соперника. Если оба не угадывают, то игрок с большим номиналом побеждает, если номинал карты противника в диапазоне ±1 от названного числа. Если и в этом случае нет победителя — бой переигрывается сначала.</p>
                  <p className="text-gray-400 text-sm leading-relaxed mt-2">Если игрок сражается при помощи (или против) пиратов, призраков или Шейбанидов, то выкладывает не свою карту, а верхнюю карту из общей колоды, не подсматривая её номинал.</p>
                  <p className="text-gray-400 text-sm leading-relaxed mt-2">После сражения использованные карты складываются в «бито». Игроки берут из колоды то количество карт, которое потратили в сражении.</p>
                </Section>

                <Section title="Божества">
                  <p className="text-gray-400 text-sm leading-relaxed mb-2">
                    На карте мира есть особые места – Святилища. Если ваша Гвардия встанет на любое из святилищ (не более двух раз на одно святилище для одной гвардии!), то игрок получит возможность призвать божество.
                  </p>
                  <p className="text-gray-500 text-xs mb-4 italic">Если Гвардия осталась на святилище после двух бросков, она может призвать бога в последний раз и умереть, либо уйти со святилища.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {GODS.map((g) => (
                      <GodCard key={g.num} god={g} isAdmin={!!isAdmin} />
                    ))}
                  </div>
                </Section>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Room Modal */}
      <AnimatePresence>
        {showCreate && <CreateRoomModal onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-amber-400 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Rule({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div>
        <span className="text-white text-sm font-medium">{label}</span>
        <span className="text-gray-400 text-sm"> — {text}</span>
      </div>
    </div>
  );
}
