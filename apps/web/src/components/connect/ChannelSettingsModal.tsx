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
  const [parentId, setParentId] = useState(channel.parentId || "");
  const [isRestricted, setIsRestricted] = useState(false);
  const [roles, setRoles] = useState<{ id: string; name: string; color: string }[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [slowmode, setSlowmode] = useState(0);
  /* FIX-NEWSACL: права канала по встроенным ролям — кто публикует и кто читает.
     Раньше для новостей право писать было зашито в коде (модераторы и выше) и
     не настраивалось, а ограничить чтение можно было только кастомными тегами. */
  const [postAccess, setPostAccess] = useState<string>("ALL");
  const [readAccess, setReadAccess] = useState<string>("ALL");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const possibleParents = allChannels.filter(c => c.id !== channel.id && c.type === "CATEGORY" && ((c.channelGroupType === "VOICE" && type === "VOICE") || (c.channelGroupType !== "VOICE" && type !== "VOICE" && type !== "CATEGORY")));

  useEffect(() => {
    Promise.all([
      fetch(`/api/channels/${channel.id}`).then(r => r.json()),
      fetch(`/api/groups/${groupId}/roles`).then(r => r.json()),
    ]).then(([chData, rolesData]) => {
      if (chData.isRestricted !== undefined) setIsRestricted(chData.isRestricted);
      if (chData.slowmode !== undefined) setSlowmode(chData.slowmode);
      if (chData.postAccess) setPostAccess(chData.postAccess); // FIX-NEWSACL
      if (chData.readAccess) setReadAccess(chData.readAccess); // FIX-NEWSACL
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
        postAccess, // FIX-NEWSACL
        readAccess, // FIX-NEWSACL
        roleIds: isRestricted ? Array.from(selectedRoles) : [],
        parentId: parentId || null,
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

  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center p-4" /* FIX-SHAREZ */ onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-white/5">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Настройки канала</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-neutral-400 text-sm">Загрузка...</div>
        ) : (
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Название</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400" />
            </div>

            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Иконка (emoji)</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} placeholder="💬" className="w-full px-3 py-2 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400" />
            </div>

            <div>
              <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1 block">Тип канала</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-600 dark:text-neutral-300">
                {/* FIX-FEED: улучшенный чат — отдельная подпись, иначе он показывался «голосовым». */}
                {/* FIX-CATSET */}
                {type === "CATEGORY" ? <>Группа каналов</> : type === "TEXT" ? <><ChatIcon size={16} /> Текстовый</> : type === "FEED" ? <><NewsIcon size={16} /> Улучшенный чат</> : type === "NEWS" ? <><NewsIcon size={16} /> Новости</> : <><VoiceChannelIcon size={16} /> Голосовой</>}
              </div>
            </div>

            {/* FIX-NEWSACL: права на публикацию и чтение. Для голосовых каналов
                и категорий лента сообщений не ведётся — там настройки не нужны. */}
            {type !== "VOICE" && type !== "CATEGORY" && (
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

            {possibleParents.length > 0 && (
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

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-white">
                  Ограничить доступ
                  <InfoTooltip text="Канал увидят только те, у кого есть один из выбранных ниже тегов. Остальным он не покажется в списке." className="ml-1" />
                </p>
              </div>
              <button onClick={() => setIsRestricted(!isRestricted)} className={`relative w-11 h-6 rounded-full transition-colors ${isRestricted ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-neutral-600"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isRestricted ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {isRestricted && roles.length > 0 && (
              <div>
                <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 block">Теги с доступом</label>
                <div className="flex flex-wrap gap-2">
                  {roles.map(role => (
                    <button key={role.id} onClick={() => toggleRole(role.id)} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${selectedRoles.has(role.id) ? "text-white border-transparent" : "bg-neutral-50 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300"}`} style={selectedRoles.has(role.id) ? { backgroundColor: role.color } : undefined}>
                      {role.name}
                    </button>
                  ))}
                </div>
                {selectedRoles.size === 0 && (
                  <p className="text-[11px] text-amber-500 mt-1">Никто не сможет видеть канал. Выберите хотя бы один тег.</p>
                )}
              </div>
            )}
            {isRestricted && roles.length === 0 && (
              <p className="text-xs text-neutral-400">Нет тегов. Создайте теги в настройках группы.</p>
            )}

            {/* Slowmode */}
            <div>
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
            </div>
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
