"use client";

/* GROUP-SKIN: редактор оформления сообщества (раздел «Дизайн»).

   Слева вкладки с настройками, справа живое превью. Раньше все блоки шли одной
   лентой на несколько экранов, а результат был виден только после сохранения и
   закрытия окна.

   Превью рисуется теми же функциями (surfaceLayer, bannerCss, fontStack), что и
   боевой слой: иначе картинка в настройках расходилась бы с реальным видом. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FIT_OPTIONS,
  GROUP_FONTS,
  GROUP_PRESETS,
  GROUP_THEME_MAX_JSON,
  PARTICLE_OPTIONS,
  SURFACE_MODE_OPTIONS,
  bannerCss,
  defaultGroupTheme,
  fontStack,
  hexToRgba,
  parseGroupTheme,
  serializeGroupTheme,
  surfaceLayer,
  surfaceRepeat,
  surfaceSize,
  type GroupBannerCfg,
  type GroupSurface,
  type GroupTheme,
  type SurfaceFit,
  type SurfaceMode,
} from "@/lib/groupTheme";
import { fitBannerFile, fitErrorText, fitSurfaceFile } from "@/lib/bannerFit";
import ParticleField from "../ParticleField";
import { alertDialog } from "@/components/ui/ConfirmDialog";

interface Props {
  groupId: string;
  /** Сырое значение Group.theme из карточки сообщества. */
  theme: string | null | undefined;
  /** Сообщить родителю о сохранённом оформлении, чтобы вид обновился без перезагрузки. */
  onSaved?: (theme: string) => void;
}

/* Палитра фиксированная: раздел живёт внутри тёмной модалки настроек. */
const CARD = "rounded-xl border border-white/10 bg-white/[0.03] p-3";
const BTN = "px-2.5 py-1 rounded-lg text-[11px] leading-5 transition";
const BTN_OFF = "border border-white/10 text-white/60 hover:bg-white/5";
const BTN_ON = "bg-[var(--cn-accent)] text-white";
const FIELD =
  "w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white/80 outline-none focus:border-white/25";

/** Картинки лежат в самой записи темы, поэтому потолок на файл скромный. */
const MAX_UPLOAD = 320 * 1024;

type TabId = "presets" | "surfaces" | "banner" | "accent" | "particles";

const TABS: { id: TabId; label: string }[] = [
  { id: "presets", label: "Пресеты" },
  { id: "surfaces", label: "Фоны" },
  { id: "banner", label: "Баннер" },
  { id: "accent", label: "Цвет и шрифт" },
  { id: "particles", label: "Частицы" },
];

/* ───────────────────────── Мелкие элементы ───────────────────────── */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-white/60">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 py-0.5">
      <span className="w-24 flex-shrink-0 text-[11px] text-white/55">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-[var(--cn-accent)]"
      />
      <span className="w-10 flex-shrink-0 text-right text-[11px] tabular-nums text-white/40">
        {value}
        {suffix}
      </span>
    </label>
  );
}

