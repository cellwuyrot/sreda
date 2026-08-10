"use client";

/**
 * «Профиль сервера»: своё имя, аватар и фон мини-профиля в каждом сообществе.
 *
 * Ник глобальный и постоянный — это идентификатор, по нему человека находят и
 * упоминают. Имя же переменное, и в разных сообществах у одного человека оно
 * разное: в рабочем — «Михаил Петров», в игровом — позывной. Поэтому профиль
 * привязан к членству в группе (`GroupMember`), а не к аккаунту.
 *
 * Пустое поле означает «брать из общего профиля», а не «пусто»: сбросить
 * настройку должно быть так же просто, как задать.
 */

import { useCallback, useEffect, useState } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface GroupOption {
  id: string;
  name: string;
  icon: string | null;
}

interface ServerProfile {
  displayName: string | null;
  avatar: string | null;
  profileBanner: string | null;
}

const EMPTY: ServerProfile = { displayName: null, avatar: null, profileBanner: null };

/**
 * Сжимает картинку в data-URL. Маршрут принимает не длиннее 900 000 символов,
 * а телефоны отдают снимки на несколько мегабайт — без сжатия сохранение
 * упиралось бы в ошибку, причину которой пользователь не поймёт.
 */
function compress(file: File, maxSide: number, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Файл не похож на изображение"));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Холст недоступен")); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function ImageField({
  label, hint, value, maxSide, round, onChange,
}: {
  label: string;
  hint: string;
  value: string | null;
  maxSide: number;
  round?: boolean;
  onChange: (next: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        {label}
        <InfoTooltip text={hint} />
      </p>
      <div className="flex items-center gap-3">
        {value ? (
          <img
            src={value}
            alt=""
            className={`${round ? "w-12 h-12 rounded-full" : "w-24 h-12 rounded-lg"} object-cover border border-neutral-200 dark:border-white/10`}
          />
        ) : (
          <div className={`${round ? "w-12 h-12 rounded-full" : "w-24 h-12 rounded-lg"} border border-dashed border-neutral-300 dark:border-white/15`} />
        )}
        <label className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
          {busy ? "Обработка…" : value ? "Заменить" : "Загрузить"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                onChange(await compress(file, maxSide));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Не удалось обработать файл");
              }
              setBusy(false);
            }}
          />
        </label>
        {value && (
          <button
            onClick={() => onChange(null)}
            className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
          >
            Убрать
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export default function ServerProfileSection() {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [profile, setProfile] = useState<ServerProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/groups", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: GroupOption[] = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
        setGroups(list);
        if (list.length > 0) setGroupId(list[0].id);
      })
      .catch(() => setError("Не удалось загрузить список сообществ"))
      .finally(() => setLoading(false));
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/groups/${id}/profile`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setProfile(EMPTY);
        setError((data && typeof data.error === "string" && data.error) || "Не удалось загрузить профиль");
        return;
      }
      setProfile({
        displayName: data?.displayName ?? null,
        avatar: data?.avatar ?? null,
        profileBanner: data?.profileBanner ?? null,
      });
    } catch {
      setError("Ошибка сети");
    }
  }, []);

  useEffect(() => {
    if (groupId) void loadProfile(groupId);
  }, [groupId, loadProfile]);

  async function save(next: ServerProfile) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        /* Пустое имя шлём как null: для маршрута это «вернуть общее», а пустая
           строка означала бы человека без имени. */
        body: JSON.stringify({
          displayName: next.displayName?.trim() ? next.displayName.trim() : null,
          avatar: next.avatar,
          profileBanner: next.profileBanner,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || "Не удалось сохранить");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
          Профиль сервера
          <InfoTooltip text="Своё имя и оформление в конкретном сообществе. Ник при этом не меняется — он общий и постоянный." side="bottom" />
        </h2>
      </div>

      {loading && <p className="text-xs text-neutral-400">Загрузка…</p>}

      {!loading && groups.length === 0 && (
        <p className="text-xs text-neutral-400">Вы пока не состоите ни в одном сообществе.</p>
      )}

      {!loading && groups.length > 0 && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="tz-server-pick" className="text-xs text-neutral-600 dark:text-neutral-300">Сообщество</label>
            <select
              id="tz-server-pick"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-1.5 bg-neutral-50 dark:bg-white border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id} className="bg-white text-neutral-900">{g.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tz-server-name" className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              Имя в этом сообществе
              <InfoTooltip text="Пусто — используется имя из общего профиля. От 2 до 50 символов." />
            </label>
            <input
              id="tz-server-name"
              value={profile.displayName ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
              maxLength={50}
              placeholder="Как в общем профиле"
              className="w-full px-3 py-1.5 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900 dark:text-white"
            />
          </div>

          <ImageField
            label="Аватар в этом сообществе"
            hint="Квадратное изображение. Пусто — общий аватар."
            value={profile.avatar}
            maxSide={256}
            round
            onChange={(next) => setProfile((p) => ({ ...p, avatar: next }))}
          />

          <ImageField
            label="Фон мини-профиля"
            hint="Показывается в карточке, которая открывается по клику на аватар."
            value={profile.profileBanner}
            maxSide={900}
            onChange={(next) => setProfile((p) => ({ ...p, profileBanner: next }))}
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void save(profile)}
              disabled={saving}
              className="px-4 py-2 bg-violet-600 dark:bg-cyan-600 hover:opacity-90 text-white rounded-xl text-xs font-medium transition-opacity disabled:opacity-50"
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              onClick={() => { setProfile(EMPTY); void save(EMPTY); }}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-medium border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Сбросить к общему профилю
            </button>
            {saved && <span className="text-xs text-green-600 dark:text-green-400">Сохранено</span>}
          </div>
        </>
      )}
    </div>
  );
}
