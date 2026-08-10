"use client";

// FIX-COMMUNITY: модуль «Общественность» — социальный раздел группы.
// Вкладка «Активность»: сводные счётчики участников (сообщения, время в
// голосовых, решённые задачи, вклад в базу знаний) с сортировкой-лидербордом.
// Вкладка «Онбординг»: участник заполняет форму (не чаще раза в сутки) и
// после одобрения получает роль-тег; форму настраивают и заявки рассматривают
// только создатель и админ группы (не модератор). Заявка уходит админам
// личным уведомлением (колокольчик / раздел уведомлений настроек).

import { useCallback, useEffect, useMemo, useState } from "react";
import GlowAvatar, { GlowAvatarUser } from "@/components/ui/GlowAvatar";
import { UsersIcon, CheckIcon, ClockIcon, ChatIcon, TaskIcon, BookOpenIcon } from "@/components/ui/ConnectIcons";
import InfoTooltip from "@/components/ui/InfoTooltip";

/* ─── Типы ответов API ─── */

interface ActivityRow {
  user: GlowAvatarUser & { username?: string | null };
  role: string;
  joinedAt: string;
  messages: number;
  voiceSeconds: number;
  tasksDone: number;
  wiki: number;
}

interface OnboardingRole { id: string; name: string; color: string }

interface OnboardingFormData {
  active: boolean;
  description: string;
  questions: string[];
  role: OnboardingRole | null;
}

interface MyApplication {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewNote: string | null;
}

interface PendingApplication {
  id: string;
  answers: string;
  createdAt: string;
  user: GlowAvatarUser & { username?: string | null };
}

/* FIX-ONBSEND: данные диалога рассылки формы (приходят только управляющим). */
interface OnboardingRecipientRole extends OnboardingRole { memberCount: number }
interface OnboardingRecipientMember {
  userId: string;
  name: string | null;
  username: string | null;
  avatar: string | null;
  roleIds: string[];
}
interface OnboardingRecipients {
  roles: OnboardingRecipientRole[];
  members: OnboardingRecipientMember[];
  sentCount: number;
}

interface OnboardingState {
  form: OnboardingFormData | null;
  myApplication: MyApplication | null;
  nextApplyAt: string | null;
  isManager: boolean;
  /** FIX-ONBSEND: форму прислали лично — её можно заполнить и при active=false. */
  invited?: boolean;
  recipients?: OnboardingRecipients;
  applications?: PendingApplication[];
}

interface CommunityPanelProps {
  groupId: string;
  channelName: string;
  currentUserId: string;
  /** Роль в группе: форму и заявки ведут только OWNER и ADMIN. */
  myRole: string;
}

type SortKey = "messages" | "voiceSeconds" | "tasksDone" | "wiki";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "messages", label: "Сообщения" },
  { key: "voiceSeconds", label: "Голос" },
  { key: "tasksDone", label: "Задачи" },
  { key: "wiki", label: "База знаний" },
];

