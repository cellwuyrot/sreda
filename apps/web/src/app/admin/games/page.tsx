"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";
import InfoTooltip from "@/components/ui/InfoTooltip";

/**
 * GAMES-CATALOG: админ-панель раздела «Игры».
 *
 * Своя игра описывается руками — её код у нас, никакой сверки не нужно.
 * Партнёрская описывается своим же API: администратор вводит адрес и ключ,
 * которые дал разработчик, а название, обложку, описание и ссылку запуска мы
 * забираем из манифеста. Так карточка не расходится с игрой: у партнёра
 * поменялось название — оно поменяется и у нас после сверки.
 */

interface Game {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover: string | null;
  players: string;
  tags: string;
  kind: string;
  active: boolean;
  sortOrder: number;
  launchUrl: string;
  apiBaseUrl: string;
  apiKeyPreview: string;
  hasApiKey: boolean;
  linkState: string;
  linkError: string;
  partnerName: string;
  onlinePlayers: number | null;
  lastSyncAt: string | null;
}

const LINK_LABEL: Record<string, string> = {
  OK: "на связи",
  PENDING: "не проверена",
  ERROR: "ошибка связки",
};

const LINK_TONE: Record<string, string> = {
  OK: "text-green-600 dark:text-green-400",
  PENDING: "text-amber-600 dark:text-amber-400",
  ERROR: "text-red-600 dark:text-red-400",
};

/** Домен для показа. Адрес проверяется при записи, но падать в рендере из-за
    неожиданного значения в базе всё равно нельзя. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "адрес не задан";
  }
}

function syncedText(iso: string | null): string {
  if (!iso) return "ещё не сверялась";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "сверена только что";
  if (minutes < 60) return `сверена ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `сверена ${hours} ч назад`;
  return `сверена ${Math.floor(hours / 24)} дн назад`;
}

/* Что нужно передать разработчику партнёрской игры. Держим текст в панели, а не
   в переписке: это единственное, что от него требуется. */
const MANIFEST_SPEC = `GET https://<ваш-домен>/trioz/manifest
Authorization: Bearer <ключ, который вы выдали TrioZ>

200 OK, application/json
{
  "title":       "Название игры",
  "description": "Описание для карточки",
  "cover":       "https://.../cover.jpg",
  "players":     "2-8 игроков",
  "tags":        ["Стратегия", "PvP"],
  "launchUrl":   "https://play.example.com/trioz",
  "partner":     "Название студии",
  "online":      137
}

Обязательны только title и launchUrl (https).
Этот же запрос TrioZ использует как проверку связи.`;

function Cover({ src, title }: { src: string | null; title: string }) {
  if (!src) {
    return (
      <div className="grid h-14 w-20 flex-shrink-0 place-items-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400 dark:bg-white/5">
        нет обложки
      </div>
    );
  }
  /* Обложка партнёра лежит на его домене, поэтому обычный <img>, а не
     next/image: последний требует внести каждый домен в next.config, то есть
     новая партнёрская игра ломала бы картинку до релиза. */
  return <img src={src} alt={title} className="h-14 w-20 flex-shrink-0 rounded-lg object-cover" />;
}