function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-white/55">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-7 cursor-pointer rounded border border-white/10 bg-transparent p-0"
      />
      <span>{label}</span>
    </label>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`h-5 w-9 flex-shrink-0 rounded-full p-0.5 transition ${value ? "bg-[var(--cn-accent)]" : "bg-white/15"}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-4" : ""}`} />
    </button>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-xs text-white/80">{label}</span>
        {hint ? <span className="block text-[11px] leading-snug text-white/35">{hint}</span> : null}
      </span>
      <Switch value={value} onChange={onChange} />
    </div>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  accent = true,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.hint}
          onClick={() => onChange(opt.value)}
          className={`${BTN} ${value === opt.value ? (accent ? BTN_ON : "bg-white/15 text-white") : BTN_OFF}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────── Редакторы ────────────────────────── */

/** Одна поверхность: чат, текстовые каналы или голосовые. */
function SurfaceEditor({
  surface,
  onChange,
  onNote,
}: {
  surface: GroupSurface;
  onChange: (patch: Partial<GroupSurface>) => void;
  onNote: (note: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const pickImage = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fitSurfaceFile(file, MAX_UPLOAD);
      onChange({ image: res.url, mode: "image" });
      if (res.note) onNote(res.note);
    } catch (err) {
      void alertDialog(fitErrorText(err, MAX_UPLOAD));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Chips
        options={SURFACE_MODE_OPTIONS.map((o) => ({ value: o.value as SurfaceMode, label: o.label }))}
        value={surface.mode}
        onChange={(v) => onChange({ mode: v })}
      />

      {surface.mode === "theme" ? (
        <p className="text-[11px] leading-snug text-white/35">
          Останется фон темы — включая личное оформление участника.
        </p>
      ) : null}

      {surface.mode === "solid" ? (
        <ColorPick label="Цвет фона" value={surface.color} onChange={(v) => onChange({ color: v })} />
      ) : null}

      {surface.mode === "gradient" ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <ColorPick label="Начало" value={surface.from} onChange={(v) => onChange({ from: v })} />
            {surface.useVia ? (
              <ColorPick label="Середина" value={surface.via} onChange={(v) => onChange({ via: v })} />
            ) : null}
            <ColorPick label="Конец" value={surface.to} onChange={(v) => onChange({ to: v })} />
          </div>
          <Row label="Три цвета">
            <Switch value={surface.useVia} onChange={(v) => onChange({ useVia: v })} />
          </Row>
          <Slider label="Угол" value={surface.angle} min={0} max={360} suffix="°" onChange={(v) => onChange({ angle: v })} />
        </div>
      ) : null}

      {surface.mode === "image" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className={`${BTN} ${BTN_OFF} disabled:opacity-50`}
            >
              {busy ? "Обработка…" : "Загрузить"}
            </button>
            {surface.image ? (
              <button
                type="button"
                onClick={() => onChange({ image: "" })}
                className={`${BTN} text-red-300 hover:bg-red-500/10`}
              >
                Убрать
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void pickImage(e.target.files?.[0])}
            />
          </div>
          <input
            type="url"
            value={surface.image.startsWith("data:") ? "" : surface.image}
            placeholder={surface.image.startsWith("data:") ? "загруженный файл" : "или ссылка https://…"}
            onChange={(e) => onChange({ image: e.target.value })}
            className={FIELD}
          />
          <Chips
            accent={false}
            options={FIT_OPTIONS.map((o) => ({ value: o.value as SurfaceFit, label: o.label }))}
            value={surface.fit}
            onChange={(v) => onChange({ fit: v })}
          />
          <Slider label="Затемнение" value={surface.dim} min={0} max={85} suffix="%" onChange={(v) => onChange({ dim: v })} />
        </div>
      ) : null}
    </div>
  );
}

function BannerEditor({
  banner,
  onChange,
  onNote,
}: {
  banner: GroupBannerCfg;
  onChange: (patch: Partial<GroupBannerCfg>) => void;
  onNote: (note: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      /* Анимация и фото идут одним путём: обрезка по центру до пропорции шапки
         и сжатие до лимита; что именно сделано — в note. */
      const res = await fitBannerFile(file, MAX_UPLOAD);
      onChange({ url: res.url, kind: "image" });
      if (res.note) onNote(res.note);
    } catch (err) {
      void alertDialog(fitErrorText(err, MAX_UPLOAD));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Chips
        options={[
          { value: "none" as const, label: "Нет" },
          { value: "image" as const, label: "Картинка" },
          { value: "gradient" as const, label: "Градиент" },
          { value: "video" as const, label: "Видео" },
        ]}
        value={banner.kind}
        onChange={(v) => onChange({ kind: v })}
      />

      {banner.kind === "image" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className={`${BTN} ${BTN_OFF} disabled:opacity-50`}
            >
              {busy ? "Обработка…" : "Загрузить"}
            </button>
            {banner.url ? (
              <button type="button" onClick={() => onChange({ url: "" })} className={`${BTN} text-red-300 hover:bg-red-500/10`}>
                Убрать
              </button>
            ) : null}
            <span className="text-[11px] text-white/30">PNG, JPG, WEBP, GIF — подгоним сами</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </div>
          <input
            type="url"
            value={banner.url.startsWith("data:") ? "" : banner.url}
            placeholder={banner.url.startsWith("data:") ? "загруженный файл" : "или ссылка https://…"}
            onChange={(e) => onChange({ url: e.target.value })}
            className={FIELD}
          />
        </div>
      ) : null}

      {banner.kind === "video" ? (
        <div className="space-y-1">
          <input
            type="url"
            value={banner.url}
            placeholder="https://…/banner.mp4"
            onChange={(e) => onChange({ url: e.target.value })}
            className={FIELD}
          />
          <p className="text-[11px] leading-snug text-white/35">
            mp4 или webm без звука. Кадр обрезается по центру автоматически.
          </p>
        </div>
      ) : null}

      {banner.kind === "gradient" ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <ColorPick label="Начало" value={banner.from} onChange={(v) => onChange({ from: v })} />
            {banner.useVia ? <ColorPick label="Середина" value={banner.via} onChange={(v) => onChange({ via: v })} /> : null}
            <ColorPick label="Конец" value={banner.to} onChange={(v) => onChange({ to: v })} />
          </div>
          <Row label="Три цвета">
            <Switch value={banner.useVia} onChange={(v) => onChange({ useVia: v })} />
          </Row>
          <Slider label="Угол" value={banner.angle} min={0} max={360} suffix="°" onChange={(v) => onChange({ angle: v })} />
        </div>
      ) : null}

      {banner.kind !== "none" ? (
        <>
          <Toggle
            label="Анимация"
            hint="Градиент плывёт, видео играет."
            value={banner.animated}
            onChange={(v) => onChange({ animated: v })}
          />
          <Slider
            label="Затемнение"
            value={banner.overlay}
            min={0}
            max={85}
            suffix="%"
            onChange={(v) => onChange({ overlay: v })}
          />
        </>
      ) : null}
    </div>
  );
}

/* ──────────────────────────── Превью ─────────────────────────── */

function surfaceStyle(s: GroupSurface, fallback: string): React.CSSProperties {
  if (s.mode === "theme") return { background: fallback };
  return {
    backgroundImage: surfaceLayer(s),
    backgroundSize: surfaceSize(s),
    backgroundRepeat: surfaceRepeat(s),
    backgroundPosition: "center",
  };
}

/** Макет сообщества в миниатюре: шапка с баннером, каналы, переписка, голосовой. */
function ThemePreview({ theme, narrow }: { theme: GroupTheme; narrow: boolean }) {
  const accent = theme.useAccent ? theme.accent : "#7c3aed";
  const font = fontStack(theme.font);
  const showBanner = theme.banner.kind !== "none" && (theme.banner.kind === "gradient" || !!theme.banner.url);
  const animatedGradient = theme.banner.animated && theme.banner.kind === "gradient";

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d13] shadow-lg"
      style={{ fontFamily: font || undefined, fontSize: `${theme.font.scale}%` }}
    >
      <div className={narrow ? "flex flex-col" : "flex"}>
        <div
          className={narrow ? "w-full" : "w-[42%] flex-shrink-0 border-r border-white/10"}
          style={surfaceStyle(theme.channels, "#14141c")}
        >
          <div className="relative overflow-hidden">
            {showBanner ? (
              <span
                className={`absolute inset-0${animatedGradient ? " tz-group-banner-animated" : ""}`}
                style={{ backgroundImage: bannerCss(theme.banner), backgroundSize: "cover", backgroundPosition: "center" }}
              />
            ) : null}
            {showBanner && theme.banner.kind === "video" && theme.banner.url ? (
              <video
                src={theme.banner.url}
                muted
                loop
                playsInline
                autoPlay={theme.banner.animated}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
            {showBanner ? (
              <span className="absolute inset-0" style={{ background: hexToRgba("#000000", theme.banner.overlay / 100) }} />
            ) : null}
            <div className="relative flex items-center gap-2 px-3 py-2.5">
              <span
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold text-white"
                style={{ background: accent }}
              >
                TZ
              </span>
              <span className="truncate text-[12px] font-medium text-white/90">Моё сообщество</span>
            </div>
          </div>

          <div className="space-y-1 px-2 pb-2 pt-1">
            {["общий", "анонсы", "флуд"].map((name, i) => (
              <div
                key={name}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                style={
                  i === 0
                    ? { background: hexToRgba(accent, 0.22), color: "#fff" }
                    : { color: "rgba(255,255,255,0.55)" }
                }
              >
                <span className="opacity-50">#</span>
                {name}
              </div>
            ))}
            <div
              className="tz-group-voice mt-1 rounded-md px-2 py-1.5 text-[11px] text-white/60"
              style={surfaceStyle(theme.voice, "rgba(255,255,255,0.04)")}
            >
              Голосовой · 2 участника
            </div>
          </div>
        </div>

        <div className="relative min-h-[168px] flex-1 overflow-hidden" style={surfaceStyle(theme.chat, "#101018")}>
          <ParticleField particles={theme.particles} inline />
          <div className="relative space-y-2 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-white/20" />
              <div className="rounded-lg rounded-tl-sm bg-white/10 px-2.5 py-1.5 text-[11px] text-white/85">
                Так выглядит сообщение участника
              </div>
            </div>
            <div className="flex justify-end">
              <div className="rounded-lg rounded-br-sm px-2.5 py-1.5 text-[11px] text-white" style={{ background: accent }}>
                А так — ваше, в акцентном цвете
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[11px] text-white/40">
              Напишите сообщение…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Основной компонент ───────────────────── */

export default function DesignPanel({ groupId, theme, onSaved }: Props) {
  const initial = useMemo(() => parseGroupTheme(theme ?? null), [theme]);
  const [draft, setDraft] = useState<GroupTheme>(initial);
  const [tab, setTab] = useState<TabId>("presets");
  const [surfaceTab, setSurfaceTab] = useState<"chat" | "channels" | "voice">("chat");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  /* Если тему поменял другой администратор, подхватываем её только пока нет
     своих правок: иначе чужое сохранение стёрло бы недоделанную тему. */
  useEffect(() => {
    if (!dirty) setDraft(initial);
  }, [initial, dirty]);

  /* Любая правка сразу включает оформление: иначе можно собрать тему, нажать
     «Сохранить» и не увидеть ничего из-за верхнего тумблера. */
  const patch = (p: Partial<GroupTheme>) => {
    setDraft((d) => ({ ...d, ...p, preset: "custom", enabled: true }));
    setDirty(true);
    setSaved(false);
  };

  const applyPreset = (build: () => GroupTheme) => {
    setDraft({ ...build(), enabled: true });
    setDirty(true);
    setSaved(false);
    setNote(null);
  };

  const payload = useMemo(() => serializeGroupTheme(draft), [draft]);
  const tooHeavy = payload.length > GROUP_THEME_MAX_JSON;

  const save = async () => {
    if (tooHeavy) {
      await alertDialog(
        "Оформление слишком тяжёлое: уберите одну из загруженных картинок или замените её ссылкой https://.",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: payload }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        await alertDialog(data.error || "Не удалось сохранить оформление");
        return;
      }
      setSaved(true);
      setDirty(false);
      onSaved?.(payload);
    } catch {
      await alertDialog("Сеть недоступна. Повторите позже.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(defaultGroupTheme());
    setDirty(true);
    setSaved(false);
    setNote(null);
  };

  const surfaces = {
    chat: { label: "Переписка", hint: "Фон чата внутри сообщества." },
    channels: { label: "Каналы", hint: "Боковая панель со списком каналов." },
    voice: { label: "Голосовые", hint: "Комнаты и панель участников звонка." },
  } as const;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      <div className="min-w-0 space-y-3">
        <div className={`${CARD} space-y-1`}>
          <Toggle
            label="Оформление сообщества"
            hint="Выключено — участники видят обычную тему."
            value={draft.enabled}
            onChange={(v) => {
              setDraft((d) => ({ ...d, enabled: v }));
              setDirty(true);
              setSaved(false);
            }}
          />
          <Toggle
            label="Главнее личного оформления"
            hint="Фон группы перекрывает личный скин участника."
            value={draft.priority}
            onChange={(v) => patch({ priority: v })}
          />
        </div>

        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs transition ${
                tab === t.id ? "bg-white/[0.12] text-white" : "text-white/50 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "presets" ? (
          <div className={`${CARD} space-y-2`}>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {GROUP_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => applyPreset(p.build)}
                  className={`rounded-lg border p-1.5 text-left transition ${
                    draft.preset === p.id ? "border-[var(--cn-accent)] bg-white/[0.06]" : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <span
                    className="mb-1 block h-7 rounded-md"
                    style={{ backgroundImage: `linear-gradient(120deg, ${p.swatch[0]}, ${p.swatch[1]}, ${p.swatch[2]})` }}
                  />
                  <span className="block truncate text-[11px] text-white/80">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-white/35">
              Пресет — стартовая точка: любой параметр меняется на соседних вкладках.
            </p>
          </div>
        ) : null}

        {tab === "surfaces" ? (
          <div className={`${CARD} space-y-2`}>
            <Chips
              accent={false}
              options={(Object.keys(surfaces) as (keyof typeof surfaces)[]).map((k) => ({
                value: k,
                label: surfaces[k].label,
              }))}
              value={surfaceTab}
              onChange={(v) => setSurfaceTab(v)}
            />
            <p className="text-[11px] text-white/35">{surfaces[surfaceTab].hint}</p>
            <SurfaceEditor
              surface={draft[surfaceTab]}
              onChange={(p) => patch({ [surfaceTab]: { ...draft[surfaceTab], ...p } } as Partial<GroupTheme>)}
              onNote={setNote}
            />
          </div>
        ) : null}

        {tab === "banner" ? (
          <div className={CARD}>
            <BannerEditor banner={draft.banner} onChange={(p) => patch({ banner: { ...draft.banner, ...p } })} onNote={setNote} />
          </div>
        ) : null}

        {tab === "accent" ? (
          <div className={`${CARD} space-y-2`}>
            <Toggle
              label="Свой акцентный цвет"
              hint="Кнопки, активные каналы, выделения."
              value={draft.useAccent}
              onChange={(v) => patch({ useAccent: v })}
            />
            {draft.useAccent ? <ColorPick label="Акцент" value={draft.accent} onChange={(v) => patch({ accent: v })} /> : null}

            <Chips
              accent={false}
              options={[
                { value: "theme" as const, label: "Шрифт темы" },
                { value: "builtin" as const, label: "Шрифт сообщества" },
              ]}
              value={draft.font.mode}
              onChange={(v) => patch({ font: { ...draft.font, mode: v } })}
            />

            {draft.font.mode === "builtin" ? (
              <div className="space-y-2">
                <select
                  value={draft.font.family}
                  onChange={(e) => patch({ font: { ...draft.font, family: e.target.value } })}
                  className={FIELD}
                >
                  {GROUP_FONTS.map((f) => (
                    <option key={f.id} value={f.id} className="bg-[#15151c]">
                      {f.label}
                    </option>
                  ))}
                </select>
                <Slider
                  label="Размер текста"
                  value={draft.font.scale}
                  min={90}
                  max={115}
                  suffix="%"
                  onChange={(v) => patch({ font: { ...draft.font, scale: v } })}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "particles" ? (
          <div className={`${CARD} space-y-2`}>
            <Chips
              options={PARTICLE_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
              value={draft.particles.kind}
              onChange={(v) => patch({ particles: { ...draft.particles, kind: v } })}
            />
            {draft.particles.kind !== "none" ? (
              <div className="space-y-1">
                <Slider
                  label="Плотность"
                  value={draft.particles.density}
                  min={5}
                  max={100}
                  suffix="%"
                  onChange={(v) => patch({ particles: { ...draft.particles, density: v } })}
                />
                <Slider
                  label="Скорость"
                  value={draft.particles.speed}
                  min={20}
                  max={200}
                  suffix="%"
                  onChange={(v) => patch({ particles: { ...draft.particles, speed: v } })}
                />
                <Slider
                  label="Размер"
                  value={draft.particles.size}
                  min={1}
                  max={16}
                  onChange={(v) => patch({ particles: { ...draft.particles, size: v } })}
                />
                <Slider
                  label="Прозрачность"
                  value={draft.particles.opacity}
                  min={5}
                  max={60}
                  suffix="%"
                  onChange={(v) => patch({ particles: { ...draft.particles, opacity: v } })}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <ColorPick
                    label="Цвет частиц"
                    value={draft.particles.color}
                    onChange={(v) => patch({ particles: { ...draft.particles, color: v } })}
                  />
                  <label className="flex items-center gap-2 text-[11px] text-white/55">
                    Реагировать на курсор
                    <Switch
                      value={draft.particles.interactive}
                      onChange={(v) => patch({ particles: { ...draft.particles, interactive: v } })}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {note ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-snug text-amber-200">
            <span>{note}</span>
            <button type="button" onClick={() => setNote(null)} className="text-amber-200/60 hover:text-amber-100">
              ✕
            </button>
          </div>
        ) : null}

        {tooHeavy ? (
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] leading-snug text-red-200">
            Оформление весит {Math.round(payload.length / 1024)} КБ — больше лимита. Замените одну из картинок ссылкой https://.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || tooHeavy}
            className="rounded-lg bg-[var(--cn-accent)] px-4 py-2 text-sm text-white transition disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5"
          >
            Сбросить
          </button>
          {saved ? <span className="text-xs text-emerald-300">Сохранено</span> : null}
          {!saved && dirty ? <span className="text-xs text-white/35">Есть несохранённые правки</span> : null}
        </div>
      </div>

      <div className="min-w-0">
        <div className="space-y-2 lg:sticky lg:top-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">Превью</span>
            <Chips
              accent={false}
              options={[
                { value: "wide" as const, label: "Компьютер" },
                { value: "narrow" as const, label: "Телефон" },
              ]}
              value={narrow ? "narrow" : "wide"}
              onChange={(v) => setNarrow(v === "narrow")}
            />
          </div>
          <div className={narrow ? "mx-auto max-w-[240px]" : ""}>
            <ThemePreview theme={draft} narrow={narrow} />
          </div>
          <p className="text-[11px] leading-snug text-white/30">
            {draft.enabled
              ? "Так сообщество увидят участники после сохранения."
              : "Оформление выключено: участники увидят обычную тему."}
          </p>
        </div>
      </div>
    </div>
  );
}