function formatVoice(seconds: number): string {
  if (!seconds || seconds < 60) return seconds > 0 ? "<1м" : "0м";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function parseAnswers(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const inputCls =
  "w-full px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none focus:border-[var(--accent,#3b82f6)] text-sm";

export default function CommunityPanel({ groupId, channelName, currentUserId, myRole }: CommunityPanelProps) {
  const [tab, setTab] = useState<"activity" | "onboarding">("activity");
  const isManager = myRole === "OWNER" || myRole === "ADMIN";

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary,#0f1117)] text-[var(--text-primary,#e6e6e6)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border,#222)]">
        <span className="text-lg font-semibold flex items-center gap-2">
          <UsersIcon size={20} /> {channelName}
        </span>
        <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary,#1a1d27)] p-0.5">
          <button
            onClick={() => setTab("activity")}
            className={"px-2.5 py-1 text-xs rounded-md " + (tab === "activity" ? "bg-[var(--accent,#3b82f6)] text-white" : "text-[var(--text-muted,#9aa0ab)]")}
          >
            Активность
          </button>
          <button
            onClick={() => setTab("onboarding")}
            className={"px-2.5 py-1 text-xs rounded-md " + (tab === "onboarding" ? "bg-[var(--accent,#3b82f6)] text-white" : "text-[var(--text-muted,#9aa0ab)]")}
          >
            Онбординг
          </button>
        </div>
      </div>

      {tab === "activity" ? (
        <ActivityTab groupId={groupId} currentUserId={currentUserId} />
      ) : (
        <OnboardingTab groupId={groupId} isManager={isManager} />
      )}
    </div>
  );
}

/* ═══════════════════════ Активность ═══════════════════════ */

function ActivityTab({ groupId, currentUserId }: { groupId: string; currentUserId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("messages");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/groups/${groupId}/activity`);
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          if (!cancelled) setError(d?.error || "Не удалось загрузить активность");
          return;
        }
        const data = await res.json();
        if (!cancelled) setRows(Array.isArray(data.members) ? data.members : []);
      } catch {
        if (!cancelled) setError("Ошибка сети");
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [rows, sortKey]);

  if (error) return <div className="flex-1 flex items-center justify-center text-sm text-red-400">{error}</div>;
  if (!rows) return <div className="flex-1 flex items-center justify-center text-[var(--text-muted,#9aa0ab)]">Загрузка…</div>;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-xs text-[var(--text-muted,#9aa0ab)]">
          Вклад участников
          <InfoTooltip text="Считаются сообщения, время в голосовых каналах, решённые задачи, а также статьи и термины базы знаний. Голосовое время начали считать с того дня, когда в группе подключили этот раздел." side="bottom" className="ml-1" />
        </p>
        <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary,#1a1d27)] p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSortKey(s.key)}
              className={"px-2 py-1 text-[11px] rounded-md " + (sortKey === s.key ? "bg-[var(--accent,#3b82f6)] text-white" : "text-[var(--text-muted,#9aa0ab)]")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.map((row, i) => {
          const isMe = row.user.id === currentUserId;
          return (
            <div
              key={row.user.id}
              className={"flex items-center gap-3 p-2.5 rounded-lg " + (isMe ? "bg-[var(--accent,#3b82f6)]/10 border border-[var(--accent,#3b82f6)]/25" : "bg-[var(--bg-secondary,#1a1d27)]")}
            >
              <span className={"w-7 text-center text-sm font-bold flex-shrink-0 " + (i < 3 ? "text-amber-400" : "text-[var(--text-muted,#9aa0ab)]")}>
                {i + 1}
              </span>
              <GlowAvatar user={row.user} size={34} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {row.user.name}
                  {isMe && <span className="ml-1.5 text-[10px] text-[var(--accent,#3b82f6)]">вы</span>}
                </p>
                {row.user.username && <p className="text-[11px] text-[var(--text-muted,#9aa0ab)] truncate">@{row.user.username}</p>}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center flex-shrink-0">
                <Metric icon={<ChatIcon size={13} />} value={String(row.messages)} label="сообщ." active={sortKey === "messages"} />
                <Metric icon={<ClockIcon size={13} />} value={formatVoice(row.voiceSeconds)} label="голос" active={sortKey === "voiceSeconds"} />
                <Metric icon={<TaskIcon size={13} />} value={String(row.tasksDone)} label="задач" active={sortKey === "tasksDone"} />
                <Metric icon={<BookOpenIcon size={13} />} value={String(row.wiki)} label="статей" active={sortKey === "wiki"} />
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-center text-sm text-[var(--text-muted,#9aa0ab)] mt-10">В группе пока нет участников.</p>
        )}
      </div>
    </div>
  );
}

function Metric({ icon, value, label, active }: { icon: React.ReactNode; value: string; label: string; active: boolean }) {
  return (
    <div className={"w-[64px] rounded-md py-1 " + (active ? "bg-[var(--accent,#3b82f6)]/15" : "")}>
      <p className={"text-xs font-bold leading-none flex items-center justify-center gap-1 " + (active ? "text-[var(--accent,#3b82f6)]" : "")}>
        {icon}
        {value}
      </p>
      <p className="text-[9px] text-[var(--text-muted,#9aa0ab)] mt-0.5">{label}</p>
    </div>
  );
}

/* ═══════════════════════ Онбординг ═══════════════════════ */

function OnboardingTab({ groupId, isManager }: { groupId: string; isManager: boolean }) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/onboarding`);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error || "Не удалось загрузить онбординг");
        return;
      }
      setState(await res.json());
      setError("");
    } catch {
      setError("Ошибка сети");
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3000);
  };

  if (error && !state) return <div className="flex-1 flex items-center justify-center text-sm text-red-400">{error}</div>;
  if (!state) return <div className="flex-1 flex items-center justify-center text-[var(--text-muted,#9aa0ab)]">Загрузка…</div>;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4 max-w-2xl w-full mx-auto">
      {notice && <p className="px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm">{notice}</p>}
      {error && <p className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</p>}

      <ApplicantCard state={state} groupId={groupId} onDone={() => { void load(); flash("Заявка отправлена — админы группы получили уведомление"); }} onError={setError} />

      {isManager && (
        <>
          <FormBuilder state={state} groupId={groupId} onSaved={() => { void load(); flash("Форма сохранена"); }} onError={setError} />
          {/* FIX-ONBSEND: адресная рассылка сохранённой формы */}
          <SendFormCard
            state={state}
            groupId={groupId}
            onSent={(count) => { void load(); flash(`Форма отправлена: ${count} получател(ь/я/ей)`); }}
            onError={setError}
          />
          <ApplicationsQueue state={state} groupId={groupId} onReviewed={() => { void load(); }} onError={setError} />
        </>
      )}
    </div>
  );
}

