"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import InfoTooltip from "@/components/ui/InfoTooltip";

/*
  Настройки рабочего модуля (раздела) группы: просмотр и редактирование.

  Открывается по шестерёнке в шапке модуля (задачи, база знаний и т.д.).
  Кнопка показывается только при canModerate; сервер дополнительно
  проверяет права в PUT /api/channels/[id].

  Хранение — существующие поля канала, миграции БД не требуются:
   - postAccess: "ADMIN" | "MOD" | "ALL"  -> кто может редактировать;
   - isRestricted + список ролей        -> кто может читать (все или выбранные роли).

  FIX-QAACL: для раздела «Вопросы-ответы» добавлены ещё два независимых права —
  кто может задавать вопросы и кто может отвечать. Помимо встроенных ролей их
  можно выдать по тегам группы (режим «Выбранные теги»).
*/

type GroupRole = { id: string; name: string; color: string };

type ChannelInfo = {
  id: string;
  name: string;
  groupId: string;
  type: string;
  postAccess: string;
  isRestricted: boolean;
  roleIds?: string[];
  /** FIX-QAACL: ALL | MOD | ADMIN | ROLES */
  askAccess?: string;
  answerAccess?: string;
  askRoleIds?: string[];
  answerRoleIds?: string[];
};

/** FIX-QAACL: режимы доступа к вопросам и ответам. */
type QaAccess = "ALL" | "MOD" | "ADMIN" | "ROLES";
const QA_OPTIONS: { value: QaAccess; label: string }[] = [
  { value: "ALL", label: "Все участники" },
  { value: "ROLES", label: "Выбранные теги" },
  { value: "MOD", label: "Создатель + модераторы" },
  { value: "ADMIN", label: "Только создатель и админ" },
];
const asQaAccess = (v: unknown): QaAccess =>
  v === "MOD" || v === "ADMIN" || v === "ROLES" ? v : "ALL";

const EDIT_OPTIONS: { value: "MOD" | "ADMIN" | "ALL"; label: string; hint: string }[] = [
  { value: "MOD", label: "Создатель + модераторы", hint: "рекомендуемый режим" },
  { value: "ADMIN", label: "Только создатель и админ", hint: "модераторы — только чтение" },
  { value: "ALL", label: "Все участники", hint: "редактировать может каждый" },
];

