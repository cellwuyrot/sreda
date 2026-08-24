
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