/* ── Карточка участника: форма/статус заявки ── */

function ApplicantCard({ state, groupId, onDone, onError }: {
  state: OnboardingState;
  groupId: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const form = state.form;
  const app = state.myApplication;
  const [answers, setAnswers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setAnswers(form ? form.questions.map(() => "") : []);
  }, [form]);

  const cooldownLeft = state.nextApplyAt ? new Date(state.nextApplyAt).getTime() - Date.now() : 0;
  /* FIX-ONBSEND: форма доступна, когда она включена для всей группы ИЛИ когда
     её прислали лично этому участнику. */
  const formOpen = !!form && (form.active || state.invited === true);
  const canApply =
    formOpen &&
    app?.status !== "PENDING" &&
    app?.status !== "APPROVED" &&
    cooldownLeft <= 0;

  const submit = async () => {
    if (answers.some((a) => !a.trim())) {
      onError("Ответьте на все вопросы формы");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        onError(d?.error || "Не удалось отправить заявку");
      } else {
        onError("");
        onDone();
      }
    } catch {
      onError("Ошибка сети");
    }
    setSending(false);
  };

  return (
    <section className="rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-4">
      <h3 className="text-sm font-semibold mb-1">Онбординг группы</h3>

      {!form || !formOpen ? (
        <p className="text-sm text-[var(--text-muted,#9aa0ab)]">
          Онбординг в этой группе пока не настроен.
        </p>
      ) : (
        <>
          {!form.active && state.invited && (
            <p className="mb-2 px-3 py-2 rounded-lg bg-[var(--accent,#3b82f6)]/10 text-[var(--accent,#3b82f6)] text-xs">
              Эту анкету прислали вам лично от имени сообщества.
            </p>
          )}
          {form.description && <p className="text-sm text-[var(--text-secondary,#c4c8d0)] whitespace-pre-wrap mb-2">{form.description}</p>}
          {form.role && (
            <p className="text-xs text-[var(--text-muted,#9aa0ab)] mb-3">
              После одобрения вы получите роль{" "}
              <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: form.role.color + "26", color: form.role.color }}>
                {form.role.name}
              </span>
            </p>
          )}

          {app?.status === "PENDING" && (
            <p className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm">Ваша заявка на рассмотрении.</p>
          )}
          {app?.status === "APPROVED" && (
            <p className="px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm flex items-center gap-1.5">
              <CheckIcon size={14} /> Заявка одобрена{form.role ? ` — роль «${form.role.name}» выдана` : ""}.
            </p>
          )}
          {app?.status === "REJECTED" && (
            <p className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm mb-2">
              Предыдущая заявка отклонена{app.reviewNote ? `: ${app.reviewNote}` : ""}.
              {cooldownLeft > 0 && ` Новую можно подать через ${Math.ceil(cooldownLeft / 3_600_000)} ч.`}
            </p>
          )}

          {canApply && (
            <div className="space-y-3 mt-2">
              {form.questions.map((q, i) => (
                <div key={i}>
                  <label className="block text-xs text-[var(--text-muted,#9aa0ab)] mb-1">{i + 1}. {q}</label>
                  <textarea
                    value={answers[i] ?? ""}
                    onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
                    rows={2}
                    maxLength={1000}
                    className={inputCls + " resize-none"}
                    placeholder="Ваш ответ…"
                  />
                </div>
              ))}
              <button
                onClick={submit}
                disabled={sending}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Отправка…" : "Отправить заявку"}
              </button>
              <p className="text-[10px] text-[var(--text-muted,#9aa0ab)]">Заявку можно подавать один раз в сутки.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── Конструктор формы (OWNER/ADMIN) ── */

function FormBuilder({ state, groupId, onSaved, onError }: {
  state: OnboardingState;
  groupId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [active, setActive] = useState(!!state.form?.active);
  const [description, setDescription] = useState(state.form?.description ?? "");
  const [questions, setQuestions] = useState<string[]>(state.form?.questions?.length ? state.form.questions : [""]);
  const [roleId, setRoleId] = useState<string>(state.form?.role?.id ?? "");
  const [roles, setRoles] = useState<OnboardingRole[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/groups/${groupId}/roles`);
        if (!res.ok) return;
        const data = await res.json();
        const list: OnboardingRole[] = Array.isArray(data) ? data : Array.isArray(data?.roles) ? data.roles : [];
        if (!cancelled) setRoles(list.filter((r) => r && typeof r.id === "string"));
      } catch { /* роли не загрузились — селектор просто останется пустым */ }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const save = async () => {
    const clean = questions.map((q) => q.trim()).filter(Boolean);
    if (clean.length === 0) {
      onError("Добавьте хотя бы один вопрос");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, description, questions: clean, roleId: roleId || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) onError(d?.error || "Не удалось сохранить форму");
      else {
        onError("");
        onSaved();
      }
    } catch {
      onError("Ошибка сети");
    }
    setSaving(false);
  };

  return (
    <section className="rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Настройка формы</h3>
          <p className="text-[11px] text-[var(--text-muted,#9aa0ab)]">Доступно создателю и админам группы</p>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--accent,#3b82f6)]" />
          Форма активна
        </label>
      </div>

      <div className="space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Описание для участников (зачем заполнять форму)…"
          className={inputCls + " resize-none"}
        />

        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQuestions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                maxLength={200}
                placeholder={`Вопрос ${i + 1}`}
                className={inputCls}
              />
              <button
                onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}
                disabled={questions.length <= 1}
                className="p-1.5 rounded text-[var(--text-muted,#9aa0ab)] hover:text-red-400 disabled:opacity-30"
                title="Удалить вопрос"
                aria-label={`Удалить вопрос ${i + 1}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {questions.length < 10 && (
            <button onClick={() => setQuestions((prev) => [...prev, ""])} className="text-xs text-[var(--accent,#3b82f6)] hover:underline">
              + Добавить вопрос
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs text-[var(--text-muted,#9aa0ab)] mb-1">Роль-тег за одобренную заявку</label>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputCls} aria-label="Роль за одобрение">
            <option value="">Без роли</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {roles.length === 0 && (
            <p className="text-[10px] text-[var(--text-muted,#9aa0ab)] mt-1">Роли-теги создаются в настройках группы → «Роли».</p>
          )}
        </div>

        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white hover:opacity-90 disabled:opacity-50">
          {saving ? "Сохранение…" : "Сохранить форму"}
        </button>
      </div>
    </section>
  );
}

/* ── FIX-ONBSEND: рассылка формы участникам и тегам (OWNER/ADMIN) ── */

function SendFormCard({ state, groupId, onSent, onError }: {
  state: OnboardingState;
  groupId: string;
  onSent: (count: number) => void;
  onError: (msg: string) => void;
}) {
  const data = state.recipients;
  const [pickedRoles, setPickedRoles] = useState<Set<string>>(new Set());
  const [pickedUsers, setPickedUsers] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);

  const members = useMemo(() => data?.members ?? [], [data]);
  const roles = data?.roles ?? [];

  /* Итоговый охват: адресные получатели плюс носители выбранных тегов. */
  const reach = useMemo(() => {
    const ids = new Set(pickedUsers);
    if (pickedRoles.size > 0) {
      for (const m of members) {
        if (m.roleIds.some((id) => pickedRoles.has(id))) ids.add(m.userId);
      }
    }
    return ids.size;
  }, [pickedUsers, pickedRoles, members]);

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? members.filter(
          (m) =>
            (m.name || "").toLowerCase().includes(q) ||
            (m.username || "").toLowerCase().includes(q),
        )
      : members;
    return list.slice(0, 60);
  }, [members, query]);

  const toggle = (set: Set<string>, apply: (s: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    apply(next);
  };

  const send = async () => {
    if (reach === 0) {
      onError("Выберите получателей: участников или теги");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/onboarding/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...pickedUsers], roleIds: [...pickedRoles] }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        onError(d?.error || "Не удалось отправить форму");
      } else {
        onError("");
        setPickedRoles(new Set());
        setPickedUsers(new Set());
        onSent(Number(d?.sent) || 0);
      }
    } catch {
      onError("Ошибка сети");
    }
    setSending(false);
  };

  if (!state.form) {
    return (
      <section className="rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-4">
        <h3 className="text-sm font-semibold mb-1">Рассылка формы</h3>
        <p className="text-sm text-[var(--text-muted,#9aa0ab)]">
          Сначала сохраните форму выше — после этого её можно будет отправить участникам и тегам.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold">
            Рассылка формы
            <InfoTooltip text="Анкета придёт человеку личным уведомлением от имени сообщества. Заполнить её он сможет, даже если для всей группы форма выключена." className="ml-1" />
          </h3>
        </div>
        {!!data?.sentCount && (
          <span className="flex-none text-[11px] text-[var(--text-muted,#9aa0ab)]">
            отправлена {data.sentCount}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-[var(--text-muted,#9aa0ab)] mb-1.5">Теги</p>
          {roles.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted,#9aa0ab)]">
              В группе нет тегов. Их создают в настройках группы → «Роли».
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => {
                const on = pickedRoles.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(pickedRoles, setPickedRoles)(r.id)}
                    className="px-2 py-1 rounded-full text-[11px] font-medium border transition-colors"
                    style={{
                      borderColor: on ? r.color : "var(--border,#222)",
                      backgroundColor: on ? r.color + "26" : "transparent",
                      color: on ? r.color : "var(--text-muted,#9aa0ab)",
                    }}
                  >
                    #{r.name}
                    <span className="ml-1 opacity-60">{r.memberCount}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-[var(--text-muted,#9aa0ab)] mb-1.5">Участники</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени или нику…"
            className={inputCls}
            aria-label="Поиск участников"
          />
          <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--border,#222)]">
            {visibleMembers.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-[var(--text-muted,#9aa0ab)]">Никого не найдено.</p>
            ) : (
              visibleMembers.map((m) => (
                <label
                  key={m.userId}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={pickedUsers.has(m.userId)}
                    onChange={() => toggle(pickedUsers, setPickedUsers)(m.userId)}
                    className="h-4 w-4 accent-[var(--accent,#3b82f6)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name || m.username || "Участник"}</span>
                  {m.username && (
                    <span className="flex-none text-[11px] text-[var(--text-muted,#9aa0ab)]">@{m.username}</span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={sending || reach === 0}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Отправка…" : "Отправить форму"}
          </button>
          <span className="text-[11px] text-[var(--text-muted,#9aa0ab)]">
            Получателей: {reach}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── Очередь заявок (OWNER/ADMIN) ── */

function ApplicationsQueue({ state, groupId, onReviewed, onError }: {
  state: OnboardingState;
  groupId: string;
  onReviewed: () => void;
  onError: (msg: string) => void;
}) {
  const apps = state.applications ?? [];
  const questions = state.form?.questions ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  const review = async (applicationId: string, action: "approve" | "reject") => {
    setBusy(applicationId);
    try {
      const res = await fetch(`/api/groups/${groupId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, action }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) onError(d?.error || "Не удалось рассмотреть заявку");
      else {
        onError("");
        onReviewed();
      }
    } catch {
      onError("Ошибка сети");
    }
    setBusy(null);
  };

  return (
    <section className="rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-4">
      <h3 className="text-sm font-semibold mb-3">Заявки на рассмотрении {apps.length > 0 && <span className="text-[var(--accent,#3b82f6)]">· {apps.length}</span>}</h3>
      {apps.length === 0 ? (
        <p className="text-sm text-[var(--text-muted,#9aa0ab)]">Новых заявок нет.</p>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => {
            const answers = parseAnswers(a.answers);
            return (
              <div key={a.id} className="rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] p-3">
                <div className="flex items-center gap-2.5 mb-2">
                  <GlowAvatar user={a.user} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.user.name}</p>
                    <p className="text-[11px] text-[var(--text-muted,#9aa0ab)]">
                      {a.user.username ? `@${a.user.username} · ` : ""}{new Date(a.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button
                    onClick={() => review(a.id, "approve")}
                    disabled={busy === a.id}
                    className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
                  >
                    Одобрить
                  </button>
                  <button
                    onClick={() => review(a.id, "reject")}
                    disabled={busy === a.id}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-600/80 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    Отклонить
                  </button>
                </div>
                <div className="space-y-1.5">
                  {answers.map((ans, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-[var(--text-muted,#9aa0ab)]">{questions[i] ?? `Вопрос ${i + 1}`}: </span>
                      <span className="text-[var(--text-secondary,#c4c8d0)] whitespace-pre-wrap">{ans}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
