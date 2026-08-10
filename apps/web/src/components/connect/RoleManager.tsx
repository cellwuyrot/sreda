"use client";

import { useState, useEffect, useCallback } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface GroupRole {
  id: string;
  name: string;
  color: string;
  _count?: { members: number };
}

interface RoleMember {
  userId: string;
  name: string;
  roleIds: string[];
}

interface RoleManagerProps {
  groupId: string;
  canManage: boolean;
  members?: RoleMember[];
}

const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#808080"];

export default function RoleManager({ groupId, canManage, members = [] }: RoleManagerProps) {
  const [roles, setRoles] = useState<GroupRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#808080");
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // local map roleId -> Set(userId)
  const [assign, setAssign] = useState<Record<string, Set<string>>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const fetchRoles = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/roles`)
      .then((r) => r.json())
      .then((d) => setRoles(Array.isArray(d) ? d : (Array.isArray(d.roles) ? d.roles : [])))
      .catch(() => setRoles([]))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  // init assignment map from members prop
  useEffect(() => {
    const map: Record<string, Set<string>> = {};
    for (const m of members) for (const rid of m.roleIds) {
      (map[rid] ||= new Set()).add(m.userId);
    }
    setAssign(map);
  }, [members]);

  const createRole = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch(`/api/groups/${groupId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    if (res.ok) { setNewName(""); setNewColor("#808080"); fetchRoles(); }
    setCreating(false);
  };

  const deleteRole = async (roleId: string) => {
    const res = await fetch(`/api/groups/${groupId}/roles/${roleId}`, { method: "DELETE" });
    if (res.ok) { setConfirmDeleteId(null); if (expandedId === roleId) setExpandedId(null); fetchRoles(); }
  };

  const toggleMember = async (roleId: string, userId: string) => {
    const has = assign[roleId]?.has(userId);
    const key = roleId + ":" + userId;
    setBusyKey(key);
    // optimistic
    setAssign((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleId] || []);
      if (has) set.delete(userId); else set.add(userId);
      next[roleId] = set;
      return next;
    });
    await fetch(`/api/groups/${groupId}/roles/${roleId}/members`, {
      method: has ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
    setBusyKey(null);
    fetchRoles();
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold px-1">
        Роли-теги ({roles.length})
        <InfoTooltip text="Это просто цветные метки рядом с ником. Прав они не дают — только показывают, кто есть кто. Правами заведуют системные роли." className="ml-1" />
      </div>

      {/* Role list */}
      {loading ? (
        <p className="text-sm text-neutral-400 px-1 py-2">Загрузка…</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-neutral-400 px-1 py-2">Ролей пока нет. Создайте первую ниже.</p>
      ) : (
        <div className="space-y-1">
          {roles.map((role) => {
            const count = assign[role.id]?.size ?? role._count?.members ?? 0;
            const open = expandedId === role.id;
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
                  <span className="flex-1" />
                  <span className="text-[10px] text-neutral-400">{count}</span>
                  {canManage && members.length > 0 && (
                    <button onClick={() => setExpandedId(open ? null : role.id)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors" aria-label="Assign members">
                      <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
                    </button>
                  )}
                  {canManage && (
                    <button onClick={() => setConfirmDeleteId(role.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-all" aria-label="Delete role">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>

                {open && canManage && (
                  <div className="px-2 py-2 border-t border-[var(--cn-border,rgba(0,0,0,0.08))] bg-[var(--cn-hover)]/40 max-h-44 overflow-y-auto space-y-0.5">
                    {members.map((m) => {
                      const checked = assign[role.id]?.has(m.userId) ?? false;
                      const key = role.id + ":" + m.userId;
                      return (
                        <label key={m.userId} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[var(--cn-hover)] cursor-pointer text-sm">
                          <input type="checkbox" checked={checked} disabled={busyKey === key} onChange={() => toggleMember(role.id, m.userId)} className="accent-violet-600 dark:accent-cyan-400" />
                          <span className="text-neutral-800 dark:text-neutral-200 truncate">{m.name}</span>
                        </label>
                      );
                    })}
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

      {/* Create role */}
      {canManage && (
        <div className="pt-2 border-t border-[var(--cn-border,rgba(0,0,0,0.08))] space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createRole(); }}
              placeholder="Название роли"
              maxLength={40}
              className="flex-1 px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400"
            />
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-9 h-9 rounded-lg border border-[var(--cn-border,rgba(0,0,0,0.08))] cursor-pointer" title="Цвет роли" />
            <button onClick={createRole} disabled={creating || !newName.trim()} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
              Создать
            </button>
          </div>
          <div className="flex items-center gap-1.5 px-1">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)} className={`w-5 h-5 rounded-full transition-transform ${newColor === c ? "ring-2 ring-offset-1 ring-neutral-400 scale-110" : ""}`} style={{ backgroundColor: c }} aria-label={`Цвет ${c}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RoleTag({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: color + "20", color, border: `1px solid ${color}40` }}
    >
      {name}
    </span>
  );
}
