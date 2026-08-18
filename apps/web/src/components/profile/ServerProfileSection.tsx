"use client";

/**
 * Профиль на выбранном сервере: имя, аватар и фон только для одного сообщества.
 *
 * FIX-SRVPROFILE. Было: раздел читал только переопределения из
 * GET /api/groups/[id]/profile и ничего не знал об общем профиле. У большинства
 * людей переопределений нет, и вместо своих данных они видели три пустые
 * пунктирные рамки — выглядело это как «загруженное не отображается».
 * Стало: рядом с полями стоит карточка ровно в том виде, в каком её увидят в
 * сообществе, а пустые поля подписаны «из общего профиля» и показывают
 * унаследованное значение. Ник — всегда общий: он один на всю площадку, иначе
 * упоминания и поиск людей перестали бы совпадать с карточкой.
 *
 * FIX-BGCROP. Фон больше не пережимается через canvas в JPEG (именно это
 * стирало анимацию GIF и ломало сохранение крупных картинок о предел data
 * URL), а загружается файлом через BackgroundPicker с выбором рамки.
 * Аватар остаётся на клиентском ужатии: он квадратный, мелкий и анимация в нём
 * не требовалась.
 */

import { useCallback, useEffect, useState } from "react";
import BackgroundPicker from "@/components/profile/BackgroundPicker";
import { bannerImgStyle } from "@/lib/bannerFraming";

interface ServerProfile {
  displayName: string | null;
  avatar: string | null;
  profileBanner: string | null;
}

interface BaseProfile {
  name: string | null;
  username: string | null;
  avatar: string | null;
  profileBanner: string | null;
}

interface GroupOption {
  id: string;
  name: string;
}

const EMPTY: ServerProfile = { displayName: null, avatar: null, profileBanner: null };

