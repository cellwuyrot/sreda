"use client";

import { useState, useEffect, useRef } from "react";
import type { Channel } from "./sidebarTypes";
import { ChatIcon, NewsIcon, VoiceChannelIcon } from "@/components/ui/ConnectIcons";
import InfoTooltip from "@/components/ui/InfoTooltip";

function CustomSelect({ label, info, value, onChange, options }: {
  label: string;
  info?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">{label}{info && <InfoTooltip text={info} className="ml-1" />}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none hover:border-violet-500 dark:hover:border-cyan-400 transition-colors"
      >
        <span className="truncate">{selected?.label || "—"}</span>
        <svg className={`w-4 h-4 ml-2 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl shadow-xl">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                o.value === value
                  ? "bg-violet-50 dark:bg-cyan-900/30 text-violet-700 dark:text-cyan-300"
                  : "text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, info, checked, onChange }: {
  label: string;
  info?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-white">
          {label}
          {info && <InfoTooltip text={info} className="ml-1" />}
        </p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

// FIX-CATSET: добавлены настройки для групп каналов (CATEGORY):
//   — ограничение доступа по ролям (propagateToChildren переносит на все каналы группы)
//   — права публикации и чтения для текстовых групп
//   — noRecord + voiceLimit для голосовых каналов и голосовых групп
export function ChannelSettingsModal({ channel, groupId, allChannels, onClose, onUpdated }: {
  channel: Channel;
  groupId: string;
  allChannels: Channel[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [icon, setIcon] = useState(channel.icon || "");
  const type = channel.type;
  const isCategory = type === "CATEGORY";
  const isVoiceCategory = isCategory && channel.channelGroupType === "VOICE";
  const isTextCategory = isCategory && channel.channelGroupType !== "VOICE";
  const isVoice = type === "VOICE";

  const [parentId, setParentId] = useState(channel.parentId || "");
  const [isRestricted, setIsRestricted] = useState(false);
  const [roles, setRoles] = useState<{ id: string; name: string; color: string }[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [slowmode, setSlowmode] = useState(0);
  const [postAccess, setPostAccess] = useState<string>("ALL");
  const [readAccess, setReadAccess] = useState<string>("ALL");
  const [hidden, setHidden] = useState(false);
  // FIX-CATSET: голосовые настройки — запись и лимит участников
  const [noRecord, setNoRecord] = useState(false);
  const [voiceLimit, setVoiceLimit] = useState<number | "">("" );
  // FIX-CATSET: применить настройки ко всем каналам в группе
  const [propagateToChildren, setPropagateToChildren] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const possibleParents = allChannels.filter(c =>
    c.id !== channel.id &&
    c.type === "CATEGORY" &&
    ((c.channelGroupType === "VOICE" && type === "VOICE") ||
     (c.channelGroupType !== "VOICE" && type !== "VOICE" && type !== "CATEGORY"))
  );

  useEffect(() => {
    Promise.all([
      fetch(`/api/channels/${channel.id}`).then(r => r.json()),
      fetch(`/api/groups/${groupId}/roles`).then(r => r.json()),
    ]).then(([chData, rolesData]) => {
      if (chData.isRestricted !== undefined) setIsRestricted(chData.isRestricted);
      if (chData.slowmode !== undefined) setSlowmode(chData.slowmode);
      if (chData.postAccess) setPostAccess(chData.postAccess);
      if (chData.readAccess) setReadAccess(chData.readAccess);
      if (chData.hidden !== undefined) setHidden(!!chData.hidden);
      if (chData.noRecord !== undefined) setNoRecord(!!chData.noRecord);
      if (chData.voiceLimit != null) setVoiceLimit(chData.voiceLimit);
      if (chData.roleIds) setSelectedRoles(new Set(chData.roleIds));
      if (Array.isArray(rolesData)) setRoles(rolesData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [channel.id, groupId]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/channels/${channel.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        icon: icon.trim() || null,
        type,
        isRestricted,
        slowmode,
        postAccess,
        readAccess,
        hidden,
        noRecord,
        voiceLimit: voiceLimit === "" ? null : Number(voiceLimit),
        roleIds: isRestricted ? Array.from(selectedRoles) : [],
        parentId: parentId || null,
        propagateToChildren: isCategory ? propagateToChildren : false,
      }),
    });
    setSaving(false);
    onUpdated();
    onClose();
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  // Показываем ли блок прав доступа (публикация/чтение)
  const showTextAccess = !isVoice && !isCategory;
  // Для категорий — тоже, но только текстовых
  const showCategoryTextAccess = isTextCategory;
  // Показываем ли голосовые настройки
  const showVoiceSettings = isVoice || isVoiceCategory;
  // Слоумод — только текстовые каналы, не категории
  const showSlowmode = !isVoice && !isCategory;

  const categoryLabel = isVoiceCategory ? "группы голосовых каналов" : "группы текстовых каналов";

  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-white/5">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
            {isCategory ? `Настройки ${categoryLabel}` : "Настройки канала"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-neutral-400 text-sm">Загрузка...</div>
        ) : (
          <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">

            {/* Название */}
            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Название</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400" />
            </div>

            {/* Иконка */}
            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Иконка (emoji)</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} placeholder="💬" className="w-full px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400" />
            </div>

            {/* Тип канала */}
            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Тип</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-600 dark:text-neutral-300">
                {isCategory
                  ? (isVoiceCategory ? <><VoiceChannelIcon size={16} /> Группа голосовых каналов</> : <>Группа текстовых каналов</>)
                  : type === "TEXT" ? <><ChatIcon size={16} /> Текстовый</>
                  : type === "FEED" ? <><NewsIcon size={16} /> Улучшенный чат</>
                  : type === "NEWS" ? <><NewsIcon size={16} /> Новости</>
                  : <><VoiceChannelIcon size={16} /> Голосовой</>}
              </div>
            </div>

            {/* FIX-NEWSACL: права на публикацию и чтение для текстовых каналов */}
            {showTextAccess && (
              <>
                <CustomSelect
                  label="Кто может публиковать"
                  value={postAccess}
                  onChange={setPostAccess}
                  options={[
                    { value: "ALL", label: type === "NEWS" ? "Модераторы и выше (по умолчанию)" : "Все участники" },
                    { value: "MOD", label: "Создатель, администраторы и модераторы" },
                    { value: "ADMIN", label: "Только создатель и администраторы" },
                  ]}
                />
                <CustomSelect
                  label="Кто может читать"
                  info="Если оставить не всех, канал просто исчезнет у остальных: его не будет ни в списке каналов, ни по прямой ссылке."
                  value={readAccess}
                  onChange={setReadAccess}
                  options={[
                    { value: "ALL", label: "Все участники сообщества" },
                    { value: "MOD", label: "Создатель, администраторы и модераторы" },
                    { value: "ADMIN", label: "Только создатель и администраторы" },
                  ]}
                />
              </>
            )}

            {/* FIX-CATSET: права на публикацию/чтение для текстовой ГРУППЫ каналов */}
            {showCategoryTextAccess && (
              <>
                <div className="rounded-xl bg-violet-50 dark:bg-cyan-900/20 border border-violet-100 dark:border-cyan-800/30 px-3 py-2.5">
                  <p className="text-xs text-violet-700 dark:text-cyan-300 font-medium">⚙️ Настройки группы</p>
                  <p className="text-[11px] text-violet-600/70 dark:text-cyan-400/60 mt-0.5">Применяются ко всем каналам группы при нажатии «Сохранить» с включённым переключателем ниже.</p>
                </div>
                <CustomSelect
                  label="Кто может публиковать (в каналах группы)"
                  value={postAccess}
                  onChange={setPostAccess}
                  options={[
                    { value: "ALL", label: "Все участники" },
                    { value: "MOD", label: "Создатель, администраторы и модераторы" },
                    { value: "ADMIN", label: "Только создатель и администраторы" },
                  ]}
                />
                <CustomSelect
                  label="Кто может читать (каналы группы)"
                  info="Каналы исчезнут из списка у тех, кто не попадает под условие."
                  value={readAccess}
                  onChange={setReadAccess}
                  options={[
                    { value: "ALL", label: "Все участники сообщества" },
                    { value: "MOD", label: "Создатель, администраторы и модераторы" },
                    { value: "ADMIN", label: "Только создатель и администраторы" },
                  ]}
                />
              </>
            )}

            {/* Смена группы (только для дочерних каналов) */}
            {possibleParents.length > 0 && !isCategory && (
              <CustomSelect
                label="Группа канала"
                value={parentId}
                onChange={setParentId}
                options={[
                  { value: "", label: "Нет (корневой)" },
                  ...possibleParents.map(p => ({ value: p.id, label: p.channelGroupType === "VOICE" ? `${p.name} (голосовая)` : p.name })),
                ]}
              />
            )}

            {/* FIX-CATSET: скрыть канал / группу */}
            <Toggle
              label="Скрыть канал"
              info="Канал виден только модераторам и выше. Обычные участники не видят его в списке."
              checked={hidden}
              onChange={setHidden}
            />

            {/* Ограничить доступ по ролям */}
            <div className="space-y-3">
              <Toggle
                label={isCategory ? "Ограничить доступ к группе" : "Ограничить доступ"}
                info={isCategory
                  ? "Только участники с выбранными тегами видят каналы этой группы. При применении ко всем каналам группы — настраивается массово."
                  : "Канал увидят только те, у кого есть один из выбранных ниже тегов. Остальным он не покажется в списке."}
                checked={isRestricted}
                onChange={setIsRestricted}
              />

              {isRestricted && roles.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 block">Теги с доступом</label>
                  <div className="flex flex-wrap gap-2">
                    {roles.map(role => (
                      <button key={role.id} onClick={() => toggleRole(role.id)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${selectedRoles.has(role.id) ? "text-white border-transparent" : "bg-neutral-50 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300"}`}
                        style={selectedRoles.has(role.id) ? { backgroundColor: role.color } : undefined}>
                        {role.name}
                      </button>
                    ))}
                  </div>
                  {selectedRoles.size === 0 && (
                    <p className="text-[11px] text-amber-500 mt-1">Никто не сможет видеть {isCategory ? "каналы группы" : "канал"}. Выберите хотя бы один тег.</p>
                  )}
                </div>
              )}
              {isRestricted && roles.length === 0 && (
                <p className="text-xs text-neutral-400">Нет тегов. Создайте теги в настройках сообщества.</p>
              )}
            </div>

            {/* FIX-CATSET: голосовые настройки — noRecord + voiceLimit */}
            {showVoiceSettings && (
              <>
                {isVoiceCategory && (
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 px-3 py-2.5">
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">🎙️ Голосовые настройки группы</p>
                    <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">При применении ко всем каналам — распространяются на все голосовые каналы в группе.</p>
                  </div>
                )}
                <Toggle
                  label="Отключить мгновенный повтор"
                  info="Когда включено, запись буфера для мгновенного повтора не ведётся в этом канале."
                  checked={noRecord}
                  onChange={setNoRecord}
                />
                <div>
                  <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">
                    Лимит участников
                    <InfoTooltip text="Максимальное число людей в голосовом канале одновременно. Оставьте пустым — без ограничений." className="ml-1" />
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    placeholder="Без лимита"
                    value={voiceLimit}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === "") setVoiceLimit("");
                      else {
                        const n = Math.max(1, Math.min(99, parseInt(v) || 1));
                        setVoiceLimit(n);
                      }
                    }}
                    className="w-full px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400"
                  />
                </div>
              </>
            )}

            {/* Слоумод — только текстовые каналы */}
            {showSlowmode && (
              <CustomSelect
                label="Слоумод (секунды между сообщениями)"
                info="Пауза, которую участник должен выждать между своими сообщениями. На админов и модераторов не распространяется."
                value={String(slowmode)}
                onChange={v => setSlowmode(Number(v))}
                options={[
                  { value: "0", label: "Выкл" },
                  { value: "5", label: "5 сек" },
                  { value: "10", label: "10 сек" },
                  { value: "15", label: "15 сек" },
                  { value: "30", label: "30 сек" },
                  { value: "60", label: "1 мин" },
                  { value: "120", label: "2 мин" },
                  { value: "300", label: "5 мин" },
                  { value: "600", label: "10 мин" },
                ]}
              />
            )}

            {/* FIX-CATSET: применить настройки ко всем каналам группы */}
            {isCategory && (
              <div className="rounded-xl border border-dashed border-violet-300 dark:border-cyan-700 bg-violet-50/50 dark:bg-cyan-900/10 px-3 py-3 space-y-2">
                <Toggle
                  label="Применить ко всем каналам группы"
                  info="При сохранении все настройки доступа, ролей и видимости будут применены к каждому каналу внутри этой группы, перезаписав их индивидуальные настройки."
                  checked={propagateToChildren}
                  onChange={setPropagateToChildren}
                />
                {propagateToChildren && (
                  <p className="text-[11px] text-violet-600 dark:text-cyan-400">
                    ⚠️ Настройки доступа будут применены ко всем каналам в группе. Индивидуальные настройки каналов будут перезаписаны.
                  </p>
                )}
              </div>
            )}

          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">Отмена</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="px-4 py-2 bg-violet-500 dark:bg-cyan-600 text-white text-sm rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
