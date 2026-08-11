"use client";

/**
 * TZ.Connect profile settings, rendered inline on the /settings page.
 *
 * These controls used to live in a separate modal opened from the bottom-left
 * gear inside /connect (ProfileSettingsModal). They were moved here so that all
 * of a user's settings live in one place — the "Настройки профиля" page. The
 * gear in /connect now navigates here instead of opening a modal.
 *
 * The component is self-contained: it fetches the current values from
 * /api/profile/me and persists them the same way the old modal did.
 */

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { CITY_NAMES } from "@/lib/cityTimezones";
import GlowAvatar, { GLOW_PRESETS, GlowAvatarUser } from "@/components/ui/GlowAvatar";
import { DayNightMiniPreview } from "@/components/connect/DayNightBackground";
import { getDMSoundEnabled, setDMSoundEnabled, playDMNotification } from "@/lib/dmSound";
import { exportKeysToJSON, importKeysFromJSON } from "@/lib/e2ee";
import { SparklesIcon, FilmIcon, MoonIcon, KeyIcon, UploadIcon, DownloadIcon } from "@/components/ui/ConnectIcons";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { SettingsCard, SettingsGroup, SettingsRow } from "@/components/settings/SettingsUI";

interface ProfileSettings {
  avatarGlowEnabled: boolean;
  avatarGlowColors: string | null;
}

const PRESET_KEYS = Object.keys(GLOW_PRESETS) as (keyof typeof GLOW_PRESETS)[];

function detectPreset(colorsJson: string | null): string | null {
  if (!colorsJson) return "royal";
  try {
    const c = JSON.stringify(JSON.parse(colorsJson));
    for (const key of PRESET_KEYS) {
      if (JSON.stringify(GLOW_PRESETS[key].colors) === c) return key;
    }
  } catch { /* */ }
  return null;
}

