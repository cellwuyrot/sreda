"use client";

import React, { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import Button from "@/components/ui/Button";
import GlowAvatar from "@/components/ui/GlowAvatar";
import ModalBackdrop from "@/components/connect/ModalBackdrop";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { mergePresence, type OnlinePresence } from "@/lib/onlinePresence";
import type { GroupDetail } from "./groupTypes";
import { CrownIcon, ShieldIcon } from "@/components/ui/ConnectIcons";
import { COMMUNITY_TEMPLATES, type CommunityTemplateId } from "@/lib/communityTemplates";
import { FREE_COMMUNITY_LIMIT } from "@/lib/premiumFeatures";

type CreatedInvite = {
  code: string;
  expiresAt: string | null;
  group?: {
    id: string;
    icon: string | null;
  };
};

/* ─── Modals ─── */

export function CreateGroupModal({ onClose, onCreated, isPremium, ownedCount = 0 }: { onClose: () => void; onCreated: () => void; isPremium: boolean; ownedCount?: number }) {
  const [name, setName] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [templateId, setTemplateId] = useState<CommunityTemplateId>("blank");

  // FREE-COMMUNITY-LIMIT: обычный аккаунт ограничен FREE_COMMUNITY_LIMIT своими
  // сообществами. Клиент показывает счётчик и блокирует кнопку заранее, но
  // финальную проверку всё равно делает сервер (api/groups).
  const limitReached = !isPremium && ownedCount >= FREE_COMMUNITY_LIMIT;

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Файл слишком большой (макс. 2MB)");
      return;
    }
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
    setError("");
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError("");
    setLoading(true);

    try {
      let iconUrl: string | null = null;

      if (iconFile) {
        const formData = new FormData();
        formData.append("icon", iconFile);
        const uploadRes = await fetch("/api/groups/icon", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const data = await uploadRes.json();
          setError(data.error || "Ошибка загрузки иконки");
          setLoading(false);
          return;
        }
        const uploadData = await uploadRes.json();
        iconUrl = uploadData.icon;
      }

      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: iconUrl, templateId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Ошибка создания группы");
        setLoading(false);
        return;
      }

      onCreated();
      onClose();
    } catch {
      setError("Ошибка сети. Попробуйте позже.");
      setLoading(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Создать группу</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className="relative cursor-pointer group flex-shrink-0">
            <div className="w-14 h-14 rounded-xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center overflow-hidden border-2 border-dashed border-neutral-300 dark:border-white/20 group-hover:border-violet-400 dark:group-hover:border-cyan-400 transition-colors">
              {iconPreview ? (
                <img src={iconPreview} alt="Icon" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-neutral-400 group-hover:text-violet-500 dark:group-hover:text-cyan-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleIconChange} className="hidden" />
          </label>
          <div className="flex-1 min-w-0">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !loading) handleCreate(); }}
              placeholder="Название группы..." className="w-full bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400" autoFocus />
            <p className="text-[11px] text-neutral-400 mt-1">Иконка необязательна</p>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
              Шаблон сообщества
              <InfoTooltip text="Шаблон сразу создаст готовый набор каналов. Без Premium доступно только базовое сообщество — это же проверяет и сервер." className="ml-1" />
            </p>
            
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
            {COMMUNITY_TEMPLATES.map((template) => {
              const locked = template.premium && !isPremium;
              const selected = templateId === template.id;
              return (
                <button key={template.id} type="button" disabled={locked} onClick={() => setTemplateId(template.id)}
                  className={`relative rounded-xl border p-3 text-left transition-colors ${selected ? "border-violet-500 bg-violet-50 dark:border-cyan-400 dark:bg-cyan-400/10" : "border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/5"} ${locked ? "cursor-not-allowed opacity-55" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-white">{template.name}</span>
                    {template.premium && <span className="text-[10px] font-bold text-amber-500">PREMIUM</span>}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">{template.description}</p>
                  <p className="mt-2 text-[10px] text-neutral-400">{template.channels.filter((c) => c.type !== "VOICE").length} текстовых · {template.channels.filter((c) => c.type === "VOICE").length} голосовых</p>
                </button>
              );
            })}
          </div>
        </div>
        {!isPremium && (
          <div className={`rounded-xl border px-3 py-2 text-[11px] ${limitReached ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300" : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-neutral-500 dark:text-gray-400"}`}>
            Своих сообществ: <span className="font-semibold tabular-nums">{ownedCount}/{FREE_COMMUNITY_LIMIT}</span>
            {limitReached
              ? " · лимит обычного аккаунта достигнут. Оформите Premium, чтобы создавать без ограничений."
              : " · обычный аккаунт может создать до " + FREE_COMMUNITY_LIMIT + " сообществ."}
          </div>
        )}
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button onClick={handleCreate} disabled={loading || !name.trim() || limitReached} size="md" className="flex-1">
            {loading ? "Создание..." : limitReached ? "Достигнут лимит" : "Создать"}
          </Button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm">
            Отмена
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export function JoinGroupModal({ onClose, onJoined }: { onClose: () => void; onJoined: (groupId?: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) return;
    setError("");
    setLoading(true);
    const res = await fetch(`/api/invites/${code.trim()}`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    /* FIX-ANDROID-JOIN: если пользователь уже состоит в группе — расцениваем
       диалог и открываем группу, а не показываем ошибку. */
    if (res.status === 409 && data.groupId) { onJoined(data.groupId); onClose(); return; }
    if (!res.ok) { setError(data.error || "Ошибка"); return; }
    onJoined(data.groupId);
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Присоединиться по приглашению</h3>
      <div className="space-y-3">
        {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="Код приглашения..." className="w-full bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400" autoFocus />
        <div className="flex gap-2 pt-1">
          <button onClick={handleJoin} disabled={loading} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium disabled:opacity-50">
            {loading ? "..." : "Присоединиться"}
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm">
            Отмена
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export function CreateChannelModal({ groupId, initialParentId = null, initialCreateCategory = false, initialGroupType = "TEXT", initialType = "TEXT", onClose, onCreated }: { groupId: string; initialParentId?: string | null; initialCreateCategory?: boolean; initialGroupType?: "TEXT" | "VOICE"; initialType?: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState(initialType);
  /* FIX-FEED: «обычный или улучшенный» — отдельный переключатель, а не третья
     кнопка рядом с «Текстовый/Голосовой»: улучшенный чат — это тот же текстовый
     канал, и к выбору голоса он отношения не имеет. */
  const [enhanced, setEnhanced] = useState(initialType === "FEED");
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [createCategory, setCreateCategory] = useState(initialCreateCategory);
  const [groupType, setGroupType] = useState<"TEXT" | "VOICE">(initialGroupType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const effectiveType = createCategory ? "CATEGORY" : type === "VOICE" ? "VOICE" : enhanced ? "FEED" : type;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), type: effectiveType, groupId, parentId: createCategory ? null : parentId, channelGroupType: createCategory ? groupType : undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Ошибка создания канала");
      return;
    }
    onCreated();
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">{createCategory ? "Создать группу каналов" : parentId ? "Создать канал в группе" : "Создать канал"}</h3>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => { setCreateCategory(false); if (groupType === "VOICE") setType("VOICE"); }} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${!createCategory ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
            Канал
          </button>
          <button onClick={() => { setCreateCategory(true); setParentId(null); }} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${createCategory ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
            Группа
          </button>
        </div>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !loading) handleCreate(); }}
          placeholder={createCategory ? "Название группы каналов..." : "Название канала..."} className="w-full bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400" autoFocus />
        <div className="flex gap-2">
          <button onClick={() => { setGroupType("TEXT"); if (!createCategory) setType("TEXT"); }} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${(createCategory ? groupType : type) === "TEXT" ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
            Текстовый
          </button>
          <button onClick={() => { setGroupType("VOICE"); setType("VOICE"); }} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${(createCategory ? groupType : type) === "VOICE" ? "bg-emerald-50 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
            Голосовой
          </button>
        </div>
        {/* FIX-FEED: вид текстового канала. Голосовому выбор не нужен, группе каналов тоже. */}
        {!createCategory && type !== "VOICE" && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <button onClick={() => setEnhanced(false)} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${!enhanced ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
                Обычный чат
              </button>
              <button onClick={() => setEnhanced(true)} className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${enhanced ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}>
                Улучшенный чат
              </button>
            </div>
            <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
              {enhanced
                ? "Лента как в «Новостях»: заголовок, обложка, вложения, отдельное обсуждение под каждой записью, можно закрыть комментарии, отложить публикацию или сохранить черновик. Писать могут все участники — сузить это можно в настройках канала."
                : "Привычная переписка сообщениями."}
            </p>
          </div>
        )}
        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button onClick={handleCreate} disabled={loading || !name.trim()} size="md" className="flex-1">
            {loading ? "Создание..." : "Создать"}
          </Button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm">
            Отмена
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// FIX-INVITE-PERM: у сообщества теперь есть ОДНА постоянная ссылка (без срока
// и лимита — создаётся идемпотентно и переиспользуется) и по-прежнему можно
// выпускать временные ссылки с выбором срока и лимита использований.
// Раньше модалка создавала только 10-минутную ссылку.
const INVITE_EXPIRY_OPTIONS = [
  { value: 1, label: "1 час" },
  { value: 12, label: "12 часов" },
  { value: 24, label: "24 часа" },
  { value: 168, label: "7 дней" },
  { value: 720, label: "30 дней" },
];

const INVITE_USES_OPTIONS = [
  { value: 0, label: "Без лимита" },
  { value: 1, label: "1 использование" },
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 100, label: "100" },
];

export function InviteModal({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"permanent" | "temporary">("permanent");
  const [permInvite, setPermInvite] = useState<CreatedInvite | null>(null);
  const [tempInvite, setTempInvite] = useState<CreatedInvite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [expires, setExpires] = useState(24);
  const [maxUses, setMaxUses] = useState(0);

  const invite = mode === "permanent" ? permInvite : tempInvite;
  const inviteCode = invite?.code ?? null;
  const inviteLink = inviteCode && typeof window !== "undefined"
    ? `${window.location.origin}/invite/${inviteCode}`
    : "";

  const copyValue = async (value: string, type: "code" | "link") => {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  // Постоянная ссылка подгружается сразу при открытии: сервер идемпотентен —
  // вернёт существующую бессрочную ссылку группы или создаст её один раз.
  useEffect(() => {
    if (mode !== "permanent" || permInvite) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, permanent: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Ошибка создания приглашения");
        if (!cancelled) setPermInvite(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка создания приглашения");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mode, permInvite, groupId]);

  const createTemporary = async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, expiresInHours: expires, maxUses }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error || "Ошибка создания приглашения"); return; }
    setTempInvite(data);
  };

  const linkBlock = invite && (
    <div className="space-y-3">
      <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/60 p-3">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">
          {mode === "permanent" ? "Постоянная ссылка сообщества" : "Временная ссылка"}
          <InfoTooltip text="Если бросить такую ссылку в Telegram или Discord, она развернётся карточкой сообщества: название, описание и сколько в нём участников." className="ml-1" />
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {invite.expiresAt
            ? `Действует до ${new Date(invite.expiresAt).toLocaleString("ru-RU")}`
            : "Не истекает и не ограничена по числу вступлений"}
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-neutral-500">Внешняя ссылка:</p>
        <div className="flex gap-2">
          <input type="text" value={inviteLink} readOnly className="flex-1 bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white" />
          <button onClick={() => inviteLink && copyValue(inviteLink, "link")} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${copied === "link" ? "bg-green-100 dark:bg-green-400/20 text-green-600 dark:text-green-400" : "bg-violet-100 dark:bg-cyan-400/20 text-accent hover:bg-violet-200 dark:hover:bg-cyan-400/30"}`}>
            {copied === "link" ? "Скопировано!" : "Копировать"}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-neutral-500">Код приглашения:</p>
        <div className="flex gap-2">
          <input type="text" value={inviteCode ?? ""} readOnly className="flex-1 bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white font-mono" />
          <button onClick={() => inviteCode && copyValue(inviteCode, "code")} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${copied === "code" ? "bg-green-100 dark:bg-green-400/20 text-green-600 dark:text-green-400" : "bg-violet-100 dark:bg-cyan-400/20 text-accent hover:bg-violet-200 dark:hover:bg-cyan-400/30"}`}>
            {copied === "code" ? "Скопировано!" : "Копировать"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ModalBackdrop onClose={onClose}>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">
        Пригласить в группу
        <InfoTooltip text="Все выпущенные ссылки собраны в настройках группы, в разделе «Приглашения»: там их можно отозвать и посмотреть статистику." side="bottom" className="ml-1" />
      </h3>
      <div className="space-y-3">
        {/* Переключатель типа ссылки */}
        <div className="flex gap-2">
          <button
            onClick={() => { setMode("permanent"); setCopied(null); setError(""); }}
            className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${mode === "permanent" ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}
          >
            Постоянная
          </button>
          <button
            onClick={() => { setMode("temporary"); setCopied(null); setError(""); }}
            className={`flex-1 px-3 py-2 rounded-xl text-sm transition-all ${mode === "temporary" ? "bg-violet-50 dark:bg-cyan-400/20 text-accent border border-violet-200 dark:border-cyan-400/30" : "bg-neutral-50 dark:bg-neutral-700 text-neutral-500 dark:text-gray-400 border border-neutral-200 dark:border-white/5"}`}
          >
            Временная
          </button>
        </div>

        {mode === "permanent" ? (
          loading && !permInvite ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">Получение постоянной ссылки…</p>
          ) : (
            linkBlock
          )
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-neutral-500 dark:text-neutral-400 flex flex-col gap-1">
                Срок действия
                <select value={expires} onChange={(e) => setExpires(Number(e.target.value))} className="rounded-xl bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-neutral-900 dark:text-white">
                  {INVITE_EXPIRY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 flex flex-col gap-1">
                Макс. использований
                <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="rounded-xl bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-neutral-900 dark:text-white">
                  {INVITE_USES_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
              <Button onClick={createTemporary} disabled={loading} size="md">
                {loading ? "..." : tempInvite ? "Создать ещё" : "Создать"}
              </Button>
            </div>
            {linkBlock}
          </>
        )}

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        <button onClick={onClose} className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all text-sm">
          Закрыть
        </button>
      </div>
    </ModalBackdrop>
  );
}

export function GroupRulesGate({ group, onAccept }: { group: GroupDetail; onAccept: () => void }) {
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <div className="max-w-lg w-full mx-4 p-6 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-white/10 shadow-lg">
      <div className="text-center mb-4">
        {group.icon && group.icon.startsWith("/") && !imgError ? (
          <div className="w-16 h-16 rounded-xl overflow-hidden mx-auto mb-3">
            <Image src={group.icon} alt={group.name} width={64} height={64} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          </div>
        ) : (
          <div className="w-16 h-16 rounded-xl bg-violet-100 dark:bg-cyan-400/10 flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-violet-500 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
        )}
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white">{group.name}</h2>
        <p className="text-xs text-neutral-400 mt-1">Ознакомьтесь с правилами сообщества</p>
      </div>
      <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-4 mb-4 max-h-60 overflow-y-auto">
        <p className="text-sm text-neutral-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{group.rules}</p>
      </div>
      <Button
        onClick={async () => {
          setLoading(true);
          try {
            await onAccept();
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
        size="md"
        fullWidth
      >
        {loading ? "..." : "Принимаю правила"}
      </Button>
    </div>
  );
}

export function GroupInfoPanel({ group, canManage, onUpdateRules, onAutoSelectChannel }: { group: GroupDetail; canManage: boolean; onUpdateRules: (rules: string) => Promise<void>; onAutoSelectChannel?: () => void }) {
  const [editingRules, setEditingRules] = useState(false);
  const [rulesText, setRulesText] = useState(group.rules || "");
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (onAutoSelectChannel) onAutoSelectChannel();
  }, [onAutoSelectChannel]);

  // «Онлайн» считается по загруженной странице участников — это подсказка на
  // экране приветствия, а не точный счётчик присутствия. Всего участников
  // берётся из membersTotal: в `members` теперь лежит только первая страница.
  const onlineCount = group.members.filter(m => m.user.lastSeen && (Date.now() - new Date(m.user.lastSeen).getTime()) < 60000).length;
  const created = new Date(group.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  const handleSaveRules = async () => {
    setSaving(true);
    await onUpdateRules(rulesText);
    setEditingRules(false);
    setSaving(false);
  };

  return (
    <div className="max-w-md w-full mx-4 py-8">
      <div className="text-center mb-6">
        {group.icon && group.icon.startsWith("/") && !imgError ? (
          <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg">
            <Image src={group.icon} alt={group.name} width={80} height={80} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-violet-100 dark:bg-cyan-400/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-violet-500 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
        )}
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{group.name}</h2>
        {group.description && <p className="text-sm text-neutral-500 dark:text-gray-400 mt-1">{group.description}</p>}
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl">
          <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          <div className="text-sm">
            <span className="text-neutral-900 dark:text-white font-medium">Владелец:</span>{" "}
            <span className="text-neutral-500 dark:text-gray-400">@{group.owner.username}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl">
          <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <div className="text-sm">
            <span className="text-neutral-900 dark:text-white font-medium">{group.membersTotal ?? group.members.length}</span>{" "}
            <span className="text-neutral-500 dark:text-gray-400">участников</span>
            {onlineCount > 0 && (
              <span className="text-green-500 ml-2">({onlineCount} онлайн)</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl">
          <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <div className="text-sm">
            <span className="text-neutral-500 dark:text-gray-400">Создана {created}</span>
          </div>
        </div>
      </div>

      {/* Rules section */}
      {canManage ? (
        <div className="border border-neutral-200 dark:border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Правила сообщества</h3>
            {!editingRules && (
              <button onClick={() => { setRulesText(group.rules || ""); setEditingRules(true); }} className="text-xs text-violet-500 dark:text-cyan-400 hover:underline">
                {group.rules ? "Редактировать" : "Добавить"}
              </button>
            )}
          </div>
          {editingRules ? (
            <div className="space-y-2">
              <textarea
                value={rulesText}
                onChange={(e) => setRulesText(e.target.value)}
                placeholder="Напишите правила вашего сообщества..."
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 resize-none h-32"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleSaveRules} disabled={saving} className="px-3 py-1.5 bg-violet-500 dark:bg-cyan-500 text-white dark:text-neutral-900 rounded-lg text-xs font-medium disabled:opacity-50">
                  {saving ? "..." : "Сохранить"}
                </button>
                <button onClick={() => setEditingRules(false)} className="px-3 py-1.5 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-gray-400 rounded-lg text-xs">
                  Отмена
                </button>
              </div>
            </div>
          ) : group.rules ? (
            <p className="text-sm text-neutral-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{group.rules}</p>
          ) : (
            <p className="text-xs text-neutral-400 italic">Правила не установлены. Новые участники увидят их при первом входе.</p>
          )}
        </div>
      ) : group.rules ? (
        <div className="border border-neutral-200 dark:border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2">Правила сообщества</h3>
          <p className="text-sm text-neutral-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{group.rules}</p>
        </div>
      ) : null}

      <p className="text-center text-neutral-400 text-xs mt-6">Выберите канал для общения</p>
    </div>
  );
}

/* GroupSettingsModal was redesigned as a full-screen settings window
   (matching the profile settings page) and moved to its own file. */
export { default as GroupSettingsModal } from "./GroupSettingsModal";

/**
 * FIX-PANELVIEW3: список участников как отдельный компонент.
 *
 * Раньше он был вшит в `MembersPanel` — отдельную колонку, которую открывала
 * кнопка «Участники» внизу списка каналов. Кнопку убрали, а участники переехали
 * в правую панель (режим цикла «участники → разделы → скрыть»), поэтому список
 * нужен без обёртки. Второй раз рисовать его я не стал: у этого уже есть
 * аватары с подсветкой, роли и живой индикатор присутствия.
 *
 * Тип строки объявлен здесь и перечисляет ровно то, что списку нужно. Он не
 * ссылается на `GroupDetail`, потому что таких типов в проекте два: полный в
 * `groupTypes.ts` и урезанный в `sidebarTypes.ts` для боковой панели. Требовать
 * один из них означало бы, что список нельзя показать из другого места; поля
 * присутствия и подсветки поэтому необязательные.
 */
export interface MemberListEntry {
  role: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
    role: string;
    lastSeen?: string | null;
    avatarGlowEnabled?: boolean;
    avatarGlowColors?: string | null;
  };
}

/** Строка участника, как её отдаёт GET /api/groups/[id]/members. */
interface FetchedMemberRow {
  role: string;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    avatar: string | null;
    role: string;
    lastSeen?: string | null;
    avatarGlowEnabled?: boolean;
    avatarGlowColors?: string | null;
  };
}

function toEntry(m: FetchedMemberRow): MemberListEntry {
  return { role: m.role, user: { ...m.user, name: m.user.name ?? "", username: m.user.username ?? "" } };
}

/**
 * `members` — первая страница из снимка сообщества, `total` — сколько людей в
 * группе всего. Если показано меньше, чем всего, внизу появляется «Показать
 * ещё»: страницы берутся из GET /api/groups/[id]/members. Без `groupId`/`total`
 * компонент ведёт себя как раньше и просто рисует переданный список.
 */
export function MembersList({ members, groupId, total }: { members: MemberListEntry[]; groupId?: string; total?: number }) {
  /* Тик раз в 30 секунд: `isOnline()` и `timeAgo()` считают от `Date.now()`, и без
     ререндера подписи замирают на моменте открытия списка. */
  const [, setNowTick] = useState(0);

  /* Присутствие. Тика мало: он лишь пересчитывает подписи по ТЕМ ЖЕ данным, а
     `lastSeen` в них — с момента открытия группы, потому что снимок сообщества
     больше не перезапрашивается. Из-за этого зашедший позже так и оставался «был
     3 дня назад», а бывший в сети через минуту гас навсегда: его отметка просто
     старела. Отсюда «пока не выйду из группы и не зайду заново — не меняется».

     Поэтому рядом с тиком идёт лёгкий запрос присутствия: он приносит только
     идентификаторы тех, кто в сети (см. api/groups/[id]/presence). Снимок группы
     целиком для этого не тянем — от этого и отказались как от дорогого. */
  const [presence, setPresence] = useState<OnlinePresence | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!groupId) return;
      try {
        const res = await fetch(`/api/groups/${groupId}/presence`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as OnlinePresence;
        if (alive && Array.isArray(data.online) && typeof data.at === "string") setPresence(data);
      } catch {
        /* сеть отвалилась — присутствие просто не обновится к этому тику */
      }
    };
    void load();
    const id = setInterval(() => {
      setNowTick((t) => t + 1);
      void load();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [groupId]);

  const [loaded, setLoaded] = useState<MemberListEntry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Догруженные страницы принадлежат конкретному сообществу — при переключении
  // группы их надо забыть. Сброса на каждое обновление `members` нет намеренно:
  // снимок группы перезапрашивается по живым событиям, и список схлопывался бы
  // прямо под курсором.
  useEffect(() => {
    setLoaded([]);
    setLoadingMore(false);
  }, [groupId]);

  // Первая страница остаётся источником истины (её обновляют живые события), а
  // повторы после склейки отбрасываем: пока человек читает список, кто-то мог
  // войти в группу и сдвинуть смещение следующей страницы.
  const shown = useMemo(() => {
    const base = (() => {
      if (loaded.length === 0) return members;
      const seen = new Set<string>();
      const out: MemberListEntry[] = [];
      for (const m of [...members, ...loaded]) {
        if (seen.has(m.user.id)) continue;
        seen.add(m.user.id);
        out.push(m);
      }
      return out;
    })();
    /* Присутствие поверх списка: тем, кто в сети, подставляем свежую отметку.
       Остальных не трогаем — их подпись «был(а) N назад» растёт сама. */
    return mergePresence(base, presence);
  }, [members, loaded, presence]);

  const hasMore = !!groupId && typeof total === "number" && shown.length < total;

  const loadMore = async () => {
    if (!groupId || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members?skip=${shown.length}&take=50`);
      if (res.ok) {
        const data: { members?: FetchedMemberRow[] } = await res.json();
        const rows = (data.members ?? []).map(toEntry);
        if (rows.length > 0) setLoaded((prev) => [...prev, ...rows]);
      }
    } catch {
      /* сеть отвалилась — кнопка останется на месте, повтор по клику */
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-0.5" role="list" aria-label="Участники группы">
      {shown.map((m) => (
        <div key={m.user.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors" role="listitem">
          <div className="relative flex-shrink-0">
            <GlowAvatar user={m.user} size={28} onlineColor={isOnline(m.user.lastSeen) ? "green" : "gray"} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-neutral-900 dark:text-white truncate">{m.user.name}</div>
            <div className="text-[10px] text-neutral-400 truncate">
              @{m.user.username}
              {!isOnline(m.user.lastSeen) && m.user.lastSeen && <span className="text-neutral-400/70"> &middot; {timeAgo(m.user.lastSeen)}</span>}
            </div>
          </div>
          {m.role === "OWNER" && <span className="ml-auto flex-shrink-0" aria-label="Owner"><CrownIcon size={16} className="text-amber-500" /></span>}
          {m.role === "ADMIN" && <span className="ml-auto flex-shrink-0" aria-label="Admin"><ShieldIcon size={16} className="text-red-500" /></span>}
          {m.role === "MODERATOR" && <span className="ml-auto flex-shrink-0" aria-label="Moderator"><ShieldIcon size={16} className="text-violet-500" /></span>}
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full px-2 py-1.5 rounded-lg text-[11px] text-neutral-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Загрузка…" : "Показать ещё"}
        </button>
      )}
    </div>
  );
}

/* ─── Mobile view state ─── */
