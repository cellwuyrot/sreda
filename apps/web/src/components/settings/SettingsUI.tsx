"use client";

/**
 * Общие примитивы разметки для раздела «Настройки → TZ.Connect».
 *
 * До этого модуля одни и те же кнопки-переключатели, вкладки и карточки были
 * скопированы в нескольких местах с мелкими расхождениями: где-то заголовок
 * h3, где-то p, где-то переключатель слева, где-то справа. В результате
 * раздел выглядел так, будто его собирали разные люди в разное время.
 * Здесь — единая грамматика «подпись слева, контрол справа», один источник
 * классов на карточку, группу строк и вкладки, чтобы визуальные отличия не
 * расползались снова при следующей правке.
 *
 * Row/Choice/Switch/Slider перенесены дословно из ChatAppearanceSettings.tsx
 * (переименованы с приставкой Settings), логика и классы не менялись.
 */

import InfoTooltip from "@/components/ui/InfoTooltip";

export function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        {label}
        {hint && <InfoTooltip text={hint} />}
      </span>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function SettingsChoice<T extends string | number>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
            value === opt.value
              ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      onClick={onChange}
      aria-label={label}
      aria-pressed={checked}
      className={`relative w-10 h-5.5 rounded-full transition-colors ${checked ? "bg-violet-600 dark:bg-cyan-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
      style={{ height: 22 }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "none" }}
      />
    </button>
  );
}

export function SettingsSlider({
  id, min, max, step, value, unit, onChange,
}: {
  id: string; min: number; max: number; step: number; value: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 w-40">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="flex-1 accent-violet-500 dark:accent-cyan-500"
      />
      <span className="w-12 text-right text-[11px] font-mono text-violet-500 dark:text-cyan-400">
        {value}{unit}
      </span>
    </div>
  );
}

/** Карточка-контейнер: одинаковые отступы и оформление у каждого блока настроек. */
export function SettingsCard({
  title, subtitle, children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Группа строк с разделителями — единый способ собрать список настроек. */
export function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-neutral-100 dark:divide-white/5">
      {children}
    </div>
  );
}

/** Горизонтальные вкладки с подчёркиванием активной — как в ChatAppearanceSettings. */
export function SettingsTabs<T extends string>({
  tabs, value, onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5 border-b border-neutral-200 dark:border-white/10">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
            value === t.id
              ? "border-violet-500 dark:border-cyan-400 text-violet-600 dark:text-cyan-400"
              : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
