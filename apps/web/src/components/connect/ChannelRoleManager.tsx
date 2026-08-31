"use client";

import { useState, useEffect, useCallback } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface ChannelInfo {
  id: string;
  name: string;
  type: string; // "text" | "voice" | ...
}

interface ChannelRole {
  id: string;
  name: string;
  color: string;
  linkedChannels?: ChannelInfo[];
  _count?: { members: number };
}

interface Props {
  groupId: string;
  canManage: boolean;
  channels: ChannelInfo[];
}

const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#808080"];

const CHANNEL_TYPE_ICON: Record<string, string> = {
  voice: "🔊",
  text:  "#",
  stage: "🎙",
};

export default function ChannelRoleManager({ groupId, canManage, channels }: Props) {
  const [roles, setRoles]                 = useState<ChannelRole[]>([]);
  const [loading, setLoading]             = useState(true);
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [expandedPowers, setExpandedPowers] = useState<Record<string, ChannelInfo[]>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // create form
  const [newName, setNewName]   = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newChannels, setNewChannels] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // toggle channel powers in expanded view
  const [busyChannelKey, setBusyChannelKey] = useState<string | null>(null);

  const fetchRoles = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/roles`)
      .then(r => r.json())
      .then(d => setRoles(Array.isArray(d) ? d : (Array.isArray(d.roles) ? d.roles : [])))
      .catch(() => setRoles([]))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const loadPowers = useCallback(async (roleId: string) => {
    try {
      const res = await fetch(`/api/groups/${groupId}/roles/${roleId}/channels`);
      if (!res.ok) return;
      const data: { channel: ChannelInfo }[] = await res.json();
      setExpandedPowers(prev => ({ ...prev, [roleId]: data.map(d => d.channel) }));
    } catch { /* ignore */ }
  }, [groupId]);

  const openExpand = async (roleId: string) => {
    if (expandedId === roleId) { setExpandedId(null); return; }
    setExpandedId(roleId);
    if (!expandedPowers[roleId]) await loadPowers(roleId);
  };

  const toggleChannelPower = async (roleId: string, channelId: string) => {
    const key = roleId + ":" + channelId;
    setBusyChannelKey(key);
    const linked = expandedPowers[roleId] ?? [];
    const has = linked.some(c => c.id === channelId);
    if (has) {
      await fetch(`/api/groups/${groupId}/roles/${roleId}/channels?channelId=${encodeURIComponent(channelId)}`, { method: "DELETE" }).catch(() => {});
      setExpandedPowers(prev => ({ ...prev, [roleId]: (prev[roleId] ?? []).filter(c => c.id !== channelId) }));
    } else {
      const res = await fetch(`/api/groups/${groupId}/roles/${roleId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      }).catch(() => null);
      if (res?.ok) {
        const ch = channels.find(c => c.id === channelId);
        if (ch) setExpandedPowers(prev => ({ ...prev, [roleId]: [...(prev[roleId] ?? []), ch] }));
      }
    }
    setBusyChannelKey(null);
  };

  const toggleNewChannel = (channelId: string) => {
    setNewChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId); else next.add(channelId);
      return next;
    });
  };

  const createRole = async () => {
    if (!newName.trim()) { setCreateError("Укажите название роли"); return; }
    setCreateError("");
    setCreating(true);
    try {
      // 1. Create the role
      const res = await fetch(`/api/groups/${groupId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!res.ok) { setCreateError("Не удалось создать роль"); return; }
      const role: ChannelRole = await res.json();

      // 2. Bind selected channels automatically
      if (newChannels.size > 0) {
        await Promise.all(
          [...newChannels].map(channelId =>
            fetch(`/api/groups/${groupId}/roles/${role.id}/channels`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channelId }),
            }).catch(() => {})
          )
        );
      }

      setNewName("");
      setNewColor("#3b82f6");
      setNewChannels(new Set());
      fetchRoles();
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async (roleId: string) => {
    const res = await fetch(`/api/groups/${groupId}/roles/${roleId}`, { method: "DELETE" });
    if (res.ok) {
      setConfirmDeleteId(null);
      if (expandedId === roleId) setExpandedId(null);
      fetchRoles();
    }
  };

  // Split channels into text/voice for cleaner UI
  const textChannels  = channels.filter(c => c.type !== "voice" && c.type !== "stage");
  const voiceChannels = channels.filter(c => c.type === "voice" || c.type === "stage");

  return (
    <div className="space-y-3">
      <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold px-1">
        Роли-возможности ({roles.length})
        <InfoTooltip
          text="Роль привязывается к одному или нескольким каналам. Участник с такой ролью получает полную модерацию только этих каналов."
          className="ml-1"
        />
      </div>

      {/* Role list */}
      {loading ? (
        <p className="text-sm text-neutral-400 px-1 py-2">Загрузка…</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-neutral-400 px-1 py-2">Ролей-возможностей пока нет.</p>
      ) : (
        <div className="space-y-1">
          {roles.map((role) => {
            const open   = expandedId === role.id;
            const linked = expandedPowers[role.id] ?? [];
            return (
              <div key={role.id} className="rounded-lg border border-[var(--cn-border,rgba(0,0,0,0.08))] overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--cn-hover)] transition-colors group">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
                    style={{ backgroundColor: role.color + "20", color: role.color, border: `1px solid ${role.color}40` }}
                  >
                    {role.name}
                  </span>
                  {/* linked channel count badge */}
                  {open && linked.length > 0 && (
                    <span className="text-[10px] text-teal-500 dark:text-teal-400">{linked.length} кан.</span>
                  )}
                  <span className="flex-1" />
                  {canManage && channels.length > 0 && (
                    <button
                      onClick={() => openExpand(role.id)}
                      className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors"
                      aria-label="Каналы роли"
                    >
                      <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => setConfirmDeleteId(role.id)}
                      className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-all"
                      aria-label="Удалить роль"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Channel checkboxes when expanded */}
                {open && canManage && (
                  <div className="px-3 py-2 border-t border-[var(--cn-border,rgba(0,0,0,0.08))] bg-[var(--cn-hover)]/40 space-y-2">
                    {[{ label: "Текстовые каналы", list: textChannels }, { label: "Голосовые каналы", list: voiceChannels }].map(({ label, list }) =>
                      list.length === 0 ? null : (
                        <div key={label}>
                          <p className="text-[10px] text-neutral-400 uppercase tracking-wider mb-1">{label}</p>
                          <div className="space-y-0.5">
                            {list.map(ch => {
                              const checked  = linked.some(c => c.id === ch.id);
                              const bkey     = role.id + ":" + ch.id;
                              const icon     = CHANNEL_TYPE_ICON[ch.type] ?? "#";
                              return (
                                <label key={ch.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[var(--cn-hover)] cursor-pointer text-sm">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={busyChannelKey === bkey}
                                    onChange={() => toggleChannelPower(role.id, ch.id)}
                                    className="accent-teal-500"
                                  />
                                  <span className="text-neutral-400 text-[11px]">{icon}</span>
                                  <span className="text-neutral-800 dark:text-neutral-200 truncate text-sm">{ch.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )
                    )}
                    {textChannels.length === 0 && voiceChannels.length === 0 && (
                      <p className="text-xs text-neutral-400">В группе нет каналов.</p>
                    )}
                  </div>
                )}

                {confirmDeleteId === role.id && (
                  <div className="px-2 py-2 border-t border-red-500/20 bg-red-500/5 flex items-center gap-2 text-xs">
                    <span className="text-red-500 flex-1">Удалить роль «{role.name}»?</span>
                    <button onClick={() => deleteRole(role.id)} className="px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600">Удалить</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">Отмена</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create form */}
      {canManage && (
        <div className="pt-2 border-t border-[var(--cn-border,rgba(0,0,0,0.08))] space-y-3">
          {/* Name + color */}
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createRole(); }}
              placeholder="Название роли"
              maxLength={40}
              className="flex-1 px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-teal-500"
            />
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-9 h-9 rounded-lg border border-[var(--cn-border,rgba(0,0,0,0.08))] cursor-pointer"
              title="Цвет роли"
            />
          </div>

          {/* Preset colors */}
          <div className="flex items-center gap-1.5 px-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full transition-transform ${newColor === c ? "ring-2 ring-offset-1 ring-neutral-400 scale-110" : ""}`}
                style={{ backgroundColor: c }}
                aria-label={`Цвет ${c}`}
              />
            ))}
          </div>

          {/* Channel checkboxes for new role */}
          {channels.length > 0 && (
            <div className="rounded-lg border border-[var(--cn-border,rgba(0,0,0,0.08))] p-2 space-y-2">
              <p className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">Каналы для этой роли</p>
              {[{ label: "Текстовые", list: textChannels }, { label: "Голосовые", list: voiceChannels }].map(({ label, list }) =>
                list.length === 0 ? null : (
                  <div key={label}>
                    <p className="text-[10px] text-neutral-400 mb-1">{label}</p>
                    <div className="grid grid-cols-2 gap-0.5">
                      {list.map(ch => {
                        const checked = newChannels.has(ch.id);
                        const icon    = CHANNEL_TYPE_ICON[ch.type] ?? "#";
                        return (
                          <label key={ch.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-[var(--cn-hover)] cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleNewChannel(ch.id)}
                              className="accent-teal-500"
                            />
                            <span className="text-neutral-400">{icon}</span>
                            <span className="text-neutral-800 dark:text-neutral-200 truncate">{ch.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {createError && <p className="text-xs text-red-500">{createError}</p>}

          <button
            onClick={createRole}
            disabled={creating || !newName.trim()}
            className="w-full px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-50 transition-colors"
          >
            {creating ? "Создание…" : "Создать роль"}
          </button>
        </div>
      )}
    </div>
  );
}
