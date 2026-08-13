"use client";

import { useSession, signOut } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP
import { useTheme } from "@/components/Providers";
import { useConnectTheme } from "@/contexts/ThemeContext";
import { useLang } from "@/lib/i18n"; // FIX-I18N
import { useVoice, REPLAY_MAX_SECONDS, REPLAY_MIN_SECONDS, EQ_BANDS, EQ_MIN_DB, EQ_MAX_DB, EQ_PRESET_ORDER, EQ_PRESET_LABELS, MIC_GAIN_MIN_DB, MIC_GAIN_MAX_DB } from "@/contexts/VoiceContext";
import { getDesktopApi, type DesktopConfig } from "@/lib/desktop";
import ConnectProfileSettings from "@/components/profile/ConnectProfileSettings";
import ChatAppearanceSettings from "@/components/profile/ChatAppearanceSettings";
import PremiumAppearanceSettings from "@/components/profile/PremiumAppearanceSettings"; // PREMIUM-SKIN
import ChatShowcase from "@/components/profile/ChatShowcase";
import ServerProfileSection from "@/components/profile/ServerProfileSection";
import IgnoreListSection from "@/components/profile/IgnoreListSection";
import DesktopCachePanel from "@/components/settings/DesktopCachePanel";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { cacheNotifyPrefs } from "@/lib/notifyPrefs";
import { hasPremium } from "@/lib/premium";
import { PREMIUM_COMPARISON, PREMIUM_KEY_FEATURES, PREMIUM_MAIN_ADVANTAGE } from "@/lib/premiumFeatures";
import PremiumFeatureIcon from "@/components/premium/PremiumFeatureIcon";
import {
  eventToBrowserKeys,
  browserKeysHaveMainKey,
  formatBrowserKeys,
  eventToAccelerator,
  formatAccelerator,
} from "@/lib/keybinds";

/** «1 день», «2 дня», «5 дней» — счётчик подписки читают глазами, не парсером. */
function pluralDays(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last > 1 && last < 5) return "дня";
  if (last === 1) return "день";
  return "дней";
}

interface ProfileData {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string | null;
  role: string;
  isPremium: boolean;
  showOnline: boolean;
  emailVerified: boolean;
  bio: string | null;
  socialLinks: string | null;
  customStatus: string | null;
  statusEmoji: string | null;
  privacyOnline: string;
  privacyFriends: string;
  privacyEmail: boolean;
  notifySound: boolean;
  notifyPush: boolean;
  createdAt: string;
  lastSeen: string | null;
  _count: { messages: number; friendsSent: number; friendsReceived: number; gamePlayers: number };
  /** Сведения о подписке — считает сервер (GET /api/profile). */
  premium?: {
    active: boolean;
    source: "none" | "role" | "subscription";
    plan: string | null;
    startedAt: string | null;
    /** null — бессрочно или премиум по роли. */
    expiresAt: string | null;
    /** Полных дней до конца срока; null — срока нет, отрицательное — срок вышел. */
    daysLeft?: number | null;
    granted: boolean;
  };
  /** VPN-PLAN: отдельная подписка «только VPN» — считает сервер (GET /api/profile). */
  vpn?: {
    /** Действует ли отдельная подписка на VPN прямо сейчас. */
    active: boolean;
    /** null — бессрочно. */
    expiresAt: string | null;
    daysLeft?: number | null;
    /** Доступ к VPN есть и без отдельной подписки — его даёт Premium. */
    viaPremium: boolean;
  };
}

interface PaymentMethodPublic {
  id: "sbp" | "acquiring";
  label: string;
  fields: { label: string; value: string }[];
  link?: string;
  comment?: string;
}

interface PaymentMethodsResponse {
  priceMonth: string;
  currency: string;
  methods: PaymentMethodPublic[];
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  ADMIN:      { label: "Администратор", color: "text-red-400" },
  EDITOR:     { label: "Редактор",      color: "text-violet-400" },
  CONSULTANT: { label: "Консультант",   color: "text-blue-400" },
  USER:       { label: "Пользователь",  color: "text-gray-400" },
};

/* Human-readable hint for the noise suppression engine's load status. */
const NS_STATUS_HINT: Record<string, string> = {
  idle:        "Активируется при входе в голосовой канал.",
  loading:     "Загрузка нейросети…",
  ready:       "Активно — шум подавляется в реальном времени.",
  error:       "Не удалось запустить — временно используется шумодав браузера.",
  unsupported: "Не поддерживается этим устройством — используется шумодав браузера.",
};

/* EQ: подпись усиления полосы. Знак обязателен: «3 дБ» и «−3 дБ» на глаз
   различаются только им, а без плюса подъём читается как «просто значение». */
function formatDb(db: number): string {
  return `${db > 0 ? "+" : ""}${db} дБ`;
}

/* ─── Settings categories (Discord-style sidebar) ─── */
type CategoryId =
  | "account" | "profile" | "privacy"
  | "voice" | "notifications" | "appearance" | "premium" | "connect";