export default function ConnectProfileSettings({
  role,
  isPremium = false,
  onGlowSaved,
  sections = "all",
}: {
  role: string;
  /** Оформление профиля — привилегия подписки, а не должности. */
  isPremium?: boolean;
  onGlowSaved?: (settings: ProfileSettings) => void;
  /**
   * Какие карточки показывать.
   *
   * Карточка «Оформление» по смыслу относится к разделу «Внешний вид», а
   * остальные (присутствие, звук, шифрование) — к TZ.Connect. Разбивать файл
   * на два компонента ради этого нельзя: у них общее состояние и одна запись
   * в /api/profile/me. Поэтому компонент один, а разделы выбираются пропом;
   * каждый экземпляр сам грузит свои значения и сам их сохраняет.
   */
  sections?: "all" | "connect" | "appearance";
}) {
  const showConnect = sections !== "appearance";
  const showAppearance = sections !== "connect";
  const { data: session } = useSession();
  const sessionUser = session?.user as { id?: string; name?: string; username?: string } | undefined;
  /* Свечение аватара, анимированный баннер и фон дня и ночи — платные
     возможности. Раньше здесь стояла проверка должности, из-за чего
     оплатившие подписку их не видели, а администраторы получали даром.
     Администратор оставлен, чтобы возможность было чем проверить. */
  const isPrivileged = isPremium || role === "ADMIN";

  const [glowEnabled, setGlowEnabled] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [dayNightEnabled, setDayNightEnabled] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("tz-connect-daynight") === "true",
  );
  const [dayNightOpacity, setDayNightOpacity] = useState<number>(() =>
    typeof window !== "undefined" ? parseInt(localStorage.getItem("tz-connect-daynight-opacity") ?? "15", 10) : 15,
  );
  const [selectedPreset, setSelectedPreset] = useState<string | null>("royal");
  const [customColors, setCustomColors] = useState<string[]>([...GLOW_PRESETS.royal.colors]);
  const [useCustom, setUseCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<string>("online");
  const [customStatus, setCustomStatus] = useState<string>("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [city, setCity] = useState<string>("");
  const [dmSoundOn, setDmSoundOn] = useState(true);
  const [activityEnabled, setActivityEnabled] = useState(false); // FIX-ACT
  const [activitySaving, setActivitySaving] = useState(false); // FIX-ACT

  useEffect(() => { setDmSoundOn(getDMSoundEnabled()); }, []);

  useEffect(() => {
    fetch("/api/profile/me").then((r) => r.json()).then((d) => {
      if (typeof d.avatarGlowEnabled === "boolean") setGlowEnabled(d.avatarGlowEnabled);
      if ("avatar" in d) setAvatar(d.avatar ?? null);
      if (d.avatarGlowColors) {
        setSelectedPreset(detectPreset(d.avatarGlowColors));
        try {
          const p = JSON.parse(d.avatarGlowColors) as string[];
          if (Array.isArray(p) && p.length >= 2) {
            setCustomColors(p);
            setUseCustom(detectPreset(d.avatarGlowColors) === null);
          }
        } catch { /* */ }
      }
      if (d.statusType) setStatusType(d.statusType);
      if (d.customStatus) setCustomStatus(d.customStatus);
      if (d.profileBanner) setBannerUrl(d.profileBanner);
      if (d.city) setCity(d.city);
      if (typeof d.activityEnabled === "boolean") setActivityEnabled(d.activityEnabled); // FIX-ACT
    }).catch(() => {});
  }, []);

  const activeColors = useCustom ? customColors : GLOW_PRESETS[(selectedPreset as keyof typeof GLOW_PRESETS) ?? "royal"].colors;

  const previewUser: GlowAvatarUser = {
    id: sessionUser?.id ?? "",
    name: sessionUser?.name ?? "",
    role,
    avatar,
    avatarGlowEnabled: glowEnabled,
    avatarGlowColors: JSON.stringify(activeColors),
  };

  function toggleDmSound() {
    const next = !dmSoundOn;
    setDmSoundOn(next);
    setDMSoundEnabled(next);
    if (next) playDMNotification();
  }

  async function save() {
    localStorage.setItem("tz-connect-daynight", String(dayNightEnabled));
    localStorage.setItem("tz-connect-daynight-opacity", String(dayNightOpacity));
    window.dispatchEvent(new CustomEvent("tz-daynight-change", {
      detail: { enabled: dayNightEnabled, opacity: dayNightOpacity },
    }));

    setSaving(true);
    setError(null);
    try {
      const patchBody: Record<string, unknown> = {};
      if (isPrivileged) {
        patchBody.avatarGlowEnabled = glowEnabled;
        patchBody.avatarGlowColors = glowEnabled ? activeColors : null;
        patchBody.profileBanner = bannerUrl;
      }
      patchBody.city = city || null;
      const res = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка сохранения");
      } else {
        onGlowSaved?.({ avatarGlowEnabled: data.avatarGlowEnabled, avatarGlowColors: data.avatarGlowColors });
        setSuccessToast("Настройки TZ.Connect сохранены!");
        setTimeout(() => setSuccessToast(null), 3500);
      }
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  function addCustomColor() {
    if (customColors.length < 6) setCustomColors([...customColors, "#ffffff"]);
  }
  function removeCustomColor(i: number) {
    if (customColors.length > 2) setCustomColors(customColors.filter((_, idx) => idx !== i));
  }
  function updateCustomColor(i: number, val: string) {
    const next = [...customColors];
    next[i] = val;
    setCustomColors(next);
  }

  return (
    <div className="space-y-4">
      {showConnect && (
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
            TZ.Connect
            <InfoTooltip text="Настройки мессенджера, перенесённые из панели TZ.Connect (кнопка-шестерёнка снизу слева)." side="bottom" />
          </h2>
        </div>
      )}

      {/* ── Карточка «Присутствие»: превью, статус, кастомный статус, город. ── */}
      {showConnect && (
      <SettingsCard title="Присутствие">
        {/* Preview */}
        <div className="flex items-center gap-4 p-4 bg-neutral-50 dark:bg-white/5 rounded-xl border border-neutral-200 dark:border-white/5">
          <div className="flex-shrink-0">
            <GlowAvatar user={previewUser} size={48} />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-white">{sessionUser?.name}</p>
            <p className="text-xs text-neutral-400">@{sessionUser?.username ?? ""}</p>
            {isPrivileged && (
              <p className="text-[11px] text-violet-500 dark:text-violet-400 mt-1 flex items-center gap-1">
                {glowEnabled ? <><SparklesIcon size={14} tone="active" /> Свечение активно</> : "Свечение выключено"}
              </p>
            )}
          </div>
        </div>

        <SettingsGroup>
          <SettingsRow label="Статус">
            <div className="flex flex-wrap justify-end gap-2">
              {([["online", "В сети", "bg-green-500"], ["away", "Нет на месте", "bg-yellow-500"], ["dnd", "Не беспокоить", "bg-red-500"], ["invisible", "Невидимка", "bg-neutral-400"]] as const).map(([key, label, color]) => (
                <button key={key} onClick={async () => { const prev = statusType; setStatusType(key); setStatusLoading(true); try { const res = await fetch("/api/profile/status", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusType: key }) }); if (!res.ok) { const d = await res.json().catch(() => ({} as { error?: string })); setStatusType(prev); setError(d.error ?? "Не удалось сохранить статус"); } else { setError(null); } } catch { setStatusType(prev); setError("Ошибка сети"); } setStatusLoading(false); }} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all ${statusType === key ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400" : "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300"}`}>
                  <span className={`w-2 h-2 rounded-full ${color}`} />
                  {label}
                </button>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow label="Кастомный статус">
            <div className="flex gap-2">
              <input
                type="text"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder="Кастомный статус..."
                maxLength={80}
                className="flex-1 px-3 py-1.5 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900 dark:text-white"
              />
              <button
                onClick={async () => { setStatusLoading(true); try { const res = await fetch("/api/profile/status", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customStatus: customStatus.trim() || null }) }); if (!res.ok) { const d = await res.json().catch(() => ({} as { error?: string })); setError(d.error ?? "Не удалось сохранить статус"); } else { setError(null); setSuccessToast("Статус сохранён"); setTimeout(() => setSuccessToast(null), 2000); } } catch { setError("Ошибка сети"); } setStatusLoading(false); }}
                disabled={statusLoading}
                className="px-3 py-1.5 bg-violet-500 dark:bg-cyan-500 text-white dark:text-neutral-900 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {statusLoading ? "..." : "OK"}
              </button>
            </div>
          </SettingsRow>
          <SettingsRow label="Город" hint="На стартовом экране появятся часы вашего города. Если не выбран — часов нет.">
            <select
              value={city}
              onChange={async (e) => {
                // FIX-SET: город сохраняется сразу при выборе — раньше выбор терялся,
                // если не нажать кнопку «Сохранить» в самом низу страницы, а ошибка
                // сервера никак не показывалась.
                const next = e.target.value;
                setCity(next);
                try {
                  const res = await fetch("/api/profile/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: next || null }) });
                  if (!res.ok) {
                    const d = await res.json().catch(() => ({} as { error?: string }));
                    setError(d.error ?? "Не удалось сохранить город");
                  } else {
                    setError(null);
                    setSuccessToast("Город сохранён");
                    setTimeout(() => setSuccessToast(null), 2000);
                  }
                } catch { setError("Ошибка сети"); }
              }}
              className="px-3 py-1.5 bg-neutral-50 dark:bg-white dark:text-neutral-900 border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900"
            >
              <option value="" className="bg-white text-neutral-900">Не выбран</option>
              {CITY_NAMES.map((c) => (
                <option key={c} value={c} className="bg-white text-neutral-900">{c}</option>
              ))}
            </select>
          </SettingsRow>
        </SettingsGroup>
      </SettingsCard>
      )}

      {/* ── Карточка «Оформление»: баннер, свечение аватара, фон дня и ночи. ──
          Всё это — привилегия Premium (или ADMIN), см. isPrivileged выше.
          Карточка показывается в разделе «Внешний вид», см. проп sections. */}
      {showAppearance && (
      <SettingsCard title="Оформление">
        {!isPrivileged && (
          <p className="text-xs text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2">
            Свечение аватара, анимированный баннер и фон дня и ночи входят в Premium.
          </p>
        )}

        {isPrivileged && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5">
              <FilmIcon size={18} tone="active" /> Анимированный профиль
              <InfoTooltip text="Загрузите GIF или изображение — оно станет анимированным фоном вашего профиля." />
            </h3>
            {bannerUrl && (
              <div className="relative h-24 rounded-xl overflow-hidden border border-neutral-200 dark:border-white/10">
                <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                <button
                  onClick={() => setBannerUrl(null)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}
            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={bannerUploading}
              className="px-3 py-2 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-xl text-xs font-medium hover:bg-violet-500/20 transition-colors disabled:opacity-50"
            >
              {bannerUploading ? "Загрузка..." : bannerUrl ? "Заменить фон" : "Загрузить фон"}
            </button>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*,.gif"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBannerUploading(true);
                const fd = new FormData();
                fd.append("file", file);
                fd.append("type", "banner");
                try {
                  const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
                  const data = await res.json();
                  if (data.url) setBannerUrl(data.url);
                  else setError("Ошибка загрузки");
                } catch { setError("Ошибка сети"); }
                setBannerUploading(false);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {isPrivileged && (<>
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-white/5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white">
              Свечение аватара
              <InfoTooltip text="Анимированная переливающаяся обводка вокруг вашего аватара." />
            </p>
            <button
              onClick={() => setGlowEnabled(!glowEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${glowEnabled ? "bg-violet-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${glowEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          <AnimatePresence>
            {glowEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden space-y-4"
              >
                {/* Presets */}
                <div>
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Готовые палитры</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_KEYS.map((key) => {
                      const preset = GLOW_PRESETS[key];
                      const isActive = !useCustom && selectedPreset === key;
                      return (
                        <button
                          key={key}
                          onClick={() => { setSelectedPreset(key); setUseCustom(false); }}
                          className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${isActive ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10" : "border-neutral-200 dark:border-white/10 hover:border-violet-300 dark:hover:border-violet-500/50 hover:bg-neutral-50 dark:hover:bg-white/5"}`}
                        >
                          <div className="flex rounded-full overflow-hidden w-full h-3">
                            {preset.colors.slice(0, 5).map((c, i) => (
                              <div key={i} style={{ background: c, flex: 1 }} />
                            ))}
                          </div>
                          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom colors */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Своя палитра</p>
                    <button
                      onClick={() => setUseCustom(!useCustom)}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${useCustom ? "border-violet-500 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10" : "border-neutral-200 dark:border-white/10 text-neutral-400 hover:border-violet-300"}`}
                    >
                      {useCustom ? "✓ Используется" : "Использовать"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {customColors.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={c}
                          onChange={(e) => { updateCustomColor(i, e.target.value); setUseCustom(true); }}
                          className="w-8 h-8 rounded-lg border border-neutral-200 dark:border-white/10 cursor-pointer bg-transparent"
                        />
                        <div className="flex-1 h-3 rounded-full" style={{ background: c }} />
                        <span className="text-xs font-mono text-neutral-400 w-16">{c}</span>
                        {customColors.length > 2 && (
                          <button onClick={() => removeCustomColor(i)} className="text-neutral-300 dark:text-neutral-600 hover:text-red-400 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    ))}
                    {customColors.length < 6 && (
                      <button onClick={addCustomColor} className="text-xs text-neutral-400 hover:text-violet-500 transition-colors flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Добавить цвет ({customColors.length}/6)
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>)}

        {isPrivileged && (
          <div className="pt-2 border-t border-neutral-100 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-900 dark:text-white flex items-center gap-1.5">
                <MoonIcon size={18} tone="active" /> Фон дня и ночи
                <InfoTooltip text="Живое небо и цифровой город на фоне окна чата, меняются в зависимости от времени суток." />
              </p>
              <button
                onClick={() => setDayNightEnabled(!dayNightEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${dayNightEnabled ? "bg-cyan-500 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${dayNightEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            <AnimatePresence>
              {dayNightEnabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-3"
                >
                  <div className="relative h-20 rounded-xl overflow-hidden border border-neutral-200 dark:border-white/10">
                    <DayNightMiniPreview opacity={dayNightOpacity} />
                    <div className="absolute inset-0 flex items-end p-2">
                      <span className="text-[10px] text-white/60 font-mono bg-black/30 px-1.5 py-0.5 rounded">
                        предпросмотр · {new Date().getHours()}:{String(new Date().getMinutes()).padStart(2, "0")}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">Прозрачность фона</p>
                      <span className="text-xs font-mono text-cyan-500 dark:text-cyan-400">{dayNightOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={35}
                      step={1}
                      value={dayNightOpacity}
                      onChange={(e) => setDayNightOpacity(+e.target.value)}
                      className="w-full accent-cyan-500"
                    />
                    <div className="flex justify-between text-[10px] text-neutral-400">
                      <span>Едва заметно (5%)</span>
                      <span>Атмосферно (35%)</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </SettingsCard>
      )}

      {/* ── Карточка «Звук и активность»: звук сообщений и показ активности. ── */}
      {showConnect && (
      <SettingsCard title="Звук и активность">
        <SettingsGroup>
          <SettingsRow label="Звук сообщений" hint="Проигрывать звук при получении личного сообщения.">
            <button
              onClick={toggleDmSound}
              className={`relative w-11 h-6 rounded-full transition-colors ${dmSoundOn ? "bg-violet-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
              aria-label="Звук сообщений"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${dmSoundOn ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </SettingsRow>
          <SettingsRow
            label="Показывать мою активность в статусе"
            hint="Работает только в приложении для ПК. Раз в 30 секунд проверяются запущенные известные программы (Spotify, игры и т.д.) — без чтения окон и названий треков. Ручной статус всегда важнее. Например: «Слушает музыку в Spotify»."
          >
            <input
              type="checkbox"
              checked={activityEnabled}
              disabled={activitySaving}
              onChange={async (e) => {
                const next = e.target.checked;
                setActivityEnabled(next);
                setActivitySaving(true);
                // FIX-SET: ошибка сервера (например, не выполнен prisma db push) больше
                // не проглатывается — галочка откатывается и причина видна на экране.
                try {
                  const res = await fetch("/api/profile/activity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                  if (!res.ok) {
                    const d = await res.json().catch(() => ({} as { error?: string }));
                    setActivityEnabled(!next);
                    setError(d.error ?? "Не удалось сохранить настройку активности");
                  } else {
                    setError(null);
                  }
                } catch {
                  setActivityEnabled(!next);
                  setError("Ошибка сети");
                }
                setActivitySaving(false);
              }}
              className="w-4 h-4 accent-violet-500 dark:accent-cyan-500"
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsCard>
      )}

      {/* ── Карточка «Шифрование»: экспорт и импорт ключей E2EE. ── */}
      {showConnect && (
      <SettingsCard title="Шифрование">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5">
          <KeyIcon size={18} tone="active" /> Шифрование E2EE
          <InfoTooltip text="Экспорт и импорт ключей, чтобы расшифровывать старые сообщения на новом устройстве." />
        </h3>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const json = await exportKeysToJSON();
              if (!json) { setError("Ключи не найдены"); return; }
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = "tz-e2ee-keys.json"; a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-xl text-xs font-medium hover:bg-violet-500/20 transition-colors"
          >
            <UploadIcon size={16} tone="active" /> Экспорт ключей
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 bg-green-500/10 text-green-600 dark:text-green-400 rounded-xl text-xs font-medium hover:bg-green-500/20 transition-colors cursor-pointer">
            <DownloadIcon size={16} tone="active" /> Импорт ключей
            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const text = await f.text();
              const ok = await importKeysFromJSON(text);
              if (ok) { setError(null); setSuccessToast("��лючи восстановлены!"); setTimeout(() => setSuccessToast(null), 3500); }
              else setError("Неверный формат файла ключей");
              e.target.value = "";
            }} />
          </label>
        </div>
      </SettingsCard>
      )}

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      <div className="pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-violet-600 dark:bg-cyan-600 hover:bg-violet-500 dark:hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving
            ? "Сохранение..."
            : sections === "appearance"
              ? "Сохранить оформление"
              : "Сохранить настройки TZ.Connect"}
        </button>
      </div>

      {successToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-green-500 text-white text-sm rounded-xl shadow-lg">
          {successToast}
        </div>
      )}
    </div>
  );
}
