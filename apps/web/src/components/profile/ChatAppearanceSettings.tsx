"use client";

/**
 * «Кастомизация чата» — блок в разделе «Настройки → TZ.Connect».
 *
 * Появился из-за конкретной жалобы: имя автора сливалось с текстом сообщения.
 * Разница между ними была только в весе шрифта на одинаковом размере, и на
 * таком размере её почти не видно. Базовые значения теперь другие, но
 * «читаемо» у каждого своё, поэтому размеры отданы пользователю.
 *
 * Настройки не уходят на сервер: это внешний вид на конкретном устройстве, а не
 * свойство аккаунта. Хранятся в localStorage, применяются CSS-переменными на
 * корне документа (см. lib/chatAppearance.ts).
 *
 * Раздел разбит на вкладки не для красоты: настроек больше десятка, и одним
 * столбцом они превращаются в простыню, где ничего не найти. Предпросмотр
 * вынесен наверх и виден на всех вкладках — иначе пришлось бы уходить в чат и
 * возвращаться после каждой правки.
 */

import { useEffect, useState } from "react";
import {
  CHAT_APPEARANCE_DEFAULT,
  ChatAppearance,
  ChatDensity,
  ChatNameColor,
  ChatTimeFormat,
  DENSITY_OPTIONS,
  MAX_WIDTH_OPTIONS,
  applyChatAppearance,
  formatMessageTime,
  loadChatAppearance,
  saveChatAppearance,
} from "@/lib/chatAppearance";
import InfoTooltip from "@/components/ui/InfoTooltip";
import {
  SettingsCard,
  SettingsChoice as Choice,
  SettingsRow as Row,
  SettingsSlider as Slider,
  SettingsSwitch as Switch,
  SettingsTabs,
} from "@/components/settings/SettingsUI";

type TabId = "feed" | "font" | "names" | "behaviour" | "privacy";

const TABS: { id: TabId; label: string }[] = [
  { id: "feed", label: "Лента" },
  { id: "font", label: "Шрифт" },
  { id: "names", label: "Имена" },
  { id: "behaviour", label: "Поведение" },
  { id: "privacy", label: "Приватность" },
];

const WEIGHT_OPTIONS: { value: number; label: string }[] = [
  { value: 500, label: "Обычное" },
  { value: 600, label: "Полужирное" },
  { value: 700, label: "Жирное" },
];

const LEADING_OPTIONS: { value: number; label: string }[] = [
  { value: 1.35, label: "Плотно" },
  { value: 1.55, label: "Обычно" },
  { value: 1.8, label: "Свободно" },
];

const NAME_COLOR_OPTIONS: { value: ChatNameColor; label: string }[] = [
  { value: "role", label: "По роли" },
  { value: "plain", label: "Единый" },
];

const TIME_OPTIONS: { value: ChatTimeFormat; label: string }[] = [
  { value: "24", label: "14:30" },
  { value: "12", label: "2:30 PM" },
];

/** Цвет роли для предпросмотра — в чате берётся настоящий цвет роли. */
const PREVIEW_ROLE_COLOR = "#a78bfa";
const PREVIEW_DENSITY_PAD: Record<ChatDensity, number> = { compact: 0, cozy: 2, roomy: 7 };

