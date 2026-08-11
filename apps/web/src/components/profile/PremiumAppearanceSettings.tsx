"use client";

/**
 * PREMIUM-SKIN: «Своё оформление» — блок в разделе «Настройки → Внешний вид».
 *
 * Рядом уже есть выбор темы — четыре готовых пресета. Здесь сознательно
 * другой подход: никаких готовых наборов, человек сам собирает оболочку из
 * трёх независимых частей — фон переписки, палитра областей и шрифт.
 * Каждая часть включается отдельно: можно поставить только фон чата и
 * оставить штатные цвета.
 *
 * Почему вкладки, а не один столбец: полей около двадцати, одним списком они
 * превращаются в простыню. Разметка и примитивы взяты из
 * components/settings/SettingsUI.tsx — те же, что у «Кастомизации чата», чтобы
 * раздел не выглядел чужим.
 *
 * Доступ: только Premium (включая администратора по роли — правило одно и
 * живёт в lib/premium.ts). Без подписки блок не прячется, а показывается
 * замкнутым: человек должен видеть, что именно даёт подписка, иначе функция
 * для него просто не существует.
 *
 * Сохранение — сразу, как у всего раздела настроек: правка внешнего вида,
 * которую надо «подтверждать», бессмысленна — результат виден глазами.
 */

import { useEffect, useState } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";
import {
  BACKGROUND_MODE_OPTIONS,
  BUILTIN_FONTS,
  FIT_OPTIONS,
  PALETTE_FIELDS,
  PREMIUM_SKIN_DEFAULT,
  type PremiumSkin,
  type SkinBackground,
  type SkinPalette,
  type SkinFontMode,
  applyPremiumSkin,
  backgroundLayer,
  backgroundRepeat,
  backgroundSize,
  defaultPremiumSkin,
  fontStack,
  isPremiumSkinDefault,
  loadPremiumSkin,
  savePremiumSkin,
} from "@/lib/premiumSkin";
import {
  SettingsCard,
  SettingsChoice as Choice,
  SettingsGroup as Group,
  SettingsRow as Row,
  SettingsSlider as Slider,
  SettingsSwitch as Switch,
  SettingsTabs,
} from "@/components/settings/SettingsUI";

type TabId = "chat" | "palette" | "font";

const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Фон чата" },
  { id: "palette", label: "Палитра" },
  { id: "font", label: "Шрифт" },
];

const FONT_MODE_OPTIONS: { value: SkinFontMode; label: string }[] = [
  { value: "theme", label: "Как в теме" },
  { value: "builtin", label: "Из списка" },
  { value: "custom", label: "Свой" },
];

/** Текстовое поле в едином стиле раздела настроек. */
const inputClass =
  "w-full px-3 py-2 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 " +
  "text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none " +
  "focus:border-violet-500 dark:focus:border-cyan-500 transition-colors";

/**
 * Выбор цвета: системная пипетка плюс поле с HEX.
 *
 * Одной пипетки мало: фирменные цвета люди знают кодом и вставляют его
 * буфером, а попасть мышью в #00d4ff невозможно. Компонент объявлен вне
 * основного: вложенное объявление пересоздавало бы узлы на каждом рендере
 * и поле теряло бы фокус после каждого символа.
 */
function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Выбрать цвет"
        className="h-8 w-10 rounded-lg border border-neutral-200 dark:border-white/10 bg-transparent p-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <input
        type="text"
        value={value}
        disabled={disabled}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Код цвета"
        className="w-24 px-2 py-1 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-[11px] font-mono text-neutral-700 dark:text-neutral-200 outline-none focus:border-violet-500 dark:focus:border-cyan-500 disabled:opacity-50"
      />
    </div>
  );
}