function Icon({ path }: { path: React.ReactNode }) {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const CATEGORIES: { group: string; items: { id: CategoryId; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Настройки пользователя",
    items: [
      { id: "account",  label: "Моя учётная запись", icon: <Icon path={<><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>} /> },
      { id: "profile",  label: "Профиль",             icon: <Icon path={<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M14 9h4M14 13h4M6 16h8" /></>} /> },
      { id: "privacy",  label: "Конфиденциальность",  icon: <Icon path={<path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z" />} /> },
    ],
  },
  {
    group: "Приложение",
    items: [
      { id: "voice",         label: "Голос и бинды",  icon: <Icon path={<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>} /> },
      { id: "connect",       label: "TZ.Connect",     icon: <Icon path={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />} /> },
      { id: "notifications", label: "Уведомления",    icon: <Icon path={<path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3C7.7 6.2 6 8.4 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1" />} /> },
      { id: "appearance",    label: "Внешний вид",    icon: <Icon path={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>} /> },
      { id: "premium",       label: "Подписки",       icon: <Icon path={<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3.4 1.1-6.5L2.6 9.8l6.5-.9L12 3z" />} /> },
    ],
  },
];

/* ─── Primitives ─── */

/* FIX-UI3: громоздкий блок «Порядок подключения» удалён — краткое описание
   цепочки перенесено во всплывающую подсказку «?» раздела «Шумоподавление». */

/* FIX-UI2: тест аудиоустройств — проверка вывода звука и микрофона.
 * FIX-AUDIO-DEV: тест использует выбранные пользователем устройства ввода/вывода,
 * поэтому проверяет именно то, что будет работать в голосовом канале. */
function AudioDeviceTest() {
  const { micDeviceId, outputDeviceId } = useVoice();
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micPeak, setMicPeak] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const micStopRef = useRef<(() => void) | null>(null);

  // Останавливаем тест микрофона при уходе со страницы.
  useEffect(() => () => { micStopRef.current?.(); }, []);

  const playTestSound = () => {
    const a = new Audio("/sounds/connection.mp3") as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    a.volume = 0.6;
    // FIX-AUDIO-DEV: проигрываем через выбранное устройство вывода (если поддерживается).
    if (outputDeviceId && typeof a.setSinkId === "function") {
      a.setSinkId(outputDeviceId).catch(() => {});
    }
    a.play().catch(() => {});
  };

  const toggleMicTest = async () => {
    if (micStopRef.current) {
      micStopRef.current();
      micStopRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
      setMicPeak(0);
      return;
    }
    setMicError(null);
    try {
      // Те же constraints, что и в голосовом канале, — тест честный.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          // FIX-AUDIO-DEV: тестируем именно выбранный микрофон.
          ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
        },
      });
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let peak = 0;
      const iv = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        const level = Math.min(100, Math.round(avg * 2.5));
        peak = Math.max(peak * 0.96, level);
        setMicLevel(level);
        setMicPeak(Math.round(peak));
      }, 80);
      micStopRef.current = () => {
        window.clearInterval(iv);
        stream.getTracks().forEach(t => t.stop());
        ctx.close().catch(() => {});
      };
      setMicTesting(true);
    } catch {
      setMicError("Не удалось получить доступ к микрофону. Проверьте разрешения системы и браузера.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
            Динамики / наушники
            <InfoTooltip text="Проигрывает звук подключения через текущее устройство вывода." />
          </p>
        </div>
        <button
          type="button"
          onClick={playTestSound}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400 hover:bg-violet-500/20 dark:hover:bg-cyan-500/20 transition-colors"
        >
          Проверить звук
        </button>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-neutral-900 dark:text-white font-medium">Микрофон</p>
            <p className="text-xs text-neutral-400 mt-0.5">{micTesting ? "Говорите — полоса должна реагировать на голос." : "Живой индикатор уровня сигнала с микрофона."}</p>
          </div>
          <button
            type="button"
            onClick={toggleMicTest}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              micTesting
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400 hover:bg-violet-500/20 dark:hover:bg-cyan-500/20"
            }`}
          >
            {micTesting ? "Остановить" : "Проверить микрофон"}
          </button>
        </div>
        {micTesting && (
          <div className="relative h-2 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 dark:to-cyan-400 transition-[width] duration-75"
              style={{ width: `${micLevel}%` }}
            />
            <div className="absolute inset-y-0 w-0.5 bg-neutral-500 dark:bg-white/60" style={{ left: `${micPeak}%` }} />
          </div>
        )}
        {micError && <p className="text-xs text-red-400">{micError}</p>}
      </div>
    </div>
  );
}

/* ── FIX-CAM-DEV: выбор устройства камеры ───────────────────────────────────────
 * Список камер обновляется при монтировании и при подключении/отключении
 * устройств. Если камера уже включена в канале — смена устройства применяется
 * сразу (поток перезапускается на новой камере). */
function CameraDeviceSelect() {
  const { cameraDevices, cameraDeviceId, setCameraDevice, refreshCameraDevices, isCameraOn } = useVoice();

  useEffect(() => {
    void refreshCameraDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refreshCameraDevices(); };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshCameraDevices]);

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
      <div>
        <p className="text-sm text-neutral-900 dark:text-white font-medium">Устройство камеры</p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {isCameraOn
            ? "Смена устройства применится сразу — камера перезапустится."
            : cameraDevices.length
              ? "Выбранная камера будет использована при следующем включении."
              : "Названия камер появляются после первого разрешения на доступ к камере."}
        </p>
      </div>
      <select
        value={cameraDeviceId ?? ""}
        onChange={(e) => { void setCameraDevice(e.target.value || null); }}
        className="w-full text-sm rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-800 px-3 py-2 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 dark:focus:ring-cyan-500/40"
        aria-label="Выбор камеры"
      >
        <option value="">Камера по умолч��нию</option>
        {cameraDevices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ── FIX-AUDIO-DEV: выбор микрофона и устройства вывода (наушники/динамики) ──
 * Списки обновляются при монтировании и при подключении/отключении устройств.
 * Смена микрофона применяется сразу, если вы уже в голосовом канале; смена
 * устройства вывода применяется всегда сразу (голос, звук трансляции, эффекты).
 * Названия устройств появляются только после разрешения на доступ к микрофону,
 * поэтому мы один раз запрашиваем доступ, чтобы список был осмысленным. */
function AudioDeviceSelect() {
  const {
    inputDevices, outputDevices,
    micDeviceId, outputDeviceId,
    setMicDevice, setOutputDevice, refreshAudioDevices,
    micGainDb, setMicGain,
    isConnected,
  } = useVoice();

  // Устройство вывода можно выбрать только там, где браузер поддерживает setSinkId.
  // Проверяем после монтирования, чтобы серверный и клиентский рендер совпадали.
  const [outputSelectable, setOutputSelectable] = useState(false);
  useEffect(() => {
    setOutputSelectable(typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function");
  }, []);

  useEffect(() => {
    void refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refreshAudioDevices(); };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshAudioDevices]);

  // Без разрешения на микрофон браузер отдаёт устройства без названий. Один
  // короткий запрос доступа наполняет список читаемыми метками.
  const revealLabels = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      await refreshAudioDevices();
    } catch { /* пользователь отклонил — оставляем как есть */ }
  };

  const labelsMissing = inputDevices.length === 0 || inputDevices.every(d => !d.label || /^Микрофон \d+$/.test(d.label));

  const selectClass = "w-full text-sm rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-800 px-3 py-2 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 dark:focus:ring-cyan-500/40";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
        <div>
          <p className="text-sm text-neutral-900 dark:text-white font-medium">Микрофон</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {isConnected
              ? "Смена применится сразу — микрофон переключится без выхода из канала."
              : "Выбранный микрофон будет использован при входе в голосовой канал."}
          </p>
        </div>
        <select
          value={micDeviceId ?? ""}
          onChange={(e) => { void setMicDevice(e.target.value || null); }}
          className={selectClass}
          aria-label="Выбор микрофона"
        >
          <option value="">Микрофон по умолчанию</option>
          {inputDevices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>

        {/* Усиление — одной строкой под выбором устройства: подпись, ползунок,
            значение. Отдельная карточка со заголовком и пояснением заняла бы
            пол-экрана ради одного числа. */}
        <div className="flex items-center gap-2.5 pt-0.5">
          <span className="text-xs text-neutral-500 dark:text-gray-400 shrink-0 inline-flex items-center gap-1">
            Усиление
            <InfoTooltip text="Поднимает уровень тихого микрофона. Применяется сразу и запоминается для этого устройства. Слишком большое усиление вытягивает вместе с голосом шум и может дать перегруз — прибавляйте до нужной громкости, не больше." />
          </span>
          <input
            type="range"
            min={MIC_GAIN_MIN_DB}
            max={MIC_GAIN_MAX_DB}
            step={1}
            value={micGainDb}
            onChange={(e) => setMicGain(Number(e.target.value))}
            className="flex-1 accent-violet-600 dark:accent-cyan-500"
            aria-label="Усиление микрофона в децибелах"
          />
          <button
            type="button"
            onClick={() => setMicGain(0)}
            title="Вернуть 0 дБ"
            className="w-[62px] shrink-0 text-right text-xs font-semibold text-violet-600 dark:text-cyan-400 tabular-nums hover:underline"
          >
            {micGainDb > 0 ? "+" : ""}{micGainDb} дБ
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
        <div>
          <p className="text-sm text-neutral-900 dark:text-white font-medium">Наушники / динамики</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {outputSelectable
              ? "Устройство вывода для голоса собеседников, звука трансляций и эффектов. Применяется сразу."
              : "Ваш браузер не поддерживает выбор устройства вывода — используется системное по умолчанию."}
          </p>
        </div>
        <select
          value={outputDeviceId ?? ""}
          onChange={(e) => { void setOutputDevice(e.target.value || null); }}
          className={selectClass}
          aria-label="Выбор устройства вывода"
          disabled={!outputSelectable}
        >
          <option value="">Устройство вывода по умолчанию</option>
          {outputDevices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>

      {labelsMissing && (
        <button
          type="button"
          onClick={() => { void revealLabels(); }}
          className="text-xs font-medium text-violet-600 dark:text-cyan-400 hover:underline"
        >
          Показать названия устройств (запросить доступ к микрофону)
        </button>
      )}
    </div>
  );
}

/* FIX-VOICE-UI: dense — компактный вариант секции (меньше отступы) для вкладки «Голос и бинды». */
function Section({ title, subtitle, info, dense, children }: { title: string; subtitle?: string; info?: string; dense?: boolean; children: React.ReactNode }) {
  return (
    <div className={`bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 ${dense ? "rounded-xl p-4 space-y-3" : "rounded-2xl p-6 space-y-5"}`}>
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
          {title}
          {info && <InfoTooltip text={info} side="bottom" />}
        </h2>
        {subtitle && <p className="text-xs text-neutral-500 dark:text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-gray-400">
        {label}
        {info && <InfoTooltip text={info} />}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [reveal, setReveal] = useState(false);
  const isPassword = props.type === "password";
  const baseClass = "w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-violet-500 dark:focus:border-cyan-500 text-sm transition-colors";
  if (!isPassword) {
    return <input {...props} className={baseClass} />;
  }
  return (
    <div className="relative">
      <input
        {...props}
        type={reveal ? "text" : "password"}
        className={baseClass + " pr-11"}
      />
      <button
        type="button"
        onClick={() => setReveal((v) => !v)}
        title={reveal ? "Скрыть пароль" : "Показать пароль"}
        aria-label={reveal ? "Скрыть пароль" : "Показать пароль"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white transition-colors"
      >
        {reveal ? (
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        ) : (
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        )}
      </button>
    </div>
  );
}

function SaveButton({ loading, label = "Сохранить" }: { loading: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="px-5 py-2 bg-violet-600 dark:bg-cyan-600 hover:bg-violet-500 dark:hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
    >
      {loading ? "Сохранение..." : label}
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={label}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? "bg-violet-600 dark:bg-cyan-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-lg ${
        type === "success"
          ? "bg-green-500 text-white"
          : "bg-red-500 text-white"
      }`}
    >
      {message}
    </motion.div>
  );
}

/* ─── Keybind recorder ─── */
// A small button that, when clicked, listens for the next key combination and
// hands it to `onCapture`. `onCapture` returns true once it accepts a combo
// (i.e. a real key besides modifiers was pressed), which stops recording.
function KeybindRecorder({
  value,
  onCapture,
  onClear,
  disabled,
}: {
  value: string;
  onCapture: (e: KeyboardEvent) => boolean;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      if (onCapture(e)) setRecording(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, onCapture]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setRecording((r) => !r)}
        className={`min-w-[8rem] px-4 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 ${
          recording
            ? "border-violet-500 dark:border-cyan-500 text-violet-600 dark:text-cyan-400 bg-violet-500/10 dark:bg-cyan-500/10 animate-pulse"
            : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-neutral-900 dark:text-white hover:border-violet-400 dark:hover:border-cyan-500/60"
        }`}
      >
        {recording ? "Нажмите клавиши…" : value}
      </button>
      {onClear && !disabled && (
        <button
          type="button"
          onClick={onClear}
          className="px-3 py-2 text-xs text-neutral-500 dark:text-gray-400 hover:text-red-500 transition-colors"
          title="Очистить бинд"
        >
          Очистить
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { lang, setLang } = useLang(); // FIX-I18N
  const { lightVariant, toggleLightVariant } = useConnectTheme();
  const voice = useVoice();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  /* Navigation */
  const [activeCat, setActiveCat] = useState<CategoryId>("account");
  const [mobileContentOpen, setMobileContentOpen] = useState(false);

  /* PREMIUM-PAY: способы оплаты подписки (заполняются администратором). */
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsResponse | null>(null);

  /* Desktop shell config (global hotkeys) */
  const [desktopCfg, setDesktopCfg] = useState<DesktopConfig | null>(null);
  const isDesktop = getDesktopApi() !== null;

  // Form states
  const [nameForm, setNameForm] = useState({ name: "", username: "" });
  const [emailForm, setEmailForm] = useState({ email: "" });
  const [passForm, setPassForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [bioForm, setBioForm] = useState("");
  const [statusForm, setStatusForm] = useState({ customStatus: "", statusEmoji: "" });
  const [linksForm, setLinksForm] = useState({ telegram: "", vk: "", github: "", website: "" });
  const [privacyForm, setPrivacyForm] = useState({ privacyOnline: "everyone", privacyFriends: "everyone", privacyEmail: false });
  const [notifyForm, setNotifyForm] = useState({ notifySound: true, notifyPush: true });
  const [showOnline, setShowOnline] = useState(true);
  const [deletePassword, setDeletePassword] = useState("");

  // Loading states
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPass, setSavingPass] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  /* Одна неудачная загрузка «залипала» навсегда: флаг ставился в true и не
     сбрасывался, поэтому после единственного сбоя вместо аватара до конца
     сессии показывалась буква. Сбрасываем при смене адреса картинки. */
  const profileAvatarUrl = profile?.avatar ?? null;
  useEffect(() => { setAvatarError(false); }, [profileAvatarUrl]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin?callbackUrl=/settings");
  }, [status, router]);

  useEffect(() => {
    if (session?.user) {
      fetch("/api/profile")
        .then((r) => r.json())
        .then((data) => {
          setProfile(data);
          setNameForm({ name: data.name, username: data.username });
          setEmailForm({ email: data.email });
          setBioForm(data.bio || "");
          setStatusForm({ customStatus: data.customStatus || "", statusEmoji: data.statusEmoji || "" });
          const links = data.socialLinks ? JSON.parse(data.socialLinks) : {};
          setLinksForm({ telegram: links.telegram || "", vk: links.vk || "", github: links.github || "", website: links.website || "" });
          setPrivacyForm({ privacyOnline: data.privacyOnline || "everyone", privacyFriends: data.privacyFriends || "everyone", privacyEmail: data.privacyEmail ?? false });
          setNotifyForm({ notifySound: data.notifySound ?? true, notifyPush: data.notifyPush ?? true });
          /* Тот же ответ кладём в клиентский кэш: по нему звук и системные
             уведомления решают, показываться ли (см. lib/notifyPrefs). */
          cacheNotifyPrefs({ notifySound: data.notifySound ?? true, notifyPush: data.notifyPush ?? true });
          setShowOnline(data.showOnline ?? true);
        });
    }
  }, [session]);

  // Load desktop shell config once (no-op in a normal browser)
  useEffect(() => {
    const api = getDesktopApi();
    api?.getConfig().then(setDesktopCfg).catch(() => {});
  }, []);

  // PREMIUM-PAY: подтягиваем включённые администратором способы оплаты, чтобы
  // показать в разделе Premium, как оформить подписку.
  useEffect(() => {
    if (session?.user) {
      fetch("/api/payments/methods")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) setPaymentMethods(data); })
        .catch(() => {});
    }
  }, [session]);

  // Глубокая ссылка вида /settings?cat=premium — открыть нужный раздел сразу.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("cat");
    /* VPN-PLAN: раздел переименован в «Подписки», но старые ссылки (?cat=premium)
       уже разосланы в письмах и стоят в других разделах — обе формы ведут сюда.
       Идентификатор категории намеренно оставлен прежним: переименование внутри
       кода сломало бы эти ссылки без всякой пользы для человека. */
    const cat = raw === "subscriptions" ? "premium" : raw;
    const valid: CategoryId[] = ["account", "profile", "privacy", "voice", "notifications", "appearance", "premium", "connect"];
    if (cat && (valid as string[]).includes(cat)) {
      setActiveCat(cat as CategoryId);
      setMobileContentOpen(true);
    }
  }, []);

  /* UI-SCROLL: на странице настроек системная полоса прокрутки справа скрыта.

     Прокрутка при этом остаётся полностью рабочей — колесом, клавишами, жестом
     на тачпаде: скрыт только сам индикатор (`scrollbar-width: none` и
     `::-webkit-scrollbar`), а не переполнение. Именно поэтому здесь класс на
     <html>, а не `overflow: hidden` на контейнере: второе убрало бы и прокрутку.

     Класс снимается при уходе со страницы — на остальных экранах полоса нужна:
     в переписке и на холсте она показывает, где ты находишься в длинном списке. */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("tz-hide-scrollbar");
    return () => root.classList.remove("tz-hide-scrollbar");
  }, []);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const patchProfile = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка");
    return data;
  };

  // Avatar upload
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append("avatar", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
    const data = await res.json();
    setUploadingAvatar(false);
    if (!res.ok) { showToast(data.error || "Ошибка загрузки", "error"); return; }
    setAvatarError(false);
    setProfile((p) => p ? { ...p, avatar: data.avatar } : p);
    showToast("Аватарка обновлена!", "success");
  };

  // Profile (name + username)
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await patchProfile({ name: nameForm.name, username: nameForm.username });
      setProfile((p) => p ? { ...p, name: nameForm.name, username: nameForm.username } : p);
      showToast("Профиль обновлён!", "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSavingProfile(false);
    }
  };

  // Email
  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      await patchProfile({ email: emailForm.email });
      setProfile((p) => p ? { ...p, email: emailForm.email, emailVerified: false } : p);
      showToast("Email обновлён! Потребуется повторная верификация.", "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSavingEmail(false);
    }
  };

  // Password
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passForm.newPassword !== passForm.confirmPassword) {
      showToast("Пароли не совпадают", "error"); return;
    }
    setSavingPass(true);
    try {
      await patchProfile({ currentPassword: passForm.currentPassword, newPassword: passForm.newPassword });
      setPassForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast("Пароль изменён!", "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSavingPass(false);
    }
  };

  // Bio
  const handleSaveBio = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBio(true);
    try { await patchProfile({ bio: bioForm || null }); showToast("Био обновлено!", "success"); }
    catch (err) { showToast((err as Error).message, "error"); }
    finally { setSavingBio(false); }
  };

  // Custom status
  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStatus(true);
    try {
      await fetch("/api/profile/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(statusForm) });
      showToast("Статус обновлён!", "success");
    } catch { showToast("Ошибка", "error"); }
    finally { setSavingStatus(false); }
  };

  // Social links
  const handleSaveLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLinks(true);
    try {
      const hasLinks = Object.values(linksForm).some(Boolean);
      await patchProfile({ socialLinks: hasLinks ? linksForm : null });
      showToast("Ссылки обновлены!", "success");
    } catch (err) { showToast((err as Error).message, "error"); }
    finally { setSavingLinks(false); }
  };

  // Privacy (+ master "show online" toggle)
  const handleSavePrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrivacy(true);
    try {
      await fetch("/api/profile/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(privacyForm) });
      await patchProfile({ showOnline });
      setProfile((p) => p ? { ...p, showOnline } : p);
      showToast("Настройки конфиденциальности сохранены!", "success");
    } catch { showToast("Ошибка", "error"); }
    finally { setSavingPrivacy(false); }
  };

  // Notifications (sound / push)
  const handleSaveNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNotify(true);
    try {
      const res = await fetch("/api/profile/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(notifyForm) });
      /* fetch не бросает на 4xx/5xx: раньше при отказе сервера показывалось
         «сохранено», а настройка возвращалась к прежней после перезагрузки. */
      if (!res.ok) throw new Error("save failed");
      /* Кэш и событие — чтобы звук и системные уведомления начали слушаться
         сразу, не дожидаясь следующей загрузки страницы. */
      cacheNotifyPrefs(notifyForm);
      showToast("Настройки уведомлений сохранены!", "success");
    } catch { showToast("Ошибка", "error"); }
    finally { setSavingNotify(false); }
  };

  /* ── Keybind captures ── */
  const capturePttKeys = useCallback((e: KeyboardEvent): boolean => {
    const keys = eventToBrowserKeys(e);
    if (!browserKeysHaveMainKey(keys)) return false;
    voice.setPttKeys(keys);
    return true;
  }, [voice]);

  const saveShortcut = useCallback(async (patch: Partial<DesktopConfig>) => {
    const api = getDesktopApi();
    if (!api) return;
    try {
      const next = await api.setConfig(patch);
      setDesktopCfg(next);
      showToast("Сохранено!", "success");
    } catch {
      showToast("Не удалось сохранить бинд", "error");
    }
  }, []);

  const captureMuteShortcut = useCallback((e: KeyboardEvent): boolean => {
    const acc = eventToAccelerator(e);
    if (!acc) return false;
    void saveShortcut({ toggleMuteShortcut: acc });
    return true;
  }, [saveShortcut]);

  const capturePttShortcut = useCallback((e: KeyboardEvent): boolean => {
    const acc = eventToAccelerator(e);
    if (!acc) return false;
    void saveShortcut({ pushToTalkShortcut: acc });
    return true;
  }, [saveShortcut]);

  /* ── FIX-REPLAY: бинды и папка мгновенного повтора ── */
  const captureReplayKeys = useCallback((e: KeyboardEvent): boolean => {
    const keys = eventToBrowserKeys(e);
    if (!browserKeysHaveMainKey(keys)) return false;
    voice.setReplayKeys(keys);
    return true;
  }, [voice]);

  const captureReplayShortcut = useCallback((e: KeyboardEvent): boolean => {
    const acc = eventToAccelerator(e);
    if (!acc) return false;
    void saveShortcut({ replayShortcut: acc });
    return true;
  }, [saveShortcut]);

  const chooseReplayFolder = useCallback(async () => {
    const api = getDesktopApi();
    if (!api?.chooseReplayFolder) return; // нет в старых сборках шелла
    try {
      const dir = await api.chooseReplayFolder();
      if (!dir) return;
      setDesktopCfg(prev => (prev ? { ...prev, replayFolder: dir } : prev));
      showToast("Папка сохранена!", "success");
    } catch {
      showToast("Не удалось выбрать папку", "error");
    }
  }, []);

  if (status === "loading" || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const role = ROLE_LABELS[profile.role] ?? ROLE_LABELS.USER;
  const friendCount = profile._count.friendsSent + profile._count.friendsReceived;
  // Effective premium mirrors the session/auth rule (`isPremium || role === "ADMIN"`)
  // so the settings page agrees with the /connect premium badge for admins.
  const effectivePremium = hasPremium(profile);

  const selectCat = (id: CategoryId) => { setActiveCat(id); setMobileContentOpen(true); };

  /* ─── Category content ─── */
  const renderCategory = () => {
    switch (activeCat) {
      case "connect":
        /* Всё, что касается внешнего вида («Оформление», «Кастомизация чата»
           и «Профиль сервера»), переехало в раздел «Внешний вид»: человек
           ищет настройки облика именно там, рядом с темой. Здесь остаются
           поведенческие настройки мессенджера: присутствие, звук, шифрование,
           витрина и список игнора. */
        return (
          <div className="space-y-4">
            <ConnectProfileSettings role={profile.role} isPremium={effectivePremium} sections="connect" />
            <ChatShowcase />
            <IgnoreListSection />
          </div>
        );
      case "account":
        return (
          <>
            {/* FIX-UI-ACC: раздел «Моя учётная запись» уплотнён и выровнен:
                dense-секции, аватар 64px, статистика — три симметричные плитки,
                формы — попарно в сетке 2×N (см. ниже). */}
            <Section title="Аккаунт" dense info="Нажмите на аватар, чтобы сменить картинку.">
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-violet-400 to-indigo-500 dark:from-cyan-400 dark:to-blue-500 flex items-center justify-center cursor-pointer"
                    onClick={() => fileRef.current?.click()}
                    title="Нажмите для смены аватарки"
                  >
                    {profile.avatar && !avatarError ? (
                      /* Обычный <img>, а не next/image.
                         Оптимизатор Next проксирует картинку через /_next/image,
                         то есть добавляет ещё один поход на сервер за файлом,
                         который и так отдаётся нашим же сервером из /uploads.
                         Этот лишний хоп иногда не успевает или падает — отсюда
                         аватар, который «то есть, то нет». Везде в приложении
                         аватары рисуются обычным <img> (см. GlowAvatar) и не
                         мигают. */
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={profile.avatar} alt="avatar" width={64} height={64} className="object-cover w-full h-full" onError={() => setAvatarError(true)} />
                    ) : (
                      <span className="text-white text-2xl font-bold">{profile.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute -bottom-1 -right-1 w-6 h-6 bg-violet-600 dark:bg-cyan-600 rounded-md flex items-center justify-center text-white shadow-lg hover:opacity-90 transition-opacity"
                    title="Загрузить аватарку"
                  >
                    {uploadingAvatar ? (
                      <Spinner size="sm" tone="white" />
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatarChange} className="hidden" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-neutral-900 dark:text-white truncate">{profile.name}</p>
                  <p className="text-sm text-neutral-500 dark:text-gray-400 truncate">@{profile.username}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {effectivePremium && <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">Premium</span>}
                    {profile.role !== "ADMIN" && <span className={`text-[11px] font-medium ${role.color}`}>{role.label}</span>}
                  </div>
                </div>

                <p className="hidden md:block flex-shrink-0 text-xs text-neutral-400">
                  На сайте с {new Date(profile.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Сообщений", value: profile._count.messages },
                  { label: "Друзей", value: friendCount },
                  { label: "Игр сыграно", value: profile._count.gamePlayers },
                ].map((stat) => (
                  <div key={stat.label} className="bg-neutral-100 dark:bg-white/5 rounded-lg py-2 text-center">
                    <p className="text-sm font-bold leading-none text-neutral-900 dark:text-white">{stat.value}</p>
                    <p className="text-[10px] text-neutral-500 dark:text-gray-500 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>

              <p className="md:hidden text-xs text-neutral-400">
                На сайте с {new Date(profile.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </Section>

            {/* FIX-UI-ACC: «Имя и юзернейм» и «Email» — симметричной парой на
                широких экранах (grid растягивает карточки до равной высоты). */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Имя и юзернейм" dense>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <Field label="Отображаемое имя">
                    <Input
                      value={nameForm.name}
                      onChange={(e) => setNameForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Ваше имя"
                      minLength={2}
                      maxLength={50}
                      required
                    />
                  </Field>
                  <Field label="Юзернейм" info="3–20 символов, только латиница, цифры и _">
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">@</span>
                      <Input
                        value={nameForm.username}
                        onChange={(e) => setNameForm((f) => ({ ...f, username: e.target.value }))}
                        placeholder="username"
                        pattern="[a-zA-Z0-9_]{3,20}"
                        title="3–20 символов: буквы, цифры, _"
                        required
                        className="!pl-8"
                        style={{ paddingLeft: "2rem" }}
                      />
                    </div>
                  </Field>
                  <SaveButton loading={savingProfile} />
                </form>
              </Section>

              <Section title="Email" dense>
                <form onSubmit={handleSaveEmail} className="space-y-4">
                  <Field label="Адрес электронной почты" info="При смене email потребуется повторная верификация.">
                    <Input
                      type="email"
                      value={emailForm.email}
                      onChange={(e) => setEmailForm({ email: e.target.value })}
                      placeholder="you@example.com"
                      required
                    />
                  </Field>
                  {/* FIX-UI-ACC: статус верификации логично живёт в блоке Email
                      (раньше терялся в мете «Аккаунта»). */}
                  <p className={`text-xs ${profile.emailVerified ? "text-green-500" : "text-yellow-500"}`}>
                    {profile.emailVerified ? "✓ Email подтверждён" : "⚠ Email не подтверждён"}
                  </p>
                  <SaveButton loading={savingEmail} />
                </form>
              </Section>
            </div>

            <Section title="Смена пароля" dense>
              <form onSubmit={handleSavePassword} className="space-y-4">
                {/* FIX-UI-ACC: три поля в один ряд на широких экранах вместо
                    высокой колонки. */}
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Текущий пароль">
                    <Input type="password" value={passForm.currentPassword} onChange={(e) => setPassForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="••••••••" required />
                  </Field>
                  <Field label="Новый пароль">
                    <Input type="password" value={passForm.newPassword} onChange={(e) => setPassForm((f) => ({ ...f, newPassword: e.target.value }))} placeholder="Минимум 8 символов" minLength={8} required />
                  </Field>
                  <Field label="Повторите новый">
                    <Input type="password" value={passForm.confirmPassword} onChange={(e) => setPassForm((f) => ({ ...f, confirmPassword: e.target.value }))} placeholder="••••••••" required />
                  </Field>
                </div>
                <SaveButton loading={savingPass} label="Изменить пароль" />
              </form>
            </Section>

            <DesktopCachePanel />

            <Section title="Удаление аккаунта" dense subtitle="Это действие необратимо — вернуть аккаунт не получится." info="Удаляются все ваши данные, сообщения и друзья.">
              <div className="flex gap-3">
                <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Введите пароль для подтверждения" />
                <button
                  onClick={async () => {
                    if (!deletePassword) { showToast("Введите пароль", "error"); return; }
                    if (!(await confirmDialog({ title: "Удалить аккаунт?", message: "Это действие нельзя отменить. Все ваши данные, сообщения и друзья будут удалены.", confirmText: "Удалить аккаунт", danger: true }))) return;
                    setDeletingAccount(true);
                    const res = await fetch("/api/profile/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: deletePassword }) });
                    if (res.ok) { await signOut({ callbackUrl: "/" }); } else { const data = await res.json(); showToast(data.error || "Ошибка", "error"); setDeletingAccount(false); }
                  }}
                  disabled={deletingAccount}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {deletingAccount ? "..." : "Удалить аккаунт"}
                </button>
              </div>
            </Section>
          </>
        );

      case "profile":
        return (
          <>
            <Section title="О себе">
              <form onSubmit={handleSaveBio} className="space-y-4">
                <Field label="Коротко о себе (до 200 символов)">
                  <textarea
                    value={bioForm}
                    onChange={(e) => setBioForm(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="Расскажите немного о себе..."
                    className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-violet-500 dark:focus:border-cyan-500 text-sm transition-colors resize-none"
                  />
                  <p className="text-xs text-neutral-400">{bioForm.length}/200</p>
                </Field>
                <SaveButton loading={savingBio} />
              </form>
            </Section>

            <Section title="Статус">
              <form onSubmit={handleSaveStatus} className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-16">
                    <Field label="Emoji">
                      <Input value={statusForm.statusEmoji} onChange={(e) => setStatusForm((f) => ({ ...f, statusEmoji: e.target.value }))} placeholder="🎮" maxLength={10} />
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="Текст статуса">
                      <Input value={statusForm.customStatus} onChange={(e) => setStatusForm((f) => ({ ...f, customStatus: e.target.value }))} placeholder="Чем занимаетесь?" maxLength={100} />
                    </Field>
                  </div>
                </div>
                <div className="flex gap-2">
                  <SaveButton loading={savingStatus} />
                  <button type="button" onClick={async () => { setSavingStatus(true); setStatusForm({ customStatus: "", statusEmoji: "" }); await fetch("/api/profile/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customStatus: null, statusEmoji: null }) }); setSavingStatus(false); showToast("Статус очищен", "success"); }} className="px-4 py-2 bg-neutral-100 dark:bg-white/5 text-neutral-600 dark:text-gray-400 rounded-xl text-sm hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors">
                    Очистить
                  </button>
                </div>
              </form>
            </Section>

            <Section title="Ссылки">
              <form onSubmit={handleSaveLinks} className="space-y-4">
                <Field label="Telegram">
                  <Input value={linksForm.telegram} onChange={(e) => setLinksForm((f) => ({ ...f, telegram: e.target.value }))} placeholder="https://t.me/username" />
                </Field>
                <Field label="VK">
                  <Input value={linksForm.vk} onChange={(e) => setLinksForm((f) => ({ ...f, vk: e.target.value }))} placeholder="https://vk.com/id" />
                </Field>
                <Field label="GitHub">
                  <Input value={linksForm.github} onChange={(e) => setLinksForm((f) => ({ ...f, github: e.target.value }))} placeholder="https://github.com/username" />
                </Field>
                <Field label="Личный сайт">
                  <Input value={linksForm.website} onChange={(e) => setLinksForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://mysite.ru" />
                </Field>
                <SaveButton loading={savingLinks} />
              </form>
            </Section>
          </>
        );

      case "privacy":
        return (
          <Section title="Конфиденциальность">
            <form onSubmit={handleSavePrivacy} className="space-y-4">
              <Field label="Кто видит мой онлайн-статус">
                <select value={privacyForm.privacyOnline} onChange={(e) => setPrivacyForm((f) => ({ ...f, privacyOnline: e.target.value }))} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm">
                  <option value="everyone">Все</option>
                  <option value="friends">Только друзья</option>
                  <option value="nobody">Никто</option>
                </select>
              </Field>
              <Field label="Кто может добавлять в друзья">
                <select value={privacyForm.privacyFriends} onChange={(e) => setPrivacyForm((f) => ({ ...f, privacyFriends: e.target.value }))} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm">
                  <option value="everyone">Все</option>
                  <option value="friends">Друзья друзей</option>
                  <option value="nobody">Никто</option>
                </select>
              </Field>
              <div className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-4 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                    Отображать онлайн
                    <InfoTooltip text="Главный переключатель видимости вашего онлайн-статуса." />
                  </p>
                </div>
                <Toggle checked={showOnline} onChange={() => setShowOnline((p) => !p)} label="Отображать онлайн" />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={privacyForm.privacyEmail} onChange={(e) => setPrivacyForm((f) => ({ ...f, privacyEmail: e.target.checked }))} className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-violet-500 dark:text-cyan-500 focus:ring-violet-500 dark:focus:ring-cyan-500" />
                <span className="text-sm text-neutral-900 dark:text-white">Скрыть email из профиля</span>
              </label>
              <SaveButton loading={savingPrivacy} />
            </form>
          </Section>
        );

      case "voice":
        /* FIX-VOICE-UI: колонка сужена (max-w-3xl), секции и плитки компактнее. */
        return (
          <div className="max-w-3xl space-y-6">
            {/* FIX-AUDIO-DEV: выбор микрофона и наушников/динамиков для голосового канала */}
            <Section dense title="Устройства звука" info="Выберите, какой микрофон и какие наушники/динамики использовать в голосовом канале. По умолчанию берётся системное устройство, и не видно, что именно задействовано.">
              <AudioDeviceSelect />
            </Section>

            <Section dense title="Проверка звука" info="Тест аудиоустройств: убедитесь, что вывод звука и микрофон работают до входа в голосовой канал.">
              <AudioDeviceTest />
            </Section>

            {/* FIX-CAM-DEV: выбор устройства камеры для голосового канала */}
            <Section dense title="Камера" info="Какая камера используется в голосовом канале. Качество: 720p, с подпиской Premium — 1080p.">
              <CameraDeviceSelect />
            </Section>

            <Section dense title="Режим передачи голоса" info="Как открывается ваш микрофон в голосовом канале.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => voice.setPttEnabled(false)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    !voice.pttEnabled
                      ? "border-violet-500/40 dark:border-cyan-500/40 bg-violet-500/10 dark:bg-cyan-500/10"
                      : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5"
                  }`}
                >
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">Активация по голосу</p>
                  <p className="text-xs text-neutral-500 dark:text-gray-400 mt-1">Микрофон всегда открыт, передача начинается автоматически, когда вы говорите.</p>
                </button>
                <button
                  type="button"
                  onClick={() => voice.setPttEnabled(true)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    voice.pttEnabled
                      ? "border-violet-500/40 dark:border-cyan-500/40 bg-violet-500/10 dark:bg-cyan-500/10"
                      : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5"
                  }`}
                >
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">Рация (Push-to-Talk)</p>
                  <p className="text-xs text-neutral-500 dark:text-gray-400 mt-1">Микрофон открыт, только пока зажата назначенная клавиша.</p>
                </button>
              </div>

              {voice.pttEnabled && (
                <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Клавиша рации
                        <InfoTooltip text="Действует, пока окно TrioZ в фокусе." />
                      </p>
                    </div>
                    <KeybindRecorder value={formatBrowserKeys(voice.pttKeys)} onCapture={capturePttKeys} />
                  </div>
                  {!browserKeysHaveMainKey(voice.pttKeys) && (
                    <p className="text-xs text-yellow-500">Клавиша не назначена — в режиме рации микрофон не откроется.</p>
                  )}
                </div>
              )}
            </Section>

            <Section
              dense
              title="Шумоподавление"
              info="Подавляет фоновый шум микрофона (клавиатура, вентилятор, улица) в реальном времени. Как это работает: микрофон захватывает «сырой» сигнал без шумодава браузера, нейросеть RNNoise очищает его на лету, и собеседники по WebRTC слышат уже обработанный звук. Пока RNNoise готовится, передача идёт с сырым сигналом; при сбое автоматически включается нативный шумодав браузера."
            >
              <div className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                <div>
                  <p className="text-sm text-neutral-900 dark:text-white font-medium">Включить шумодав</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{NS_STATUS_HINT[voice.nsStatus] ?? NS_STATUS_HINT.idle}</p>
                </div>
                <Toggle checked={voice.nsEnabled} onChange={() => voice.setNsEnabled(!voice.nsEnabled)} label="Включить шумоподавление" />
              </div>

              <div className={`rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-3 transition-opacity ${voice.nsEnabled ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                      Интенсивность подавления
                      <InfoTooltip text="Слабее — естественнее голос; сильнее — тише фон между словами." />
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-violet-600 dark:text-cyan-400 tabular-nums">{Math.round(voice.nsIntensity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(voice.nsIntensity * 100)}
                  disabled={!voice.nsEnabled}
                  onChange={(e) => voice.setNsIntensity(Number(e.target.value) / 100)}
                  className="w-full accent-violet-600 dark:accent-cyan-500 disabled:cursor-not-allowed"
                  aria-label="Интенсивность шумоподавления"
                />
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Мягко</span>
                  <span>Баланс</span>
                  <span>Агрессивно</span>
                </div>
              </div>
            </Section>

            {/* EQ: эквалайзер исходящего голоса и монитор (Premium) */}
            <Section
              dense
              title="Эквалайзер голоса (Premium)"
              info="Пять полос правят тембр вашего голоса уже после шумоподавления, поэтому собеседники слышат ровно то, что вы настроили. Усиление меняется на ходу — передача при этом не прерывается. Настройки хранятся только на этом устройстве."
            >
              <div className={`space-y-3 ${effectivePremium ? "" : "opacity-60"}`}>
                {/* Прямой ответ на «не работает»: полосы существуют только пока
                    микрофон захвачен, то есть пока вы в голосовом канале. Вне
                    канала ползунки лишь запоминают значения. */}
                {effectivePremium && (
                  <p className="text-xs text-neutral-500 dark:text-gray-400">
                    {voice.eqActive
                      ? "Полосы применяются к вашему голосу прямо сейчас."
                      : voice.isConnected
                        ? "Цепочка ещё собирается — обычно это доли секунды после входа в канал."
                        : "Ползунки запоминаются, но применяются только в голосовом канале: вне него микрофон не захвачен."}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                  <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                    Пресет
                    <InfoTooltip text="«Тепло» — поднимает низ и мягко убирает верх. «Радио» — срезает низ и выводит вперёд середину. «Чёткость» — добавляет 3.5 кГц, от этого разборчивее согласные. «Глубина» — усиливает 80 Гц. Стоит подвинуть любой полз��нок, и пресет станет «Свои настройки»." />
                  </p>
                  <div className="flex flex-wrap justify-end gap-0.5 rounded-lg bg-neutral-200/70 dark:bg-white/10 p-0.5">
                    {EQ_PRESET_ORDER.map((id) => (
                      <button
                        key={id}
                        type="button"
                        disabled={!effectivePremium}
                        onClick={() => voice.setEqPreset(id)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-40 ${voice.eqPreset === id ? "bg-white dark:bg-neutral-900 text-violet-600 dark:text-cyan-400 shadow" : "text-neutral-500 dark:text-neutral-400"}`}
                      >
                        {EQ_PRESET_LABELS[id]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-2">
                  {EQ_BANDS.map((band, i) => (
                    <div key={band.label} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-neutral-500 dark:text-gray-400 tabular-nums">{band.label}</span>
                      <input
                        type="range"
                        min={EQ_MIN_DB}
                        max={EQ_MAX_DB}
                        step={1}
                        value={voice.eqGains[i] ?? 0}
                        disabled={!effectivePremium}
                        onChange={(e) => voice.setEqBandGain(i, Number(e.target.value))}
                        className="flex-1 accent-violet-600 dark:accent-cyan-500 disabled:cursor-not-allowed"
                        aria-label={`Полоса ${band.label}`}
                      />
                      <span className="w-14 text-right text-[11px] font-mono text-violet-500 dark:text-cyan-400 tabular-nums">
                        {formatDb(voice.eqGains[i] ?? 0)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-0.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                      {EQ_PRESET_LABELS[voice.eqPreset]}
                      <InfoTooltip text="Каждая полоса меняется от −12 до +12 дБ. Ноль на всех полосах — сигнал идёт как есть." />
                    </span>
                    <button
                      type="button"
                      disabled={!effectivePremium || voice.eqPreset === "flat"}
                      onClick={() => voice.setEqPreset("flat")}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-neutral-200/70 dark:bg-white/10 text-neutral-600 dark:text-gray-300 hover:opacity-90 transition disabled:opacity-40"
                    >
                      Сбросить в «Нейтрально»
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Монитор
                        <InfoTooltip text="Возвращает ваш обработанный голос в наушники — слышно, что получилось после шумодава и полос. Работает только пока вы в голосовом канале, при выходе выключается сам. Собеседникам монитор не слышен и на их звук не влияет." />
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {voice.isConnected ? "Слышно свой голос после обработки." : "Включается, когда вы в голосовом канале."}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={voice.monitorEnabled}
                      aria-label="Монитор своего голоса"
                      disabled={!effectivePremium || !voice.isConnected}
                      onClick={() => voice.setMonitorEnabled(!voice.monitorEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${voice.monitorEnabled ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-white/15"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${voice.monitorEnabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-neutral-500 dark:text-gray-400">Громкость</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(voice.monitorVolume * 100)}
                      disabled={!effectivePremium}
                      onChange={(e) => voice.setMonitorVolume(Number(e.target.value) / 100)}
                      className="flex-1 accent-violet-600 dark:accent-cyan-500 disabled:cursor-not-allowed"
                      aria-label="Громкость монитора"
                    />
                    <span className="w-14 text-right text-[11px] font-mono text-violet-500 dark:text-cyan-400 tabular-nums">
                      {Math.round(voice.monitorVolume * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-yellow-500">
                    Только для наушников: через динамики микрофон снова поймает ваш голос, и собеседники услышат эхо.
                  </p>
                </div>
              </div>
              {!effectivePremium && (
                <p className="text-xs text-neutral-500 dark:text-gray-400">
                  Эквалайзер и монитор — возможности <span className="font-semibold text-amber-500">Premium</span>.
                </p>
              )}
            </Section>

            {/* FIX-REPLAY: настройки мгновенного повтора (Premium) */}
            <Section
              dense
              title="Мгновенный повтор (Premium)"
              info="Кольцевая запись последних 30 секунд голосового канала: ваш голос, собеседники и звук/видео трансляции. Всё пишется и хранится только на вашем устройстве — сервер не участвует. Файл содержит от 30 до 60 последних секунд."
            >
              {effectivePremium ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Включить буфер повтора
                        <InfoTooltip text="Запись ведётся, пока вы в голосовом канале." />
                      </p>
                    </div>
                    <Toggle checked={voice.replayEnabled} onChange={() => voice.setReplayEnabled(!voice.replayEnabled)} label="Буфер повтора" />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Бинд в приложении
                        <InfoTooltip text="Работает, пока окно TrioZ в фокусе." />
                      </p>
                    </div>
                    <KeybindRecorder
                      value={formatBrowserKeys(voice.replayKeys)}
                      onCapture={captureReplayKeys}
                      onClear={() => voice.setReplayKeys([])}
                    />
                  </div>
                  {/* Длительность буфера. Минимально: строка, ползунок, значение —
                      пояснение спрятано в «(?)», чтобы не разводить текст. */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                      Длительность
                      <InfoTooltip text="Сколько последних секунд держать в буфере: от 30 секунд до 3 минут. Буфер живёт в памяти вкладки, поэтому длинный отрезок занимает больше памяти. Новое значение применится при следующем входе в голосовой канал." />
                    </p>
                    <div className="flex items-center gap-2 w-48">
                      <input
                        type="range"
                        min={REPLAY_MIN_SECONDS}
                        max={REPLAY_MAX_SECONDS}
                        step={15}
                        value={voice.replaySeconds}
                        onChange={(e) => voice.setReplaySeconds(Number(e.target.value))}
                        className="flex-1 accent-violet-600 dark:accent-cyan-500"
                        aria-label="Длительность буфера повтора"
                      />
                      <span className="w-14 text-right text-[11px] font-mono text-violet-500 dark:text-cyan-400">
                        {voice.replaySeconds < 60
                          ? `${voice.replaySeconds} сек`
                          : `${Math.floor(voice.replaySeconds / 60)}:${String(voice.replaySeconds % 60).padStart(2, "0")}`}
                      </span>
                    </div>
                  </div>
                  {isDesktop ? (
                    <>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                        <div>
                          <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                            Глобальный бинд (десктоп)
                            <InfoTooltip text="Работает во всей системе, даже когда окно свёрнуто." />
                          </p>
                        </div>
                        <KeybindRecorder
                          value={formatAccelerator(desktopCfg?.replayShortcut ?? "")}
                          onCapture={captureReplayShortcut}
                          onClear={() => void saveShortcut({ replayShortcut: "" })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-neutral-900 dark:text-white font-medium">Папка для сохранения</p>
                          <p className="text-xs text-neutral-400 mt-0.5 truncate">
                            {desktopCfg?.replayFolder || "Видео → TrioZ Replays (по умолчанию)"}
                          </p>
                        </div>
                        <button
                          onClick={() => void chooseReplayFolder()}
                          className="shrink-0 text-sm px-3 py-1.5 rounded-lg bg-violet-600 dark:bg-cyan-500 text-white hover:opacity-90 transition"
                        >
                          Выбрать папку…
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-neutral-400 px-1">
                      В браузере файл сохраняется в папку загрузок. Глобальный бинд и выбор папки доступны в десктоп-приложении.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-white/15 px-4 py-6 text-center">
                  <p className="text-sm text-neutral-500 dark:text-gray-400">
                    Мгновенный повтор доступен подписчикам Премиум.
                  </p>
                </div>
              )}
            </Section>

            <Section
              dense
              title="Глобальные бинды (десктоп)"
              info="Горячие клавиши, работающие во всей системе — даже когда окно TrioZ свёрнуто. Доступны только в десктоп-приложении."
            >
              {isDesktop ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Выключить / включить микрофон
                        <InfoTooltip text="Переключает mute в активном голосовом канале." />
                      </p>
                    </div>
                    <KeybindRecorder
                      value={formatAccelerator(desktopCfg?.toggleMuteShortcut ?? "")}
                      onCapture={captureMuteShortcut}
                      onClear={() => void saveShortcut({ toggleMuteShortcut: "" })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm text-neutral-900 dark:text-white font-medium">
                        Рация (короткая передача)
                        <InfoTooltip text="Кратко открывает микрофон при нажатии." />
                      </p>
                    </div>
                    <KeybindRecorder
                      value={formatAccelerator(desktopCfg?.pushToTalkShortcut ?? "")}
                      onCapture={capturePttShortcut}
                      onClear={() => void saveShortcut({ pushToTalkShortcut: "" })}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-white/15 px-4 py-6 text-center">
                  <p className="text-sm text-neutral-500 dark:text-gray-400">
                    Глобальные бинды доступны в десктоп-приложении TrioZ.
                  </p>
                  <Link href="/about" className="text-xs text-violet-600 dark:text-cyan-400 hover:underline mt-1 inline-block">
                    Скачать приложение
                  </Link>
                </div>
              )}
            </Section>

            {/* FIX-OVL: оверлей голосового чата, как в Discord */}
            <Section
              dense
              title="Оверлей (десктоп)"
              info="Как только вы переключаетесь из TrioZ в другое приложение (игру, браузер), поверх него появляется компактная панель голосового канала: участники, кто говорит, статус микрофона и превью демонстрации экрана. Работает, пока вы в голосовом канале."
            >
              {isDesktop ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div className="text-sm font-medium">Включить оверлей</div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!desktopCfg?.overlayEnabled}
                      onClick={() => void saveShortcut({ overlayEnabled: !desktopCfg?.overlayEnabled })}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${desktopCfg?.overlayEnabled ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-white/15"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${desktopCfg?.overlayEnabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      Расположение
                      <InfoTooltip text="С какой стороны экрана показывать оверлей." />
                    </div>
                    <div className="flex rounded-lg bg-neutral-200/70 dark:bg-white/10 p-0.5">
                      {(["left", "right"] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          disabled={!desktopCfg?.overlayEnabled}
                          onClick={() => void saveShortcut({ overlaySide: side })}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-40 ${(desktopCfg?.overlaySide ?? "right") === side ? "bg-white dark:bg-neutral-900 text-violet-600 dark:text-cyan-400 shadow" : "text-neutral-500 dark:text-neutral-400"}`}
                        >
                          {side === "left" ? "Слева" : "Справа"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      Демонстрация экрана в оверлее
                      <InfoTooltip text="Показывать превью активной демонстрации экрана внутри оверлея." />
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={desktopCfg?.overlayShowScreen ?? true}
                      disabled={!desktopCfg?.overlayEnabled}
                      onClick={() => void saveShortcut({ overlayShowScreen: !(desktopCfg?.overlayShowScreen ?? true) })}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${(desktopCfg?.overlayShowScreen ?? true) ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-white/15"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${(desktopCfg?.overlayShowScreen ?? true) ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-white/15 px-3.5 py-2.5 text-sm text-neutral-500 dark:text-neutral-400">
                  Оверлей доступен в десктоп-приложении TrioZ.
                </div>
              )}
            </Section>
          </div>
        );

      case "notifications":
        return (
          <>
            <Section title="Уведомления">
              <form onSubmit={handleSaveNotify} className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyForm.notifySound} onChange={(e) => setNotifyForm((f) => ({ ...f, notifySound: e.target.checked }))} className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-violet-500 dark:text-cyan-500 focus:ring-violet-500 dark:focus:ring-cyan-500" />
                  <span className="text-sm text-neutral-900 dark:text-white">Звуковые уведомления</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyForm.notifyPush} onChange={(e) => setNotifyForm((f) => ({ ...f, notifyPush: e.target.checked }))} className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-violet-500 dark:text-cyan-500 focus:ring-violet-500 dark:focus:ring-cyan-500" />
                  <span className="text-sm text-neutral-900 dark:text-white">Push-уведомления</span>
                </label>
                <SaveButton loading={savingNotify} />
              </form>
            </Section>

            <Section title="Центр уведомлений" info="Все уведомления из игр и TZ.Connect в одном месте.">
              <Link
                href="/settings/notifications"
                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 dark:bg-white/10 hover:bg-neutral-200 dark:hover:bg-white/15 rounded-xl text-sm text-neutral-700 dark:text-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Открыть центр уведомлений
              </Link>
            </Section>
          </>
        );

      case "appearance":
        return (
          <Section title="Внешний вид">
            {/* FIX-I18N: language toggle */}
            <div className="mb-4" data-i18n-skip>
              <p className="text-sm text-neutral-900 dark:text-white font-medium mb-2">Язык интерфейса · Language</p>
              <button
                type="button"
                onClick={() => setLang(lang === "ru" ? "en" : "ru")}
                title={lang === "ru" ? "Switch to English" : "Переключить на русский"}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  lang === "en"
                    ? "bg-violet-500/10 border-violet-500/40 text-violet-600 dark:text-violet-300"
                    : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-gray-300 hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-cyan-400"
                }`}
              >
                🌐 {lang === "ru" ? "Русский → EN" : "English → RU"}
              </button>
            </div>
            <div>
              <p className="text-sm text-neutral-900 dark:text-white font-medium mb-2">Тема интерфейса</p>
              <div className="grid grid-cols-2 gap-2">
                {/* Тёмная стоит первой: это тема по умолчанию. */}
                <button
                  onClick={() => setTheme("dark")}
                  className={`py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    theme === "dark"
                      ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-500 dark:text-cyan-400"
                      : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
                  }`}
                >
                  Тёмная
                </button>
                <button
                  onClick={() => setTheme("light")}
                  className={`py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    theme === "light"
                      ? "bg-violet-500/10 border-violet-500/40 text-violet-600 dark:text-violet-300"
                      : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
                  }`}
                >
                  Светлая
                </button>
                <button
                  onClick={() => { if (effectivePremium) setTheme("mono"); }}
                  disabled={!effectivePremium}
                  title={effectivePremium ? "Монохром (Premium)" : "Доступно с Premium"}
                  className={`relative py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    theme === "mono"
                      ? "bg-white/10 border-white/40 text-neutral-900 dark:text-white"
                      : effectivePremium
                        ? "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
                        : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-400 dark:text-gray-600 opacity-60 cursor-not-allowed"
                  }`}
                >
                  Монохром
                  <span className="ml-1 align-middle text-[10px] font-semibold text-amber-500">Premium</span>
                </button>
                <button
                  onClick={() => { if (effectivePremium) setTheme("mono-lite"); }}
                  disabled={!effectivePremium}
                  title={effectivePremium ? "Monochrome Lite (Premium)" : "Доступно с Premium"}
                  className={`relative py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    theme === "mono-lite"
                      ? "bg-white/10 border-white/40 text-neutral-900 dark:text-white"
                      : effectivePremium
                        ? "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
                        : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-400 dark:text-gray-600 opacity-60 cursor-not-allowed"
                  }`}
                >
                  Mono Lite
                  <span className="ml-1 align-middle text-[10px] font-semibold text-amber-500">Premium</span>
                </button>
              </div>

              {!effectivePremium && (
                <p className="text-xs text-neutral-400 mt-2">
                  «Монохром» — строгий премиум-дизайн. Доступен при активной подписке Premium.
                </p>
              )}
              {theme === "mono" && (
                <p className="text-xs text-neutral-500 dark:text-gray-400 mt-2">
                  Строгий монохромный дизайн (глубокий чёрный и графит, серебристые акценты).
                  Анимации в TZ.Connect отключены.
                </p>
              )}
              {theme === "mono-lite" && (
                <p className="text-xs text-neutral-500 dark:text-gray-400 mt-2">
                  «Monochrome Lite» — светлая пара Monochrome: холодная бумага и графит.
                  Тот же материальный язык и та же дисциплина движения, что и в тёмном Монохроме.
                </p>
              )}
              {theme === "light" && (
                <p className="text-xs text-neutral-500 dark:text-gray-400 mt-2">
                  «Светлая» — дизайн «Бумажная студия»: слоистые панели-«листы» с мягкими
                  тенями вместо линий, дневной свет у верхней кромки и чернильный акцент.
                  Цвет чернил выбирается ниже — фиолет или тёплая охра.
                </p>
              )}
            </div>

            {theme === "light" && (
              <div className="mt-4">
                <p className="text-sm text-neutral-900 dark:text-white font-medium mb-2">Цветовая схема (светлая тема)</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (lightVariant !== "default") toggleLightVariant(); }}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                      lightVariant === "default"
                        ? "bg-violet-500/10 border-violet-500/30 text-violet-600"
                        : "bg-neutral-100 border-neutral-200 text-neutral-500"
                    }`}
                  >
                    Violet
                  </button>
                  <button
                    onClick={() => { if (lightVariant !== "warm") toggleLightVariant(); }}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                      lightVariant === "warm"
                        ? "bg-orange-500/10 border-orange-500/30 text-orange-600"
                        : "bg-neutral-100 border-neutral-200 text-neutral-500"
                    }`}
                  >
                    Warm
                  </button>
                </div>
              </div>
            )}

            {/* Перенесено из раздела TZ.Connect: «Оформление» (баннер, свечение
                аватара, фон дня и ночи), «Кастомизация чата» и «Профиль сервера».
                Порядок на экране повторяет порядок применения: сначала тема выше,
                потом частные настройки, и в самом низу — своё оформление Premium,
                которое ложится поверх всего остального. */}
            <div className="mt-6 space-y-4">
              <ConnectProfileSettings role={profile.role} isPremium={effectivePremium} sections="appearance" />
              <ChatAppearanceSettings />
              <ServerProfileSection />
            </div>

            {/* PREMIUM-SKIN: свободная кастомизация для подписчиков идёт после выбора
                темы и не перед ним: тема задаёт базу, а этот блок кладётся поверх неё,
                и порядок на экране повторяет порядок применения. */}
            <div className="mt-6">
              <PremiumAppearanceSettings isPremium={effectivePremium} />
            </div>
          </Section>
        );

      case "premium": {
        /* Раздел собран по одному принципу: сначала «что у меня сейчас», потом
           «что это даёт», потом «чем отличается от обычного», и только затем
           «как оплатить». Раньше первым экраном шла таблица сравнения — она
           отвечает на вопрос, который у подписчика уже не стоит. */
        const premiumInfo = profile.premium;
        const expiresAt = premiumInfo?.expiresAt ? new Date(premiumInfo.expiresAt) : null;
        /* Счётчик считает сервер: у него одна дата на всех, а браузер может стоять
           с любым временем. Локальный расчёт остаётся запасным путём, если ответ
           профиля пришёл от старой сборки. */
        const daysLeft = premiumInfo?.daysLeft ?? (expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000) : null);
        const byRole = premiumInfo?.source === "role";
        /* Срок вышел, а флаг в базе ещё не снят: задача проверяет раз в шесть
           часов. В этом окне человек не должен видеть «подписка без срока» —
           показываем правду, счётчик для этого и нужен. */
        const overdue = daysLeft != null && daysLeft < 0;
        const premiumActive = effectivePremium && !overdue;
        const dateLabel = expiresAt?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
        /* Заголовок блока.

           Надписи «Premium подключён» и «Выдан по роли администратора — оплата не
           требуется» убраны: первая ничего не добавляла к значку справа, вторая
           объясняла человеку то, что его не касается. Вместо них у обычного
           аккаунта стоит счётчик — главное, что нужно знать о подписке. */
        const statusTitle = overdue
          ? "Срок подписки истёк"
          : !premiumActive
            ? "Обычный профиль"
            : byRole
              ? "Premium"
              : daysLeft == null
                ? "Подписка без срока"
                : daysLeft === 0
                  ? "Подписка заканчивается сегодня"
                  : `Осталось ${daysLeft} ${pluralDays(daysLeft)}`;
        const statusNote = overdue
          ? `Оплачено было до ${dateLabel}. Обычные ограничения уже вернулись — подписку можно продлить.`
          : !premiumActive
            ? "Сейчас у вас обычный профиль. Ограничения снимает подписка."
            : byRole
              ? ""
              : dateLabel
                ? `Оплачено до ${dateLabel}. Если не продлить, премиум снимется автоматически.`
                : premiumInfo?.granted
                  ? "Бессрочная подписка, оформлена администратором."
                  : "Бессрочная подписка.";
        /* Срок близок к концу — это единственное, о чём стоит предупредить. */
        const expiringSoon = daysLeft != null && daysLeft >= 0 && daysLeft <= 7;

        /* VPN-PLAN: раздел «Подписки» состоит из двух независимых частей.

           Premium и «только VPN» — разные продукты, а не тарифы одного: вторая
           подписка даёт РОВНО одно право (включать и выключать VPN) и не даёт ни
           тем, ни лимитов сообществ, ни повышенных пределов сообщений. Поэтому у
           частей раздельные состояния, сроки и блоки оплаты: человек должен
           видеть, за что именно у него оплачено и что закончится. */
        const vpnInfo = profile.vpn;
        const vpnExpires = vpnInfo?.expiresAt ? new Date(vpnInfo.expiresAt) : null;
        const vpnDays = vpnInfo?.daysLeft ?? (vpnExpires ? Math.ceil((vpnExpires.getTime() - Date.now()) / 86_400_000) : null);
        const vpnOverdue = vpnDays != null && vpnDays < 0;
        /** Отдельная подписка на VPN. */
        const vpnPlanActive = !!vpnInfo?.active && !vpnOverdue;
        /** Доступ к VPN есть и без отдельной подписки — его даёт Premium. */
        const vpnViaPremium = !!vpnInfo?.viaPremium || (premiumActive && !vpnInfo);
        const vpnDateLabel = vpnExpires?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
        const vpnStatusTitle = vpnPlanActive
          ? vpnDays == null
            ? "Подписка без срока"
            : vpnDays === 0
              ? "Подписка заканчивается сегодня"
              : `Осталось ${vpnDays} ${pluralDays(vpnDays)}`
          : vpnOverdue
            ? "Срок подписки истёк"
            : vpnViaPremium
              ? "VPN уже доступен по Premium"
              : "VPN не подключён";
        const vpnStatusNote = vpnPlanActive
          ? vpnDateLabel
            ? `Оплачено до ${vpnDateLabel}. Если не продлить, туннель отключится автоматически.`
            : "Бессрочная подписка только на VPN."
          : vpnOverdue
            ? `Оплачено было до ${vpnDateLabel}. Туннель уже отключён — подписку можно продлить.`
            : vpnViaPremium
              ? "Отдельная подписка не нужна: право на туннель входит в Premium. Она пригодится, если Premium закончится, а VPN нужен."
              : "Подписка даёт только включение и выключение VPN. Остальные возможности Premium в неё не входят.";
        /** Тумблер VPN живёт в TZ.Connect — здесь только состояние подписки. */
        const vpnEntitled = vpnPlanActive || vpnViaPremium;

        return (
          <>
            {/* Часть 1. Premium — подписка со всеми возможностями. */}
            <div className="mb-2 flex items-center gap-3">
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">Premium</span>
              <span className="text-xs text-neutral-400">Все возможности, включая VPN</span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
            </div>

            <Section title="Ваша подписка">
              <div className={`rounded-2xl border p-4 ${premiumActive ? "border-amber-500/25 bg-amber-500/5" : "border-neutral-200 dark:border-white/10"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">{statusTitle}</p>
                    {statusNote && <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">{statusNote}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${premiumActive ? "bg-amber-500/15 text-amber-500" : "bg-neutral-200 dark:bg-white/10 text-neutral-500 dark:text-gray-400"}`}>
                    {premiumActive ? "Premium" : "Обычный"}
                  </span>
                </div>

                {expiringSoon && (
                  <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    Подписка заканчивается меньше чем через неделю. После окончания вернутся обычные ограничения — например, предел длины сообщения станет вдвое меньше.
                  </p>
                )}

                {/* Оплата нужна не только новым: продлевают тоже отсюда. Раньше
                    блок с реквизитами скрывался от подписчиков совсем, и продлить
                    подписку было негде. */}
                {premiumInfo?.source !== "role" && (
                  <a
                    href="#premium-payment"
                    className="mt-3 inline-flex rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
                  >
                    {premiumActive || overdue ? "Продлить подписку" : "Оформить Premium"}
                  </a>
                )}
              </div>

              {/* Флагманская возможность — то, ради чего подписку берут чаще всего. */}
              <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">{PREMIUM_MAIN_ADVANTAGE.badge}</p>
                <p className="mt-1 text-base font-semibold text-neutral-900 dark:text-white">{PREMIUM_MAIN_ADVANTAGE.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-500 dark:text-gray-400">{PREMIUM_MAIN_ADVANTAGE.description}</p>
              </div>
            </Section>

            {/* Что даёт подписка. В настройках этого списка не было вовсе — он
                жил только во всплывающем окне для тех, у кого премиума нет. */}
            <Section title="Что входит" subtitle={effectivePremium ? "Всё перечисленное уже работает на вашем аккаунте." : undefined}>
              <div className="grid gap-3 sm:grid-cols-2">
                {PREMIUM_KEY_FEATURES.map((f) => (
                  <div key={f.id} className="flex gap-3 rounded-2xl border border-neutral-200 p-3 dark:border-white/10">
                    {/* Контурная иконка проекта вместо эмодзи: тот же штрих, что и
                        у остальных иконок, и корректный цвет в любой теме. */}
                    <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
                      <PremiumFeatureIcon id={f.id} size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900 dark:text-white">{f.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Табличное сравнение: обычный профиль ↔ Premium-профиль */}
            <Section title="Обычный профиль и Premium" subtitle="Отмечен тариф, который действует у вас сейчас.">
              <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-white/5 text-left">
                      <th className="py-2.5 px-4 font-medium text-neutral-500 dark:text-gray-400">Возможность</th>
                      <th className={`py-2.5 px-3 text-center font-medium ${effectivePremium ? "text-neutral-500 dark:text-gray-400" : "text-neutral-900 dark:text-white"}`}>
                        Обычный{!effectivePremium && <span className="ml-1 text-[10px] font-normal text-neutral-400">ваш</span>}
                      </th>
                      <th className="py-2.5 px-3 text-center font-semibold text-amber-500">
                        Premium{effectivePremium && <span className="ml-1 text-[10px] font-normal text-amber-500/70">ваш</span>}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PREMIUM_COMPARISON.map((row, i) => (
                      <tr key={row.feature} className={i % 2 ? "bg-neutral-50/50 dark:bg-white/[0.02]" : ""}>
                        <td className="py-2.5 px-4 text-neutral-700 dark:text-gray-300">{row.feature}</td>
                        <td className={`py-2.5 px-3 text-center tabular-nums ${row.free === "—" ? "text-neutral-300 dark:text-gray-600" : "text-neutral-600 dark:text-gray-400"}`}>{row.free}</td>
                        <td className={`py-2.5 px-3 text-center font-medium tabular-nums ${row.premium === "✓" ? "text-emerald-500" : "text-neutral-900 dark:text-white"}`}>{row.premium}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Оплата: показывается всем — новым для оформления, подписчикам для
                продления. Реквизиты задаёт администратор. */}
            {premiumInfo?.source !== "role" && (
              <div id="premium-payment">
                <Section
                  title={effectivePremium ? "Как продлить Premium" : "Как оформить Premium"}
                  subtitle={paymentMethods?.priceMonth ? `Стоимость: ${paymentMethods.priceMonth} ${paymentMethods.currency}/мес.` : undefined}
                >
                {paymentMethods && paymentMethods.methods.length > 0 ? (
                  <div className="space-y-3">
                    {paymentMethods.methods.map((m) => (
                      <div key={m.id} className="rounded-2xl border border-neutral-200 dark:border-white/10 p-4">
                        <p className="text-sm font-semibold text-neutral-900 dark:text-white">{m.label}</p>
                        {m.fields.length > 0 && (
                          <dl className="mt-2 space-y-1">
                            {m.fields.map((f) => (
                              <div key={f.label} className="flex items-center justify-between gap-3 text-xs">
                                <dt className="text-neutral-400">{f.label}</dt>
                                <dd className="font-medium text-neutral-700 dark:text-gray-200 text-right break-all">{f.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {m.link && (
                          <a href={m.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-xl bg-violet-500/10 px-4 py-2 text-xs font-medium text-violet-600 dark:text-cyan-400 hover:bg-violet-500/20 transition-colors">
                            Перейти к оплате →
                          </a>
                        )}
                        {m.comment && <p className="mt-2 text-[11px] text-neutral-400">{m.comment}</p>}
                      </div>
                    ))}
                    <p className="text-[11px] text-neutral-400">После оплаты Premium подключит администратор. Укажите ваш username при переводе.</p>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 dark:text-gray-400">
                    Способы оплаты пока не настроены. Обратитесь к администратору, чтобы оформить Premium.
                  </p>
                )}
                </Section>
              </div>
            )}

            {/* ── Часть 2. Только VPN ──────────────────────────────────────────

                Отдельный продукт для тех, кому нужен один тумблер и больше
                ничего. Право на туннель на сервере проверяется как «Premium ИЛИ
                эта подписка» (lib/vpn.ts, VPN-PLAN), поэтому подписчику Premium
                платить второй раз не нужно — об этом здесь сказано прямо. */}
            <div className="mt-8 mb-2 flex items-center gap-3">
              <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400">Только VPN</span>
              <span className="text-xs text-neutral-400">Включение и выключение VPN</span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
            </div>

            <Section title="Подписка на VPN">
              <div className={`rounded-2xl border p-4 ${vpnPlanActive ? "border-cyan-500/25 bg-cyan-500/5" : "border-neutral-200 dark:border-white/10"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">{vpnStatusTitle}</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">{vpnStatusNote}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${vpnPlanActive ? "bg-cyan-500/15 text-cyan-500" : vpnViaPremium ? "bg-amber-500/15 text-amber-500" : "bg-neutral-200 dark:bg-white/10 text-neutral-500 dark:text-gray-400"}`}>
                    {vpnPlanActive ? "VPN" : vpnViaPremium ? "По Premium" : "Нет"}
                  </span>
                </div>

                {vpnPlanActive && vpnDays != null && vpnDays >= 0 && vpnDays <= 7 && (
                  <p className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-600 dark:text-cyan-400">
                    Подписка заканчивается меньше чем через неделю. После окончания туннель отключится, а настройки соединения сохранятся — при продлении включать заново ничего не придётся.
                  </p>
                )}

                {vpnEntitled && (
                  <a
                    href="/connect"
                    className="mt-3 inline-flex rounded-xl bg-cyan-500/15 px-4 py-2 text-xs font-medium text-cyan-600 transition-colors hover:bg-cyan-500/25 dark:text-cyan-400"
                  >
                    Тумблер VPN — в TZ.Connect →
                  </a>
                )}
              </div>
            </Section>

            <Section title="Что входит" subtitle="Подписка «Только VPN» ограничена одним правом — это её смысл, а не недоработка.">
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <span className="mt-0.5 text-cyan-500">✓</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">Включение и выключение VPN «TZ Secure»</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">
                      Один тумблер: трафик идёт через закрытый канал TZ. Выбор маршрутизации (весь трафик или только сервисы TZ) сохраняется.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-neutral-200 dark:border-white/10 p-4">
                  <span className="mt-0.5 text-neutral-400">—</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-700 dark:text-gray-200">Остальные возможности Premium не входят</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">
                      Оформление профиля, повышенные пределы сообщений и вложений, лимиты сообществ, закрепления и очередь отложенных остаются как у обычного профиля. Нужны они — это Premium выше.
                    </p>
                  </div>
                </div>
              </div>
            </Section>

            {/* Оплата: те же реквизиты, что и у Premium. Отдельный блок нужен из-за
                одной строки — в комментарии к платежу должно стоять «VPN», иначе
                администратор не поймёт, какую из двух подписок подключать. */}
            <div id="vpn-payment">
              <Section title={vpnPlanActive ? "Как продлить VPN" : "Как оформить VPN"}>
                {paymentMethods && paymentMethods.methods.length > 0 ? (
                  <div className="space-y-3">
                    {paymentMethods.methods.map((m) => (
                      <div key={`vpn-${m.id}`} className="rounded-2xl border border-neutral-200 dark:border-white/10 p-4">
                        <p className="text-sm font-semibold text-neutral-900 dark:text-white">{m.label}</p>
                        {m.fields.length > 0 && (
                          <dl className="mt-2 space-y-1">
                            {m.fields.map((f) => (
                              <div key={f.label} className="flex items-center justify-between gap-3 text-xs">
                                <dt className="text-neutral-400">{f.label}</dt>
                                <dd className="font-medium text-neutral-700 dark:text-gray-200 text-right break-all">{f.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {m.link && (
                          <a href={m.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-xl bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 transition-colors">
                            Перейти к оплате →
                          </a>
                        )}
                        {m.comment && <p className="mt-2 text-[11px] text-neutral-400">{m.comment}</p>}
                      </div>
                    ))}
                    <p className="text-[11px] text-neutral-400">
                      В комментарии к платежу укажите ваш username и слово «VPN» — иначе подключат Premium. Подписку активирует администратор.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 dark:text-gray-400">
                    Способы оплаты пока не настроены. Обратитесь к администратору, чтобы оформить подписку на VPN.
                  </p>
                )}
              </Section>
            </div>
          </>
        );
      }
    }
  };

  const activeLabel = CATEGORIES.flatMap((g) => g.items).find((i) => i.id === activeCat)?.label ?? "Настройки";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 pt-20 max-md:pt-4 pb-12 px-4 max-md:px-3">
      <div className="max-w-5xl mx-auto md:flex md:gap-6">

        {/* ── Sidebar (list of categories) ── */}
        <aside className={`md:w-60 md:flex-shrink-0 ${mobileContentOpen ? "hidden md:block" : "block"}`}>
          <div className="md:sticky md:top-20">
            <div className="flex items-center gap-3 mb-4 px-1">
              <BackButton fallback={isDesktop ? "/connect" : "/"} className="text-accent hover:opacity-70 transition-opacity" aria-label={isDesktop ? "Назад в TZ.Connect" : "На главную"}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </BackButton>
              <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Настройки</h1>
            </div>

            <nav className="space-y-4">
              {CATEGORIES.map((group) => (
                <div key={group.group}>
                  <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-gray-500">{group.group}</p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => selectCat(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                          activeCat === item.id
                            ? "bg-violet-500/10 dark:bg-cyan-500/10 text-violet-700 dark:text-cyan-300"
                            : "text-neutral-600 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className={activeCat === item.id ? "text-violet-600 dark:text-cyan-400" : "text-neutral-400 dark:text-gray-500"}>{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="pt-2 border-t border-neutral-200 dark:border-white/10">
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <Icon path={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>} />
                  Выйти из аккаунта
                </button>
              </div>
            </nav>
          </div>
        </aside>

        {/* ── Content ── */}
        <main className={`flex-1 min-w-0 ${mobileContentOpen ? "block" : "hidden md:block"}`}>
          <button
            onClick={() => setMobileContentOpen(false)}
            className="md:hidden flex items-center gap-2 mb-4 text-sm font-medium text-neutral-600 dark:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {activeLabel}
          </button>
          <div className="max-w-2xl space-y-6">
            {renderCategory()}
          </div>
        </main>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