export default function ChatAppearanceSettings() {
  const [prefs, setPrefs] = useState<ChatAppearance>(CHAT_APPEARANCE_DEFAULT);
  const [tab, setTab] = useState<TabId>("feed");
  const [touched, setTouched] = useState(false);

  /* Читаем localStorage только после монтирования: на сервере его нет, а
     расхождение разметки сервера и клиента даёт ошибку гидратации. */
  useEffect(() => {
    const loaded = loadChatAppearance();
    setPrefs(loaded);
    applyChatAppearance(loaded);
  }, []);

  /** Правка применяется сразу: ползунок, который надо «подтверждать», бесполезен. */
  function update(patch: Partial<ChatAppearance>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveChatAppearance(next);
      return next;
    });
    setTouched(true);
  }

  function reset() {
    setPrefs(CHAT_APPEARANCE_DEFAULT);
    saveChatAppearance(CHAT_APPEARANCE_DEFAULT);
    setTouched(true);
  }

  const isDefault = (Object.keys(CHAT_APPEARANCE_DEFAULT) as (keyof ChatAppearance)[])
    .every((key) => prefs[key] === CHAT_APPEARANCE_DEFAULT[key]);

  const previewTime = formatMessageTime(new Date(2026, 6, 31, 14, 30), prefs.timeFormat);

  return (
    <SettingsCard
      title={
        <>
          Кастомизация чата
          <InfoTooltip
            text="Внешний вид переписки. Правки применяются сразу, отдельная кнопка сохранения не нужна. Настройка хранится на этом устройстве и не влияет на то, как чат видят другие."
            side="bottom"
          />
        </>
      }
    >
      {/* Предпросмотр повторяет строку чата и виден на всех вкладках. */}
      <div className="p-4 bg-neutral-50 dark:bg-white/5 rounded-xl border border-neutral-200 dark:border-white/5 overflow-hidden">
        <div
          className="flex items-start gap-3"
          style={{
            maxWidth: prefs.maxWidth > 0 ? prefs.maxWidth : undefined,
            paddingBlock: PREVIEW_DENSITY_PAD[prefs.density],
          }}
        >
          {prefs.showAvatars && (
            <div className="w-9 h-9 flex-shrink-0 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 dark:from-cyan-400 dark:to-blue-500" />
          )}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                style={{
                  fontSize: `${prefs.authorSize}px`,
                  fontWeight: prefs.authorWeight,
                  lineHeight: 1.25,
                  letterSpacing: "-0.01em",
                  color: prefs.nameColor === "role" ? PREVIEW_ROLE_COLOR : undefined,
                }}
                className={prefs.nameColor === "role" ? undefined : "text-neutral-900 dark:text-white"}
              >
                Михаил
              </span>
              {prefs.showUsername && <span className="text-xs text-neutral-400 dark:text-gray-500">@mikhail</span>}
              {prefs.showRoleTags && (
                <span
                  className="text-[10px] leading-none px-1.5 py-0.5 rounded-md border"
                  style={{ color: PREVIEW_ROLE_COLOR, borderColor: `${PREVIEW_ROLE_COLOR}55`, background: `${PREVIEW_ROLE_COLOR}14` }}
                >
                  Команда
                </span>
              )}
              <span className="text-xs text-neutral-400 dark:text-gray-600">{previewTime}</span>
            </div>
            <p
              className="text-neutral-700 dark:text-gray-300 mt-0.5"
              style={{ fontSize: `${prefs.bodySize}px`, lineHeight: prefs.bodyLeading }}
            >
              Привет, сегодня собираемся на созвон
            </p>
          </div>
        </div>
      </div>

      <SettingsTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "feed" && (
        <div className="divide-y divide-neutral-100 dark:divide-white/5">
          <Row label="Ширина ленты" hint="На широком мониторе строка тянется через весь экран и читается тяжело.">
            <Choice options={MAX_WIDTH_OPTIONS} value={prefs.maxWidth} onChange={(v) => update({ maxWidth: v })} />
          </Row>
          <Row label="Плотность" hint="Вертикальные отступы между сообщениями.">
            <Choice options={DENSITY_OPTIONS} value={prefs.density} onChange={(v) => update({ density: v })} />
          </Row>
          <Row label="Аватары в ленте" hint="Без них лента компактнее, но авторы узнаются хуже.">
            <Switch checked={prefs.showAvatars} onChange={() => update({ showAvatars: !prefs.showAvatars })} label="Аватары в ленте" />
          </Row>
          <Row label="Формат времени">
            <Choice options={TIME_OPTIONS} value={prefs.timeFormat} onChange={(v) => update({ timeFormat: v })} />
          </Row>
          <Row
            label="Группировать сообщения"
            hint="Подряд идущие сообщения одного автора внутри этого интервала показываются без повторной шапки. 0 — каждое сообщение отдельно."
          >
            <Slider id="tz-group-window" min={0} max={15} step={1} value={prefs.groupWindowMin} unit=" мин" onChange={(v) => update({ groupWindowMin: v })} />
          </Row>
        </div>
      )}

      {tab === "font" && (
        <div className="divide-y divide-neutral-100 dark:divide-white/5">
          <Row label="Размер имени">
            <Slider id="tz-author-size" min={13} max={19} step={1} value={prefs.authorSize} unit="px" onChange={(v) => update({ authorSize: v })} />
          </Row>
          <Row label="Насыщенность имени">
            <Choice options={WEIGHT_OPTIONS} value={prefs.authorWeight} onChange={(v) => update({ authorWeight: v })} />
          </Row>
          <Row label="Размер текста">
            <Slider id="tz-body-size" min={12} max={18} step={1} value={prefs.bodySize} unit="px" onChange={(v) => update({ bodySize: v })} />
          </Row>
          <Row label="Межстрочное расстояние">
            <Choice options={LEADING_OPTIONS} value={prefs.bodyLeading} onChange={(v) => update({ bodyLeading: v })} />
          </Row>
        </div>
      )}

      {tab === "names" && (
        <div className="divide-y divide-neutral-100 dark:divide-white/5">
          <Row label="Цвет имени" hint="«По роли» берёт цвет роли участника в сообществе — его задаёт владелец в настройках ролей.">
            <Choice options={NAME_COLOR_OPTIONS} value={prefs.nameColor} onChange={(v) => update({ nameColor: v })} />
          </Row>
          <Row label="Показывать @ник" hint="Ник постоянный и общий для всех сообществ, в отличие от имени.">
            <Switch checked={prefs.showUsername} onChange={() => update({ showUsername: !prefs.showUsername })} label="Показывать ник" />
          </Row>
          <Row label="Теги ролей в ленте" hint="Раньше показывались всегда и занимали половину строки. Теперь по желанию.">
            <Switch checked={prefs.showRoleTags} onChange={() => update({ showRoleTags: !prefs.showRoleTags })} label="Теги ролей" />
          </Row>
        </div>
      )}

      {tab === "behaviour" && (
        <div className="divide-y divide-neutral-100 dark:divide-white/5">
          <Row
            label="Enter отправляет"
            hint="Выключено — Enter переносит строку, а отправляет Ctrl+Enter. На сенсорных экранах Enter всегда переносит строку."
          >
            <Switch checked={prefs.sendOnEnter} onChange={() => update({ sendOnEnter: !prefs.sendOnEnter })} label="Enter отправляет" />
          </Row>
          <Row
            label="Следовать за новыми"
            hint="Выключено — лента не уезжает вниз при новом сообщении, пока вы читаете историю."
          >
            <Switch checked={prefs.autoScroll} onChange={() => update({ autoScroll: !prefs.autoScroll })} label="Следовать за новыми сообщениями" />
          </Row>
          <Row
            label="Разворачивать ссылки"
            hint="Под сообщением появляется карточка с заголовком и описанием страницы. Данные приносит сервер, ваш адрес владельцу ссылки не раскрывается."
          >
            <Switch checked={prefs.linkPreviews} onChange={() => update({ linkPreviews: !prefs.linkPreviews })} label="Разворачивать ссылки" />
          </Row>
        </div>
      )}

      {tab === "privacy" && (
        <div className="divide-y divide-neutral-100 dark:divide-white/5">
          <Row
            label="Отправлять отметки о прочтении"
            hint="Выключено — автор не увидит галочку «прочитано». Обратная сторона: сервер перестанет запоминать прочитанное, и граница непрочитанного будет считаться заново при каждом входе."
          >
            <Switch checked={prefs.sendReadReceipts} onChange={() => update({ sendReadReceipts: !prefs.sendReadReceipts })} label="Отметки о прочтении" />
          </Row>
          <Row
            label="Скрывать текст в уведомлениях"
            hint="Во всплывающем окне остаётся только имя отправителя. Полезно, когда на экран смотрят посторонние."
          >
            <Switch checked={prefs.hideNotificationText} onChange={() => update({ hideNotificationText: !prefs.hideNotificationText })} label="Скрывать текст в уведомлениях" />
          </Row>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={reset}
          disabled={isDefault}
          className="px-4 py-2 rounded-xl text-xs font-medium border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          Вернуть по умолчанию
        </button>
        {touched && !isDefault && (
          <span className="text-xs text-green-600 dark:text-green-400">Применено</span>
        )}
      </div>
    </SettingsCard>
  );
}