export default function PremiumAppearanceSettings({ isPremium }: { isPremium: boolean }) {
  const [skin, setSkin] = useState<PremiumSkin>(PREMIUM_SKIN_DEFAULT);
  const [tab, setTab] = useState<TabId>("chat");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  /* localStorage читается только после монтирования: на сервере его нет, а
     расхождение разметки сервера и клиента даёт ошибку гидратации. */
  useEffect(() => {
    const loaded = loadPremiumSkin();
    setSkin(loaded);
    /* Без подписки оформление не применяется, но и не стирается: после
       продления всё подобранное должно вернуться само. */
    applyPremiumSkin(isPremium ? loaded : { ...loaded, enabled: false });
  }, [isPremium]);

  function update(patch: Partial<PremiumSkin>) {
    setSkin((prev) => savePremiumSkin({ ...prev, ...patch }));
  }

  function updateBackground(patch: Partial<SkinBackground>) {
    setSkin((prev) => savePremiumSkin({ ...prev, chat: { ...prev.chat, ...patch } }));
  }

  function reset() {
    setSkin(savePremiumSkin(defaultPremiumSkin()));
    setError("");
  }

  /**
   * Загрузка картинки идёт через уже существующий /api/upload/document.
   *
   * Админский маршрут загрузки картинок закрыт для обычных пользователей, а
   * этот доступен любому вошедшему и уже принимает JPG, PNG и WEBP с проверкой
   * размера и с генерацией имени на сервере. Заводить ради фона третий
   * маршрут с теми же проверками было бы дублированием.
   */
  async function uploadImage(file: File) {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/document", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        setError(typeof data?.error === "string" ? data.error : "Не удалось загрузить картинку");
        return;
      }
      updateBackground({ imageUrl: data.url as string, mode: "image" });
    } catch {
      setError("Сеть недоступна — попробуйте ещё раз");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Форма заднего фона переписки.
   *
   * Это именно функция отрисовки, а не вложенный компонент. Компонент,
   * объявленный внутри другого, создаётся заново на каждом рендере, и React
   * считает его другим типом узла: поддерево каждый раз размонтируется.
   *
   * Скрытое поле выбора файла открывается через <label htmlFor>, а не через
   * ref.current.click(): штатная связка label ↔ input даёт тот же результат без
   * ссылок на DOM и попутно работает с клавиатуры и со скринридерами.
   *
   * Поля с адресом картинки здесь нет намеренно: путь вроде
   * /uploads/documents/… — внутренняя кухня хранилища, и показывать его ��
   * настройках незачем. Картинка выбирается кнопкой.
   */
  function renderChatBackgroundForm() {
    const bg = skin.chat;
    const fileInputId = "skin-file-chat";
    return (
      <Group>
        <Row label="Чем залить" hint="Фон ленты сообщений — и в каналах сообществ, и в личных сообщениях.">
          <Choice
            options={BACKGROUND_MODE_OPTIONS}
            value={bg.mode}
            onChange={(mode) => updateBackground({ mode })}
          />
        </Row>

        {bg.mode === "color" && (
          <Row label="Цвет">
            <ColorField value={bg.color} onChange={(color) => updateBackground({ color })} />
          </Row>
        )}

        {bg.mode === "image" && (
          <>
            <Row label="Картинка" hint="JPG, PNG или WEBP до 10 МБ.">
              <div className="flex items-center gap-2">
                <input
                  id={fileInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadImage(file);
                    e.target.value = "";
                  }}
                />
                <label
                  htmlFor={fileInputId}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:border-violet-500 dark:hover:border-cyan-500 transition-colors cursor-pointer ${
                    uploading ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  {uploading ? "Загружаем…" : bg.imageUrl ? "Заменить" : "Выбрать картинку"}
                </label>
                {bg.imageUrl && (
                  <button
                    type="button"
                    onClick={() => updateBackground({ imageUrl: "" })}
                    className="px-2.5 py-1 rounded-lg text-[11px] border border-neutral-200 dark:border-white/10 text-neutral-500 hover:border-red-500 hover:text-red-500 transition-colors"
                  >
                    Убрать
                  </button>
                )}
              </div>
            </Row>

            <Row label="Раскладка">
              <Choice options={FIT_OPTIONS} value={bg.fit} onChange={(fit) => updateBackground({ fit })} />
            </Row>

            <Row label="Затемнение" hint="На светлой картинке текст нечитаем — затемнение возвращает контраст.">
              <Slider
                id="skin-dim-chat"
                min={0}
                max={85}
                step={5}
                value={bg.dim}
                unit="%"
                onChange={(dim) => updateBackground({ dim })}
              />
            </Row>
          </>
        )}
      </Group>
    );
  }

  /* ── Предпросмотр: уменьшенный макет /connect в три колонки ──────── */
  const p = skin.palette;
  const paletteOn = skin.enabled && p.enabled;
  const previewText = paletteOn ? p.text : undefined;
  const previewMuted = paletteOn ? p.muted : undefined;
  const previewFont = skin.enabled ? fontStack(skin.font) : "";

  function previewLayer(): React.CSSProperties {
    if (!skin.enabled) return {};
    const bg = skin.chat;
    return {
      backgroundImage: backgroundLayer(bg),
      backgroundSize: backgroundSize(bg),
      backgroundRepeat: backgroundRepeat(bg),
      backgroundPosition: "center",
    };
  }

  return (
    <SettingsCard
      title={
        <>
          Своё оформление TZ.Connect
          <span className="ml-1 align-middle text-[10px] font-semibold text-amber-500">Premium</span>
          <InfoTooltip
            text="Здесь нет готовых пресетов: фон переписки, цвета областей и шрифт выбираются по отдельности и ложатся поверх выбранной темы. Настройка хранится на этом устройстве и видна только вам."
            side="bottom"
          />
        </>
      }
      subtitle="Фон переписки, цвета отдельных областей и собственный шрифт."
    >
      {!isPremium ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <p className="text-sm text-neutral-700 dark:text-gray-300">
            Свободная кастомизация доступна при активной подписке Premium.
          </p>
          <p className="text-xs text-neutral-500 dark:text-gray-400 mt-1">
            В неё входят: задний фон чатов (цвет или своя картинка), палитра всего /connect
            с отдельным цветом шрифта и каждой области, а также собственный шрифт
            интерфейса.
          </p>
        </div>
      ) : (
        <>
          {/* Предпросмотр виден на всех вкладках: иначе после каждой правки
              пришлось бы уходить в /connect и возвращаться. */}
          <div
            className="rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden"
            style={{ fontFamily: previewFont || undefined }}
          >
            <div className="flex h-36">
              <div
                className="w-8 flex flex-col items-center gap-1.5 py-2"
                style={{ background: paletteOn ? p.rail : "var(--cn-rail)" }}
              >
                <span className="w-4 h-4 rounded-lg" style={{ background: paletteOn ? p.accent : "var(--cn-accent)" }} />
                <span className="w-4 h-4 rounded-lg opacity-40" style={{ background: paletteOn ? p.muted : "var(--cn-muted)" }} />
                <span className="w-4 h-4 rounded-lg opacity-40" style={{ background: paletteOn ? p.muted : "var(--cn-muted)" }} />
              </div>

              <div
                className="w-24 p-2 space-y-1.5 border-x"
                style={{
                  background: paletteOn ? p.sidebar : "var(--cn-sidebar)",
                  borderColor: paletteOn ? p.border : "var(--cn-border)",
                }}
              >
                <p className="text-[9px] font-semibold" style={{ color: previewText }}>Каналы</p>
                <p
                  className="text-[9px] rounded-md px-1 py-0.5"
                  style={{
                    color: paletteOn ? p.accent : "var(--cn-accent-text)",
                    background: paletteOn ? `${p.accent}1f` : "var(--cn-accent-dim)",
                  }}
                >
                  # общий
                </p>
                <p className="text-[9px]" style={{ color: previewMuted }}># дизайн</p>
                <p className="text-[9px]" style={{ color: previewMuted }}># релизы</p>
              </div>

              <div className="flex-1 flex flex-col min-w-0" style={{ background: paletteOn ? p.main : "var(--cn-main)" }}>
                <div
                  className="h-6 px-2 flex items-center text-[9px] border-b"
                  style={{ color: previewText, borderColor: paletteOn ? p.border : "var(--cn-border)" }}
                >
                  # общий
                </div>
                <div className="flex-1 p-2 space-y-1.5" style={previewLayer()}>
                  <div>
                    <span className="text-[9px] font-semibold" style={{ color: paletteOn ? p.accent : "var(--cn-accent-text)" }}>
                      Михаил
                    </span>{" "}
                    <span className="text-[9px]" style={{ color: previewMuted }}>14:30</span>
                    <p className="text-[10px]" style={{ color: previewText }}>Собираемся на созвон?</p>
                  </div>
                  <div>
                    <span className="text-[9px] font-semibold" style={{ color: previewText }}>Анна</span>
                    <p className="text-[10px]" style={{ color: previewText }}>Да, через десять минут</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Row
            label="Включить своё оформление"
            hint="Общий выключатель. Выключение возвращает вид темы, не теряя подобранного."
          >
            <Switch checked={skin.enabled} onChange={() => update({ enabled: !skin.enabled })} label="Своё оформление" />
          </Row>

          <div className={skin.enabled ? undefined : "opacity-50 pointer-events-none"}>
            <SettingsTabs tabs={TABS} value={tab} onChange={setTab} />

            <div className="pt-3">
              {tab === "chat" && renderChatBackgroundForm()}

              {tab === "palette" && (
                <Group>
                  <Row
                    label="Своя палитра"
                    hint="Заменяет цвета темы во всём /connect. Лучше всего работает поверх тёмной и светлой тем: у монохромных часть поверхностей задана жёстко."
                  >
                    <Switch
                      checked={p.enabled}
                      onChange={() => update({ palette: { ...p, enabled: !p.enabled } })}
                      label="Своя палитра"
                    />
                  </Row>

                  {PALETTE_FIELDS.map((field) => (
                    <Row key={field.key} label={field.label} hint={field.hint}>
                      <ColorField
                        value={p[field.key]}
                        disabled={!p.enabled}
                        onChange={(hex) => update({ palette: { ...p, [field.key]: hex } as SkinPalette })}
                      />
                    </Row>
                  ))}
                </Group>
              )}

              {tab === "font" && (
                <Group>
                  <Row label="Шрифт интерфейса" hint="Код и моноширинные блоки остаются моноширинными в любом случае.">
                    <Choice
                      options={FONT_MODE_OPTIONS}
                      value={skin.font.mode}
                      onChange={(mode) => update({ font: { ...skin.font, mode } })}
                    />
                  </Row>

                  {skin.font.mode === "builtin" && (
                    <Row label="Семейство">
                      <Choice
                        options={BUILTIN_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                        value={skin.font.builtin}
                        onChange={(builtin) => update({ font: { ...skin.font, builtin } })}
                      />
                    </Row>
                  )}

                  {skin.font.mode === "custom" && (
                    <div className="py-2 space-y-2">
                      <div>
                        <label className="block text-[11px] text-neutral-500 dark:text-gray-400 mb-1">
                          Название семейства
                        </label>
                        <input
                          type="text"
                          value={skin.font.customName}
                          spellCheck={false}
                          placeholder="Например, JetBrains Mono"
                          onChange={(e) => update({ font: { ...skin.font, customName: e.target.value } })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-neutral-500 dark:text-gray-400 mb-1">
                          Адрес файла шрифта — необязательно
                        </label>
                        <input
                          type="text"
                          value={skin.font.customUrl}
                          spellCheck={false}
                          placeholder="https://…/font.woff2"
                          onChange={(e) => update({ font: { ...skin.font, customUrl: e.target.value } })}
                          className={inputClass}
                        />
                      </div>
                      <p className="text-[11px] text-neutral-500 dark:text-gray-400">
                        Если шрифт уже установлен в системе, достаточно названия — файл не понадобится.
                        Подходят форматы WOFF2, WOFF, TTF и OTF.
                      </p>
                      <p className="text-sm text-neutral-700 dark:text-gray-300" style={{ fontFamily: previewFont || undefined }}>
                        Съешь ещё этих мягких французских булок — 0123456789
                      </p>
                    </div>
                  )}
                </Group>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-neutral-400 dark:text-gray-500">
              Настройка хранится на этом устройстве и не меняет вид чата для собеседников.
            </p>
            <button
              type="button"
              onClick={reset}
              disabled={isPremiumSkinDefault(skin)}
              className="px-2.5 py-1 rounded-lg text-[11px] border border-neutral-200 dark:border-white/10 text-neutral-500 hover:border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Сбросить
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