/** Ужатие аватара в браузере: сервер ждёт data URL до ~650 КБ. */
async function compressAvatar(file: File, maxSide = 256, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export default function ServerProfileSection() {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [base, setBase] = useState<BaseProfile | null>(null);
  const [profile, setProfile] = useState<ServerProfile>(EMPTY);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /* Общий профиль и список сообществ — одним заходом при открытии раздела. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [meRes, groupsRes] = await Promise.all([
          fetch("/api/profile/me"),
          fetch("/api/groups"),
        ]);
        if (!alive) return;
        if (meRes.ok) {
          const me = (await meRes.json()) as Partial<BaseProfile>;
          setBase({
            name: me.name ?? null,
            username: me.username ?? null,
            avatar: me.avatar ?? null,
            profileBanner: me.profileBanner ?? null,
          });
        }
        if (groupsRes.ok) {
          const raw = (await groupsRes.json()) as unknown;
          const list = Array.isArray(raw)
            ? (raw as GroupOption[])
            : (((raw as { groups?: GroupOption[] }).groups ?? []) as GroupOption[]);
          const options = list
            .filter((g) => g && typeof g.id === "string")
            .map((g) => ({ id: g.id, name: g.name ?? "Сообщество" }));
          if (!alive) return;
          setGroups(options);
          if (options.length > 0) setGroupId((prev) => prev || options[0].id);
        }
      } catch {
        if (alive) setError("Не удалось загрузить данные профиля");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${id}/profile`);
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as Partial<ServerProfile>;
      const next: ServerProfile = {
        displayName: data.displayName ?? null,
        avatar: data.avatar ?? null,
        profileBanner: data.profileBanner ?? null,
      };
      setProfile(next);
      setName(next.displayName ?? "");
    } catch {
      setProfile(EMPTY);
      setName("");
      setError("Не удалось загрузить профиль в этом сообществе");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (groupId) void loadProfile(groupId);
  }, [groupId, loadProfile]);

  async function save(patch: Partial<ServerProfile>) {
    if (!groupId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/groups/${groupId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Не удалось сохранить");
        return;
      }
      setProfile((prev) => ({ ...prev, ...patch }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Ошибка сети при сохранении");
    } finally {
      setSaving(false);
    }
  }

  const effectiveName = (profile.displayName ?? "").trim() || (base?.name ?? "").trim() || "Без имени";
  const effectiveAvatar = profile.avatar ?? base?.avatar ?? null;
  const effectiveBanner = profile.profileBanner ?? base?.profileBanner ?? null;
  const inheritedName = !((profile.displayName ?? "").trim());
  const inheritedAvatar = !profile.avatar;
  const inheritedBanner = !profile.profileBanner;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Профиль на выбранном сервере</h3>
        <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400 mt-1">
          Имя, аватар и фон для одного сообщества. Что не задано — берётся из общего профиля.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Вы пока не состоите ни в одном сообществе.
        </p>
      ) : (
        <>
          <label className="block">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Сообщество</span>
            <select
              id="tz-server-pick"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          {/* Карточка в том же виде, в каком её увидят другие участники. */}
          <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-white/10">
            <div className="relative h-20 bg-gradient-to-r from-violet-500/30 to-cyan-400/30">
              {effectiveBanner && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={effectiveBanner}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={bannerImgStyle(effectiveBanner)}
                />
              )}
            </div>
            <div className="px-4 pb-4 -mt-8">
              <div className="h-16 w-16 rounded-2xl overflow-hidden border-4 border-white dark:border-neutral-900 bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                {effectiveAvatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={effectiveAvatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg font-semibold text-neutral-500 dark:text-neutral-300">
                    {effectiveName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{effectiveName}</p>
              {base?.username && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">@{base.username}</p>
              )}
              <p className="mt-1 text-[11px] text-neutral-400">
                {inheritedName && inheritedAvatar && inheritedBanner
                  ? "Всё взято из общего профиля"
                  : [
                      inheritedName ? "имя" : null,
                      inheritedAvatar ? "аватар" : null,
                      inheritedBanner ? "фон" : null,
                    ].filter(Boolean).length > 0
                    ? `Из общего профиля: ${[
                        inheritedName ? "имя" : null,
                        inheritedAvatar ? "аватар" : null,
                        inheritedBanner ? "фон" : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}`
                    : "Всё задано для этого сообщества"}
              </p>
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Имя в этом сообществе</span>
            <input
              id="tz-server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed === (profile.displayName ?? "")) return;
                if (trimmed && (trimmed.length < 2 || trimmed.length > 50)) {
                  setError("Имя — от 2 до 50 знаков");
                  return;
                }
                void save({ displayName: trimmed || null });
              }}
              placeholder={base?.name ?? "Как в общем профиле"}
              maxLength={50}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white"
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              Ник (@{base?.username ?? "…"}) единый для всей площадки и меняется в общем профиле.
            </span>
          </label>

          <div className="space-y-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Аватар в этом сообществе</span>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full overflow-hidden bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 flex items-center justify-center">
                {effectiveAvatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={effectiveAvatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-neutral-400">нет</span>
                )}
              </div>
              <label className="px-3 py-2 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-xl text-xs font-medium cursor-pointer hover:bg-violet-500/20 transition-colors">
                Загрузить
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const dataUrl = await compressAvatar(file);
                      await save({ avatar: dataUrl });
                    } catch {
                      setError("Не удалось обработать картинку");
                    }
                  }}
                />
              </label>
              {profile.avatar && (
                <button
                  type="button"
                  onClick={() => void save({ avatar: null })}
                  className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                >
                  Из общего профиля
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Фон мини-профиля в этом сообществе</span>
            <BackgroundPicker
              value={profile.profileBanner}
              onChange={(next) => void save({ profileBanner: next })}
              onError={setError}
              aspect={4.5}
              label="Фон"
            />
            {inheritedBanner && base?.profileBanner && (
              <p className="text-[11px] text-neutral-400">Сейчас показывается фон из общего профиля.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setName("");
                void save({ displayName: null, avatar: null, profileBanner: null });
              }}
              className="text-xs text-neutral-400 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors"
            >
              Сбросить к общему профилю
            </button>
            {loading && <span className="text-[11px] text-neutral-400">Загрузка…</span>}
            {saving && <span className="text-[11px] text-neutral-400">Сохранение…</span>}
            {saved && !saving && <span className="text-[11px] text-emerald-500">Сохранено</span>}
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}