/* Та же шестерёнка, что уже используется в настройках блоков (SectionsPanel) */
export function GearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* Кнопка-шестерёнка для шапки любого рабочего модуля */
export function ModuleSettingsButton({ channelId, className, onSaved }: { channelId: string; className?: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={className || "w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/10 transition-all flex-none"}
        title="Настройки раздела: просмотр и редактирование"
        aria-label="Настройки раздела"
      >
        <GearIcon size={16} />
      </button>
      {open && (
        <ModuleSettingsModal
          channelId={channelId}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

/* FIX-QAACL: один блок «кто может …» с режимами и списком тегов. Используется
   дважды — для вопросов и для ответов. */
function QaAccessBlock({ title, name, value, onChange, roles, selected, onToggleRole, cardCls }: {
  title: string;
  name: string;
  value: QaAccess;
  onChange: (v: QaAccess) => void;
  roles: GroupRole[];
  selected: Set<string>;
  onToggleRole: (id: string) => void;
  cardCls: (active: boolean) => string;
}) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
        {title}
        <InfoTooltip text="Модерации это можно всегда, что бы вы тут ни выбрали. В режиме «Выбранные теги»: пока ни один тег не отмечен, разрешено всем участникам." className="ml-1" />
      </p>
      <div className="space-y-1.5">
        {QA_OPTIONS.map((opt) => (
          <label key={opt.value} className={cardCls(value === opt.value)}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="accent-violet-600 dark:accent-cyan-400"
            />
            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{opt.label}</span>
          </label>
        ))}
      </div>

      {value === "ROLES" && (
        <div className="mt-2 rounded-xl border border-neutral-200 dark:border-white/10 p-2 max-h-44 overflow-y-auto space-y-0.5">
          {roles.length === 0 ? (
            <p className="text-xs text-neutral-400 px-1.5 py-1">
              В группе пока нет тегов. Создайте их в настройках группы, затем выберите здесь.
            </p>
          ) : (
            roles.map((role) => (
              <label key={role.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-50 dark:hover:bg-white/5 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(role.id)}
                  onChange={() => onToggleRole(role.id)}
                  className="accent-violet-600 dark:accent-cyan-400"
                />
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={ { backgroundColor: role.color } } />
                <span className="text-neutral-800 dark:text-neutral-200 truncate">{role.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ModuleSettingsModal({ channelId, onClose, onSaved }: { channelId: string; onClose: () => void; onSaved?: () => void }) {
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [roles, setRoles] = useState<GroupRole[]>([]);
  const [postAccess, setPostAccess] = useState<"MOD" | "ADMIN" | "ALL">("MOD");
  const [restrictedRead, setRestrictedRead] = useState(false);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  // FIX-QAACL: права раздела «Вопросы-ответы».
  const [askAccess, setAskAccess] = useState<QaAccess>("ALL");
  const [answerAccess, setAnswerAccess] = useState<QaAccess>("ALL");
  const [askRoleIds, setAskRoleIds] = useState<Set<string>>(new Set());
  const [answerRoleIds, setAnswerRoleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/channels/${channelId}`);
      if (!res.ok) throw new Error("Не удалось загрузить настройки раздела");
      const ch: ChannelInfo = await res.json();
      setChannel(ch);
      setPostAccess(ch.postAccess === "ADMIN" || ch.postAccess === "MOD" ? ch.postAccess : "ALL");
      setRestrictedRead(!!ch.isRestricted);
      setRoleIds(new Set(ch.roleIds || []));
      setAskAccess(asQaAccess(ch.askAccess));
      setAnswerAccess(asQaAccess(ch.answerAccess));
      setAskRoleIds(new Set(ch.askRoleIds || []));
      setAnswerRoleIds(new Set(ch.answerRoleIds || []));
      if (ch.groupId) {
        const rr = await fetch(`/api/groups/${ch.groupId}/roles`);
        if (rr.ok) {
          const d = await rr.json();
          setRoles(Array.isArray(d) ? d : (Array.isArray(d?.roles) ? d.roles : []));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const toggleIn = (setter: Dispatch<SetStateAction<Set<string>>>) => (id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleRole = toggleIn(setRoleIds);
  const toggleAskRole = toggleIn(setAskRoleIds);
  const toggleAnswerRole = toggleIn(setAnswerRoleIds);

  const isQa = channel?.type === "QA";

  const save = async () => {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/channels/${channelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postAccess,
        isRestricted: restrictedRead,
        roleIds: restrictedRead ? Array.from(roleIds) : [],
        // FIX-QAACL: списки тегов уходят только для раздела Q&A — для прочих
        // модулей поля не отправляются и на сервере не трогаются.
        ...(isQa
          ? {
              askAccess,
              answerAccess,
              askRoleIds: askAccess === "ROLES" ? Array.from(askRoleIds) : [],
              answerRoleIds: answerAccess === "ROLES" ? Array.from(answerRoleIds) : [],
            }
          : {}),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      setError("Не удалось сохранить настройки");
      return;
    }
    onSaved?.();
    onClose();
  };

  const cardCls = (active: boolean) =>
    `flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-colors ${active ? "border-violet-500 dark:border-cyan-400 bg-violet-500/5 dark:bg-cyan-400/5" : "border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/5"}`;

  // PERF/FIX-MODAL: рендерим через портал в <body>. Кнопка-шестерёнка живёт в шапке
  // модуля, у которой есть backdrop-blur (backdrop-filter). Такой элемент создаёт
  // содержащий блок для потомков с position: fixed, из-за чего `fixed inset-0`
  // позиционировался относительно узкой шапки, а не окна — верх модалки обрезался.
  // Портал в body выводит окно из-под этого содержащего блока.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Настройки раздела"> {/* FIX-SHAREZ */}
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1 text-neutral-900 dark:text-white">
          <GearIcon size={18} />
          <h3 className="text-lg font-semibold">Настройки раздела{channel ? ` «${channel.name}»` : ""}</h3>
          <InfoTooltip text="Здесь решаете, кто у вас в группе видит этот рабочий раздел и кто может в нём что-то менять." side="bottom" />
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400 py-4 text-center">Загрузка…</p>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Кто может редактировать</p>
              <div className="space-y-1.5">
                {EDIT_OPTIONS.map((opt) => (
                  <label key={opt.value} className={cardCls(postAccess === opt.value)}>
                    <input
                      type="radio"
                      name="module-edit-access"
                      value={opt.value}
                      checked={postAccess === opt.value}
                      onChange={() => setPostAccess(opt.value)}
                      className="accent-violet-600 dark:accent-cyan-400"
                    />
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{opt.label}</span>
                    <span className="text-[11px] text-neutral-400">· {opt.hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
                Кто может читать
                <InfoTooltip text="Владелец, админ и модераторы группы видят раздел в любом случае. А если вы включили «Только выбранные роли», но ни одной не отметили, раздел останется виден всем." className="ml-1" />
              </p>
              <div className="space-y-1.5">
                <label className={cardCls(!restrictedRead)}>
                  <input type="radio" name="module-read-access" checked={!restrictedRead} onChange={() => setRestrictedRead(false)} className="accent-violet-600 dark:accent-cyan-400" />
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Все участники группы</span>
                </label>
                <label className={cardCls(restrictedRead)}>
                  <input type="radio" name="module-read-access" checked={restrictedRead} onChange={() => setRestrictedRead(true)} className="accent-violet-600 dark:accent-cyan-400" />
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Только выбранные роли</span>
                </label>
              </div>

              {restrictedRead && (
                <div className="mt-2 rounded-xl border border-neutral-200 dark:border-white/10 p-2 max-h-44 overflow-y-auto space-y-0.5">
                  {roles.length === 0 ? (
                    <p className="text-xs text-neutral-400 px-1.5 py-1">
                      В группе пока нет ролей. Создайте роли в настройках группы, затем выберите их здесь.
                    </p>
                  ) : (
                    roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-50 dark:hover:bg-white/5 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={roleIds.has(role.id)}
                          onChange={() => toggleRole(role.id)}
                          className="accent-violet-600 dark:accent-cyan-400"
                        />
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={ { backgroundColor: role.color } } />
                        <span className="text-neutral-800 dark:text-neutral-200 truncate">{role.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* FIX-QAACL: раздельные права вопросов и ответов — только для Q&A */}
            {isQa && (
              <>
                <QaAccessBlock
                  title="Кто может задавать вопросы"
                  name="qa-ask-access"
                  value={askAccess}
                  onChange={setAskAccess}
                  roles={roles}
                  selected={askRoleIds}
                  onToggleRole={toggleAskRole}
                  cardCls={cardCls}
                />
                <QaAccessBlock
                  title="Кто может отвечать"
                  name="qa-answer-access"
                  value={answerAccess}
                  onChange={setAnswerAccess}
                  roles={roles}
                  selected={answerRoleIds}
                  onToggleRole={toggleAnswerRole}
                  cardCls={cardCls}
                />
              </>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">Отмена</button>
          <button onClick={save} disabled={saving || loading} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