export default function AdminGamesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);

  const [ownForm, setOwnForm] = useState({ title: "", slug: "", description: "", cover: "", players: "", tags: "", launchUrl: "" });
  const [partnerForm, setPartnerForm] = useState({ apiBaseUrl: "", apiKey: "", slug: "" });
  const [creating, setCreating] = useState<"own" | "partner" | null>(null);
  const [editing, setEditing] = useState<Game | null>(null);
  /* Новый ключ держим отдельным полем: подставлять в input маску «••••xxxx» и
     потом отличать её от настоящего ввода — верный способ однажды записать
     маску вместо ключа. */
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/games");
      if (!res.ok) { setError("Не удалось загрузить каталог"); return; }
      const data = await res.json();
      setGames(Array.isArray(data?.games) ? data.games : []);
      setError("");
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "ADMIN") load();
  }, [status, session, load]);

  const patch = async (id: string, body: Record<string, unknown>, ok?: string) => {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/games", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось сохранить"); return false; }
      setError("");
      setGames((prev) => prev.map((g) => (g.id === id ? data.game : g)));
      if (ok) flash(ok);
      return true;
    } catch {
      setError("Ошибка сети");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const sync = async (game: Game) => {
    setBusyId(game.id);
    try {
      const res = await fetch("/api/admin/games/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: game.id }),
      });
      const data = await res.json().catch(() => null);
      if (data?.game) setGames((prev) => prev.map((g) => (g.id === game.id ? data.game : g)));
      if (!res.ok) {
        setError(
          data?.wasActive
            ? `${data?.error || "Связка не удалась"} — игра снята с публикации`
            : data?.error || "Связка не удалась",
        );
        return;
      }
      setError("");
      flash("Данные игры обновлены из манифеста");
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  };

  const createOwn = async () => {
    if (!ownForm.title.trim()) { setError("Укажите название игры"); return; }
    setCreating("own");
    try {
      const res = await fetch("/api/admin/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "OWN", ...ownForm }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось создать"); return; }
      setError("");
      setOwnForm({ title: "", slug: "", description: "", cover: "", players: "", tags: "", launchUrl: "" });
      flash("Игра добавлена — включите её, когда страница будет готова");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setCreating(null);
    }
  };

  const createPartner = async () => {
    setCreating("partner");
    try {
      const res = await fetch("/api/admin/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "PARTNER", ...partnerForm }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось подключить"); return; }
      setPartnerForm({ apiBaseUrl: "", apiKey: "", slug: "" });
      if (data?.warning) {
        // Запись создана, но манифест не ответил. Данные не потеряны — админ
        // поправит адрес или ключ и нажмёт «Проверить связь».
        setError(`Игра добавлена, но связка не удалась: ${data.warning}`);
      } else {
        setError("");
        flash("Интеграция прошла — карточка заполнена из манифеста, осталось включить");
      }
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setCreating(null);
    }
  };

  const remove = async (game: Game) => {
    if (!confirm(`Удалить «${game.title}» из каталога?`)) return;
    setBusyId(game.id);
    try {
      const res = await fetch(`/api/admin/games?id=${encodeURIComponent(game.id)}`, { method: "DELETE" });
      if (!res.ok) { setError("Не удалось удалить"); return; }
      setGames((prev) => prev.filter((g) => g.id !== game.id));
      flash("Игра удалена из каталога");
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  const own = games.filter((g) => g.kind === "OWN");
  const partner = games.filter((g) => g.kind === "PARTNER");

  const row = (game: Game) => (
    <div key={game.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-white/10">
      <Cover src={game.cover} title={game.title} />
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm text-neutral-900 dark:text-white">{game.title}</strong>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-white/5 dark:text-gray-400">
            /{game.slug}
          </span>
          <span className={`text-[11px] ${game.active ? "text-green-600 dark:text-green-400" : "text-neutral-400"}`}>
            {game.active ? "в разделе" : "скрыта"}
          </span>
        </div>
        {game.description && (
          <p className="mt-1 line-clamp-2 text-xs text-neutral-500 dark:text-gray-400">{game.description}</p>
        )}
        <p className="mt-1 text-[11px] text-neutral-400">
          {game.players || "число игроков не указано"}
          {game.tags ? ` · ${game.tags}` : ""}
        </p>
        {game.kind === "PARTNER" && (
          <p className="mt-1 text-[11px]">
            <span className={LINK_TONE[game.linkState] ?? "text-neutral-400"}>
              {LINK_LABEL[game.linkState] ?? game.linkState}
            </span>
            <span className="text-neutral-400">
              {" · "}{hostOf(game.apiBaseUrl)}
              {game.apiKeyPreview ? ` · ключ ${game.apiKeyPreview}` : " · ключ не задан"}
              {" · "}{syncedText(game.lastSyncAt)}
              {game.onlinePlayers !== null ? ` · онлайн ${game.onlinePlayers}` : ""}
            </span>
          </p>
        )}
        {game.linkError && (
          <p className="mt-1 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">{game.linkError}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busyId === game.id}
          onClick={() => patch(game.id, { active: !game.active }, game.active ? "Игра скрыта из раздела" : "Игра показана в разделе")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            game.active
              ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400"
              : "bg-violet-600 text-white hover:bg-violet-700 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
          }`}
        >
          {game.active ? "Дезактивировать" : "Активировать"}
        </button>
        {game.kind === "PARTNER" && (
          <button
            type="button"
            disabled={busyId === game.id}
            onClick={() => sync(game)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
          >
            Проверить связь
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(game)}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          Изменить
        </button>
        <button
          type="button"
          disabled={busyId === game.id}
          onClick={() => remove(game)}
          className="rounded-lg px-3 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          Удалить
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-6 sm:px-6 dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">← Назад</Link>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Игры</h1>
          <Link href="/games" className="ml-auto text-xs text-neutral-500 hover:underline dark:text-gray-400">Открыть раздел →</Link>
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        {notice && <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-500">{notice}</p>}

        {loading ? (
          <p className="text-sm text-neutral-400">Загрузка…</p>
        ) : (
          <>
            {/* ── Свои игры ── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Свои игры{" "}
                <InfoTooltip
                  side="bottom"
                  text="Игры, которые живут внутри проекта. Ссылка ведёт на нашу же страницу, поэтому сверять карточку не с чем — всё, что здесь введено, так и показывается."
                />
              </h2>
              <div className="mt-3 space-y-2">
                {own.length === 0 && <p className="text-xs text-neutral-400">Пока ни одной своей игры.</p>}
                {own.map(row)}
              </div>

              <div className="mt-4 rounded-xl border border-dashed border-neutral-200 p-3 dark:border-white/10">
                <p className="text-xs font-medium text-neutral-700 dark:text-white/80">Добавить свою игру</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Название" value={ownForm.title} onChange={(e) => setOwnForm({ ...ownForm, title: e.target.value })} />
                  <Input placeholder="Слаг (латиницей, необязательно)" value={ownForm.slug} onChange={(e) => setOwnForm({ ...ownForm, slug: e.target.value })} />
                  <Input placeholder="Число игроков, напр. 2-10 игроков" value={ownForm.players} onChange={(e) => setOwnForm({ ...ownForm, players: e.target.value })} />
                  <Input placeholder="Метки через запятую" value={ownForm.tags} onChange={(e) => setOwnForm({ ...ownForm, tags: e.target.value })} />
                  <Input placeholder="Обложка: /games/.../cover.png" value={ownForm.cover} onChange={(e) => setOwnForm({ ...ownForm, cover: e.target.value })} />
                  <Input placeholder="Ссылка запуска (по умолчанию /games/слаг)" value={ownForm.launchUrl} onChange={(e) => setOwnForm({ ...ownForm, launchUrl: e.target.value })} />
                </div>
                <textarea
                  placeholder="Описание для карточки"
                  value={ownForm.description}
                  onChange={(e) => setOwnForm({ ...ownForm, description: e.target.value })}
                  rows={2}
                  className="input-field mt-2 w-full resize-y"
                />
                <button
                  type="button"
                  onClick={createOwn}
                  disabled={creating === "own" || !ownForm.title.trim()}
                  className="mt-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
                >
                  {creating === "own" ? "Добавление…" : "Добавить"}
                </button>
              </div>
            </section>

            {/* ── Партнёрские игры ── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Партнёрские игры{" "}
                <InfoTooltip
                  side="bottom"
                  text="Игры сторонних студий. Разработчик даёт адрес своего API и ключ, а название, описание, обложку и ссылку мы забираем из его манифеста — руками их вводить не нужно."
                />
              </h2>

              <div className="mt-3 space-y-2">
                {partner.length === 0 && <p className="text-xs text-neutral-400">Партнёрских игр пока нет.</p>}
                {partner.map(row)}
              </div>

              <div className="mt-4 rounded-xl border border-dashed border-neutral-200 p-3 dark:border-white/10">
                <p className="text-xs font-medium text-neutral-700 dark:text-white/80">
                  Подключить партнёрскую игру{" "}
                  <InfoTooltip
                    side="bottom"
                    text="Ключ шифруется при сохранении и обратно уже не отдаётся: в панели останутся только последние 4 символа. Адрес принимается лишь по https."
                  />
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Input placeholder="https://api.студия.ru" value={partnerForm.apiBaseUrl} onChange={(e) => setPartnerForm({ ...partnerForm, apiBaseUrl: e.target.value })} />
                  <Input placeholder="Ключ от разработчика" value={partnerForm.apiKey} onChange={(e) => setPartnerForm({ ...partnerForm, apiKey: e.target.value })} />
                  <Input placeholder="Слаг (необязательно)" value={partnerForm.slug} onChange={(e) => setPartnerForm({ ...partnerForm, slug: e.target.value })} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={createPartner}
                    disabled={creating === "partner" || !partnerForm.apiBaseUrl.trim() || partnerForm.apiKey.trim().length < 8}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
                  >
                    {creating === "partner" ? "Подключение…" : "Подключить"}
                  </button>
                  <button type="button" onClick={() => setShowSpec((v) => !v)} className="text-xs text-neutral-500 hover:underline dark:text-gray-400">
                    {showSpec ? "Скрыть требования к API" : "Что передать разработчику"}
                  </button>
                </div>
                {showSpec && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-900 px-3 py-2 text-[11px] leading-relaxed text-green-300">{MANIFEST_SPEC}</pre>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* ── Правка карточки ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-lg space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{editing.title}</h3>
            {editing.kind === "PARTNER" && (
              <p className="rounded-lg bg-amber-400/[0.08] px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                Название, описание, обложка и ссылка перезапишутся при следующей сверке с
                манифестом — правьте здесь только то, что не приходит от партнёра.
              </p>
            )}
            <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Название" />
            <textarea
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              rows={3}
              placeholder="Описание"
              className="input-field w-full resize-y"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={editing.players} onChange={(e) => setEditing({ ...editing, players: e.target.value })} placeholder="Число игроков" />
              <Input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} placeholder="Метки через запятую" />
              <Input value={editing.cover ?? ""} onChange={(e) => setEditing({ ...editing, cover: e.target.value })} placeholder="Обложка" />
              <Input value={editing.launchUrl} onChange={(e) => setEditing({ ...editing, launchUrl: e.target.value })} placeholder="Ссылка запуска" />
              <Input
                value={String(editing.sortOrder)}
                onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })}
                placeholder="Порядок"
                inputMode="numeric"
              />
            </div>
            {editing.kind === "PARTNER" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={editing.apiBaseUrl} onChange={(e) => setEditing({ ...editing, apiBaseUrl: e.target.value })} placeholder="https://api.студия.ru" />
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={editing.hasApiKey ? `Новый ключ (сейчас ${editing.apiKeyPreview})` : "Ключ разработчика"}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setEditing(null); setNewKey(""); }} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs dark:border-white/10">
                Отмена
              </button>
              <button
                type="button"
                disabled={busyId === editing.id}
                onClick={async () => {
                  const body: Record<string, unknown> = {
                    title: editing.title,
                    description: editing.description,
                    players: editing.players,
                    tags: editing.tags,
                    cover: editing.cover ?? "",
                    launchUrl: editing.launchUrl,
                    sortOrder: editing.sortOrder,
                  };
                  if (editing.kind === "PARTNER") {
                    body.apiBaseUrl = editing.apiBaseUrl;
                    if (newKey.trim()) body.apiKey = newKey.trim();
                  }
                  const ok = await patch(editing.id, body, "Карточка сохранена");
                  if (ok) { setEditing(null); setNewKey(""); }
                }}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
