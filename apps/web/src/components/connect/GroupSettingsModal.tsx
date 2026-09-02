"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import GlowAvatar from "@/components/ui/GlowAvatar";
import RoleManager from "@/components/connect/RoleManager";
import ChannelRoleManager from "@/components/connect/ChannelRoleManager";
import WorkspaceManager from "@/components/connect/WorkspaceManager";
import AuditPanel from "@/components/connect/settings/AuditPanel";
import ReportsPanel from "@/components/connect/settings/ReportsPanel";
import InvitesPanel from "@/components/connect/settings/InvitesPanel";
import StatsPanel from "@/components/connect/settings/StatsPanel";
import TimeoutButton from "@/components/connect/settings/TimeoutButton";
import EmojiPanel from "@/components/connect/settings/EmojiPanel";
/* GROUP-SKIN: инструменты дизайна группы. */
import DesignPanel from "@/components/connect/settings/DesignPanel";
import { CrownIcon, ShieldIcon } from "@/components/ui/ConnectIcons";
import InfoTooltip from "@/components/ui/InfoTooltip";
/* Значок раздела — готовый смайл из набора TrioZ: своего рисовать не нужно. */
import { TriozEmoji } from "@/components/ui/TriozEmoji";
import type { GroupDetail, GroupMember } from "./groupTypes";
import { fetchAllGroupMembers, type FetchedGroupMember } from "@/lib/groupMembersFetch";
import { CENSOR_LEVELS, CENSOR_LEVEL_LABELS, CENSOR_LEVEL_HINTS, CENSOR_WORD_MAX, type CensorLevel } from "@/lib/censor";

/* MODERATION: ранги — из общего модуля, чтобы настройки и серверные маршруты
   считали иерархию одним и тем же кодом. */
import { ROLE_RANK, effectiveRank, RANK_GUIDE } from "@/lib/groupModeration";

const ROLE_LABEL: Record<string, string> = {
	OWNER: "Создатель",
	ADMIN: "Админ",
	MODERATOR: "Модератор",
	GUIDE: "Проводник",
	MEMBER: "Участник",
};

const ROLE_BADGE: Record<string, string> = {
	OWNER: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	ADMIN: "bg-red-500/15 text-red-600 dark:text-red-400",
	MODERATOR: "bg-violet-500/15 text-violet-600 dark:bg-cyan-500/15 dark:text-cyan-400",
	GUIDE: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
	MEMBER: "bg-neutral-500/10 text-neutral-500 dark:text-gray-400",
};

type SectionId = "overview" | "rules" | "emoji" | "censor" | "design" | "workspace" | "members" | "roles" | "bans" | "invites" | "reports" | "audit" | "danger";

const SECTION_TITLE: Record<SectionId, string> = {
	overview: "Обзор",
	rules: "Правила",
	emoji: "Эмодзи",
	censor: "Цензура",
	design: "Дизайн",
	workspace: "Рабочая среда",
	members: "Участники",
	roles: "Роли",
	bans: "Забаненные",
	invites: "Приглашения",
	reports: "Жалобы",
	audit: "Аудит",
	danger: "Управление",
};

interface BanEntry {
	id: string;
	reason: string | null;
	createdAt: string;
	user: { id: string; name: string; username: string; avatar: string | null; role: string };
	bannedBy: { id: string; name: string; username: string };
}

interface CensorWord {
	id: string;
	word: string;
	level: CensorLevel;
	createdAt: string;
}

interface CensorCounter {
	userId: string;
	userName: string;
	username: string;
	avatar: string | null;
	total: number;
	byLevel: Partial<Record<CensorLevel, number>>;
	lastAt: string | null;
}

interface CensorData {
	available: boolean;
	limit: number;
	words: CensorWord[];
	counters: CensorCounter[];
}

interface ConfirmState {
	message: string;
	confirmLabel: string;
	withReason?: boolean;
	onConfirm: (reason: string) => void;
}

/* ─── Primitives (mirror the profile settings page) ─── */

const inputCls =
	"w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-violet-400 dark:focus:border-cyan-400";

function Section({ title, subtitle, info, children }: { title: string; subtitle?: string; info?: string; children: React.ReactNode }) {
	return (
		<section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-5 mb-4">
			<div className="mb-4">
				<h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{title}{info && <InfoTooltip text={info} side="bottom" className="ml-1" />}</h3>
				{subtitle && <p className="text-xs text-neutral-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
			</div>
			{children}
		</section>
	);
}

function NavIcon({ path }: { path: React.ReactNode }) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
			{path}
		</svg>
	);
}

/**
 * Full-screen group settings window, visually consistent with the profile
 * settings page (/settings): grouped sidebar navigation on the left, section
 * cards on the right, ESC / round button to close.
 */
export default function GroupSettingsModal({
	group,
	onClose,
	onUpdated,
	onDelete,
}: {
	group: GroupDetail;
	onClose: () => void;
	onUpdated: () => void;
	onDelete: () => void;
}) {
	const myRank = ROLE_RANK[group.myRole] ?? 0;
	const isOwner = group.myRole === "OWNER";
	const canEdit = myRank >= ROLE_RANK.MODERATOR; // name / description / rules
	const canManageRoles = myRank >= ROLE_RANK.ADMIN; // change member roles
	const canModerate = myRank >= RANK_GUIDE; // kick / ban / invites / audit
	const canManageWorkspace = isOwner || group.myRole === "ADMIN";

	const [section, setSection] = useState<SectionId>("overview");


	/* ban form */
	const [banUsername, setBanUsername] = useState("");
	const [banMode, setBanMode] = useState<"ban_only" | "ban_and_purge">("ban_only");
	const [banReasonPreset, setBanReasonPreset] = useState<"AD" | "SPAM" | "FRAUD" | "CUSTOM" | "">("AD");
	const [banReasonCustom, setBanReasonCustom] = useState("");
	const [banFormError, setBanFormError] = useState("");
	const [banFormLoading, setBanFormLoading] = useState(false);
	const [guidedDays, setGuidedDays] = useState<number>(7);
	/* overview */
	const [name, setName] = useState(group.name);
	const [description, setDescription] = useState(group.description || "");
	const [sectionsEnabled, setSectionsEnabled] = useState(!!group.sectionsEnabled);
	const [requireRules, setRequireRules] = useState(!!group.requireRules);
	// NEW: пауза группы («скелетирование») — только владелец/администратор
	const [paused, setPaused] = useState(!!group.paused);
	const [iconFile, setIconFile] = useState<File | null>(null);
	const [iconPreview, setIconPreview] = useState<string | null>(
		group.icon && group.icon.startsWith("/") ? group.icon : null,
	);
	/* rules */
	const [rules, setRules] = useState(group.rules || "");
	/* shared */
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [memberQuery, setMemberQuery] = useState("");
	/* участники */
	// В снимке группы теперь только первая страница участников, поэтому вкладка
	// ведёт свой список: страницы и поиск приходят с сервера.
	const [memberRows, setMemberRows] = useState<GroupMember[]>(group.members);
	const [memberTotal, setMemberTotal] = useState(group.membersTotal ?? group.members.length);
	const [membersBusy, setMembersBusy] = useState(false);
	// Бампается после смены роли, кика и бана — список перечитывается с сервера.
	const [memberReload, setMemberReload] = useState(0);
	// Полный список нужен только двум местам: назначению ролей-тегов и выбору
	// нового владельца. Догружается лениво, при заходе на эти вкладки.
	const [allMembers, setAllMembers] = useState<FetchedGroupMember[] | null>(null);
	const [confirm, setConfirm] = useState<ConfirmState | null>(null);
	const [confirmReason, setConfirmReason] = useState("");
	/* bans */
	const [bans, setBans] = useState<BanEntry[] | null>(null);
	/* censor */
	const [censorData, setCensorData] = useState<CensorData | null>(null);
	const [censorLoading, setCensorLoading] = useState(false);
	const [censorNewWord, setCensorNewWord] = useState("");
	const [censorNewLevel, setCensorNewLevel] = useState<CensorLevel>("WATCH");
	const [censorAdding, setCensorAdding] = useState(false);
	const [censorError, setCensorError] = useState("");
	/* danger */
	const [transferTarget, setTransferTarget] = useState("");

	/* ESC closes the window, like the profile settings overlay. */
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const flash = (msg: string) => {
		setNotice(msg);
		setTimeout(() => setNotice(""), 2500);
	};

	const loadBans = useCallback(async () => {
		try {
			const res = await fetch(`/api/groups/${group.id}/bans`);
			if (res.ok) {
				setBans(await res.json());
			} else {
				// НОВОЕ: не оставляем вечную «загрузку» — показываем причину ошибки
				const data = await res.json().catch(() => null);
				setBans([]);
				setError(data?.error || "Не удалось загрузить список забаненных");
			}
		} catch {
			/* network error — keep previous state */
		}
	}, [group.id]);

	useEffect(() => {
		if (section === "bans" && canModerate) void loadBans();
	}, [section, canModerate, loadBans]);

	const loadCensor = useCallback(async () => {
		setCensorLoading(true);
		try {
			const res = await fetch(`/api/groups/${group.id}/censor`);
			if (res.ok) {
				setCensorData(await res.json());
			} else {
				setCensorData(null);
			}
		} catch {
			/* network error */
		} finally {
			setCensorLoading(false);
		}
	}, [group.id]);

	useEffect(() => {
		if (section === "censor") void loadCensor();
	}, [section, loadCensor]);

	const handleCensorAdd = async () => {
		const word = censorNewWord.trim();
		if (!word) return;
		setCensorAdding(true);
		setCensorError("");
		try {
			const res = await fetch(`/api/groups/${group.id}/censor`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ word, level: censorNewLevel }),
			});
			const data = await res.json();
			if (!res.ok) {
				setCensorError(data?.error || "Не удалось добавить слово");
			} else {
				setCensorNewWord("");
				void loadCensor();
			}
		} catch {
			setCensorError("Ошибка сети");
		} finally {
			setCensorAdding(false);
		}
	};

	const handleCensorDelete = async (wordId: string) => {
		try {
			await fetch(`/api/groups/${group.id}/censor?wordId=${encodeURIComponent(wordId)}`, { method: "DELETE" });
			void loadCensor();
		} catch {
			/* ignore */
		}
	};

	// Первая страница участников и поиск. Поиск идёт на сервер: фильтровать
	// загруженный кусок означало бы «не найдено» для всех, кто в него не попал.
	// Пустой запрос выполняется сразу, набор текста — с задержкой, чтобы не
	// дёргать сервер на каждую букву.
	useEffect(() => {
		if (section !== "members") return;
		const q = memberQuery.trim();
		const loadFirstPage = async () => {
			setMembersBusy(true);
			try {
				const qs = new URLSearchParams({ take: "50" });
				if (q) qs.set("q", q);
				const res = await fetch(`/api/groups/${group.id}/members?${qs.toString()}`);
				if (res.ok) {
					const data = await res.json();
					setMemberRows(data.members ?? []);
					setMemberTotal(data.total ?? 0);
				}
			} catch {
				/* сеть отвалилась — оставляем то, что уже показано */
			} finally {
				setMembersBusy(false);
			}
		};
		const timer = setTimeout(() => { void loadFirstPage(); }, q ? 300 : 0);
		return () => clearTimeout(timer);
	}, [section, memberQuery, group.id, memberReload]);

	// Полный список — только для вкладок «Роли» (назначение тегов) и «Опасная
	// зона» (выбор нового владельца): там нужен каждый участник сразу.
	useEffect(() => {
		if (section !== "roles" && section !== "danger") return;
		if (allMembers) return;
		let alive = true;
		void fetchAllGroupMembers(group.id).then((rows) => {
			if (alive) setAllMembers(rows);
		});
		return () => { alive = false; };
	}, [section, allMembers, group.id]);

	const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			setError("Файл иконки — максимум 2MB");
			return;
		}
		setIconFile(file);
		setIconPreview(URL.createObjectURL(file));
	};

	const handleSaveGeneral = async () => {
		setSaving(true);
		setError("");
		try {
			let iconUrl = group.icon;
			if (iconFile) {
				const formData = new FormData();
				formData.append("icon", iconFile);
				const uploadRes = await fetch("/api/groups/icon", { method: "POST", body: formData });
				if (!uploadRes.ok) {
					setError("Ошибка загрузки иконки");
					setSaving(false);
					return;
				}
				iconUrl = (await uploadRes.json()).icon;
			}
			const res = await fetch(`/api/groups/${group.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim(), description: description.trim(), icon: iconUrl, sectionsEnabled, requireRules, ...(canManageWorkspace ? { paused } : {}) }),
			});
			if (!res.ok) {
				setError("Не удалось сохранить изменения");
			} else {
				onUpdated();
				flash("Сохранено");
			}
		} catch {
			setError("Ошибка сети");
		}
		setSaving(false);
	};

	const handleSaveRules = async () => {
		setSaving(true);
		setError("");
		try {
			const res = await fetch(`/api/groups/${group.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ rules }),
			});
			if (!res.ok) setError("Не удалось сохранить правила");
			else {
				onUpdated();
				flash("Правила сохранены");
			}
		} catch {
			setError("Ошибка сети");
		}
		setSaving(false);
	};

	const handleRoleChange = async (memberId: string, role: string) => {
		setError("");
		const res = await fetch(`/api/groups/${group.id}/members/${memberId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role }),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			setError(data?.error || "Не удалось изменить роль");
			return;
		}
		onUpdated();
		// Снимок группы обновит родитель, но список вкладки живёт отдельно.
		setMemberReload((n) => n + 1);
	};

	const handleKick = (m: GroupMember) => {
		setConfirm({
			message: `Исключить @${m.user.username} из группы? Пользователь сможет вернуться по приглашению.`,
			confirmLabel: "Исключить",
			onConfirm: async () => {
				await fetch(`/api/groups/${group.id}/members/${m.id}`, { method: "DELETE" });
				setConfirm(null);
				onUpdated();
				setMemberReload((n) => n + 1);
			},
		});
	};

	const handleBan = (m: GroupMember) => {
		setConfirmReason("");
		setConfirm({
			message: `Забанить @${m.user.username}? Пользователь будет исключён и не сможет вернуться по приглашениям, пока бан не снят.`,
			confirmLabel: "Забанить",
			withReason: true,
			onConfirm: async (reason) => {
				const res = await fetch(`/api/groups/${group.id}/bans`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ userId: m.user.id, reason: reason || undefined }),
				});
				setConfirm(null);
				if (!res.ok) {
					const data = await res.json().catch(() => null);
					setError(data?.error || "Не удалось забанить пользователя");
					return;
				}
				setError("");
				onUpdated();
				setMemberReload((n) => n + 1);
				void loadBans();
				flash("Пользователь забанен");
			},
		});
	};


	const handleBanByUsername = async () => {
		if (!banUsername.trim()) { setBanFormError("Укажите @ник"); return; }
		setBanFormError("");
		setBanFormLoading(true);
		const reasonPreset = banReasonPreset !== "CUSTOM" ? banReasonPreset : undefined;
		const reason = banReasonPreset === "CUSTOM" ? banReasonCustom : undefined;
		const res = await fetch(`/api/groups/${group.id}/bans`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: banUsername.replace(/^@/, ""),
				reasonPreset,
				reason,
				deleteMessages: banMode === "ban_and_purge",
			}),
		});
		setBanFormLoading(false);
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			setBanFormError(data?.error || "Ошибка");
			return;
		}
		setBanUsername("");
		setBanReasonCustom("");
		setBanFormError("");
		void loadBans();
		onUpdated();
		flash("Пользователь забан");
	};
	const handleUnban = async (ban: BanEntry) => {
		setError("");
		const res = await fetch(`/api/groups/${group.id}/bans/${ban.id}`, { method: "DELETE" });
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			setError(data?.error || "Не удалось снять бан");
			return;
		}
		void loadBans();
		flash(`Бан @${ban.user.username} снят`);
	};

	const handleTransfer = () => {
		// Новый владелец выбирается из полного списка — он для этой вкладки догружен.
		const target = (allMembers ?? []).find((m) => m.id === transferTarget);
		if (!target) return;
		setConfirm({
			message: `Передать группу @${target.user.username ?? target.user.name}? Он станет создателем, а вы останетесь админом. Действие необратимо.`,
			confirmLabel: "Передать",
			onConfirm: async () => {
				const res = await fetch(`/api/groups/${group.id}/transfer-ownership`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ memberId: target.id }),
				});
				setConfirm(null);
				if (!res.ok) {
					const data = await res.json().catch(() => null);
					setError(data?.error || "Не удалось передать группу");
					return;
				}
				onUpdated();
				onClose();
			},
		});
	};

	// Отбор по имени и нику делает сервер, здесь остаётся только порядок:
	// сначала старшие роли. Сортировка применяется к загруженным страницам —
	// сервер отдаёт участников в порядке вступления, и владелец с админами в нём
	// идут первыми, потому что вступили раньше остальных.
	const shownMembers = useMemo(
		() => [...memberRows].sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0)),
		[memberRows],
	);

	const loadMoreMembers = async () => {
		if (membersBusy) return;
		setMembersBusy(true);
		try {
			const qs = new URLSearchParams({ take: "50", skip: String(memberRows.length) });
			const q = memberQuery.trim();
			if (q) qs.set("q", q);
			const res = await fetch(`/api/groups/${group.id}/members?${qs.toString()}`);
			if (res.ok) {
				const data = await res.json();
				const rows: GroupMember[] = data.members ?? [];
				if (rows.length > 0) {
					// Пока страницу листали, кто-то мог войти в группу и сдвинуть
					// смещение — повторы отбрасываем по id записи участника.
					setMemberRows((prev) => {
						const seen = new Set(prev.map((m) => m.id));
						return [...prev, ...rows.filter((m) => !seen.has(m.id))];
					});
				}
			}
		} catch {
			/* сеть отвалилась — кнопка остаётся на месте, повтор по клику */
		} finally {
			setMembersBusy(false);
		}
	};

	/* ─── Sidebar navigation (grouped, like /settings) ─── */
	const NAV: { group: string; items: { id: SectionId; label: string; icon: React.ReactNode; danger?: boolean }[] }[] = [
		{
			group: "Группа",
			items: [
				{ id: "overview", label: "Обзор", icon: <NavIcon path={<><path d="M3 12l9-9 9 9" /><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" /></>} /> },
				{ id: "rules", label: "Правила", icon: <NavIcon path={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></>} /> },
				{ id: "emoji", label: "Эмодзи", icon: <TriozEmoji emoji="😊" size={16} /> },
				{ id: "censor", label: "Цензура", icon: <NavIcon path={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>} /> },
				...(!group.isMain && canManageWorkspace
					? [{ id: "workspace" as const, label: "Рабочая среда", icon: <NavIcon path={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} /> }]
					: []),
				...(canManageWorkspace
					? [{ id: "design" as const, label: "Дизайн", icon: <NavIcon path={<><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h2a4 4 0 0 0 4-4A10 10 0 0 0 12 2z" /></>} /> }]
					: []),
			],
		},
		{
			group: "Участники",
			items: [
				{ id: "members", label: "Участники", icon: <NavIcon path={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>} /> },
				{ id: "roles", label: "Роли", icon: <NavIcon path={<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" /></>} /> },
				...(canModerate
					? [
							{ id: "bans" as const, label: "Забаненные", icon: <NavIcon path={<><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93l14.14 14.14" /></>} /> },
							{ id: "invites" as const, label: "Приглашения", icon: <NavIcon path={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>} /> },
							{ id: "reports" as const, label: "Жалобы", icon: <NavIcon path={<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>} /> },
							{ id: "audit" as const, label: "Аудит", icon: <NavIcon path={<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>} /> },
						]
					: []),
			],
		},
		...(isOwner
			? [
					{
						group: "Управление",
						items: [
							{ id: "danger" as const, label: "Опасная зона", icon: <NavIcon path={<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>} />, danger: true },
						],
					},
				]
			: []),
	];

	const renderSection = () => {
		switch (section) {
			case "design":
				return (
					<Section
						title="Дизайн сообщества"
						subtitle="Фон переписки и каналов, шрифт, баннер и частицы. Видят все участники."
					>
						<DesignPanel groupId={group.id} theme={group.theme ?? null} onSaved={() => onUpdated()} />
					</Section>
				);
			case "overview":
				return (
					<>
						<Section title="Основное">
							<div className="flex items-start gap-4 mb-4">
								<label className={`relative flex-shrink-0 w-16 h-16 rounded-2xl overflow-hidden border border-neutral-200 dark:border-white/10 ${canEdit ? "cursor-pointer" : ""}`}>
									{iconPreview ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={iconPreview} alt="" className="w-full h-full object-cover" />
									) : (
										<span className="w-full h-full flex items-center justify-center text-xl font-bold bg-gradient-to-br from-violet-500 to-indigo-500 dark:from-cyan-500 dark:to-blue-500 text-white">
											{group.name.slice(0, 1).toUpperCase()}
										</span>
									)}
									{canEdit && <input type="file" accept="image/*" onChange={handleIconChange} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Иконка группы" />}
								</label>
								<div className="flex-1 space-y-3">
									<div>
										<label className="block text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1">Название</label>
										<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название группы..." disabled={!canEdit} className={inputCls} />
									</div>
									<div>
										<label className="block text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1">Описание</label>
										<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание группы..." disabled={!canEdit} className={`${inputCls} resize-none h-24`} />
									</div>
								</div>
							</div>
							{!group.isMain && group.owner?.isPremium && isOwner && (
								<label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-white/10 mb-3 cursor-pointer">
									<span>
										<span className="block text-sm font-medium text-neutral-900 dark:text-white">Разделы<InfoTooltip text="Включает в этом канале систему разделов: чаты, новости, вопросы-ответы, вики. Они появятся отдельной колонкой рядом с перепиской." className="ml-1" /></span>
									</span>
									<input type="checkbox" checked={sectionsEnabled} onChange={(e) => setSectionsEnabled(e.target.checked)} className="h-5 w-5 accent-violet-600 dark:accent-cyan-400 flex-shrink-0" />
								</label>
							)}
							{canEdit && (
								<label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-white/10 mb-3 cursor-pointer">
									<span>
										<span className="block text-sm font-medium text-neutral-900 dark:text-white">Обязательное принятие правил<InfoTooltip text="Новичок при первом входе увидит правила сообщества и не сможет ничего написать, пока не согласится с ними." className="ml-1" /></span>
									</span>
									<input type="checkbox" checked={requireRules} onChange={(e) => setRequireRules(e.target.checked)} className="h-5 w-5 accent-violet-600 dark:accent-cyan-400 flex-shrink-0" />
								</label>
							)}
							{/* NEW: пауза группы («скелетирование»). Переключать могут только
							    владелец и администратор; пока включена — все остальные видят
							    скелетон вместо сообщений и не могут ни листать, ни писать. */}
							{canManageWorkspace && (
								<label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/20 mb-3 cursor-pointer">
									<span>
										<span className="block text-sm font-medium text-neutral-900 dark:text-white">Пауза группы (скелетирование)</span>
										<span className="block text-xs text-neutral-500 dark:text-gray-400">Все, кроме создателя и администраторов, видят скелетон вместо контента: сообщения скрыты, писать и листать нельзя</span>
									</span>
									<input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="h-5 w-5 accent-amber-500 flex-shrink-0" />
								</label>
							)}
							{canEdit && (
								<Button onClick={handleSaveGeneral} loading={saving} size="sm">
									{saving ? "Сохранение..." : "Сохранить"}
								</Button>
							)}
						</Section>
						{/* GROUP-SKIN: баннер теперь только в «Дизайне». Два редактора одной и той же
						    шапки неизбежно расходились: в обзоре картинка, в дизайне градиент,
						    а кто победит — зависело от того, где сохранили позже. */}
						{canManageWorkspace && (
							<Section title="Баннер" info="Шапка сообщества настраивается в разделе «Дизайн».">
								<div className="flex flex-wrap items-center gap-3">
									<p className="text-sm text-neutral-500 dark:text-gray-400 flex-1 min-w-[200px]">
										Картинка, градиент, анимация и видео — всё в одном месте, рядом с фонами и шрифтами.
									</p>
									<Button size="sm" onClick={() => setSection("design")}>
										Открыть дизайн
									</Button>
								</div>
							</Section>
						)}
						<Section title="Информация">
							<div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
								<span className="text-neutral-500 dark:text-gray-400">Создатель</span>
								<span className="text-neutral-900 dark:text-white text-right">@{group.owner?.username}</span>
								<span className="text-neutral-500 dark:text-gray-400">Участников</span>
								<span className="text-neutral-900 dark:text-white text-right">{group.membersTotal ?? group.members.length}</span>
								<span className="text-neutral-500 dark:text-gray-400">Каналов</span>
								<span className="text-neutral-900 dark:text-white text-right">{group.channels.length}</span>
								<span className="text-neutral-500 dark:text-gray-400">Создана</span>
								<span className="text-neutral-900 dark:text-white text-right">{group.createdAt ? new Date(group.createdAt).toLocaleDateString("ru-RU") : "—"}</span>
							</div>
						</Section>
						{canModerate && (
							<Section title="Статистика">
								<StatsPanel groupId={group.id} />
							</Section>
						)}
					</>
				);
			case "rules":
				return (
					<Section title="Правила сообщества" info="Этот текст видят участники группы. Если рядом включено обязательное принятие, новичок сначала соглашается с правилами и только потом может писать.">
						<textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Напишите правила сообщества..." disabled={!canEdit} className={`${inputCls} resize-none h-48 mb-3`} />
						{canEdit && (
							<Button onClick={handleSaveRules} loading={saving} size="sm">
								{saving ? "Сохранение..." : "Сохранить правила"}
							</Button>
						)}
					</Section>
				);
			case "emoji":
				return (
					<Section title="Свои эмодзи" info="Загруженную картинку сервер сам превращает в эмодзи. В сообщении его набирают двоеточиями — вот так: «:имя:».">
						<EmojiPanel groupId={group.id} canManage={canManageWorkspace} />
					</Section>
				);
			case "censor": {
				if (censorLoading && !censorData) {
					return (
						<Section title="Цензура">
							<p className="text-sm text-neutral-500 dark:text-gray-400">Загрузка...</p>
						</Section>
					);
				}
				if (!censorData) {
					return (
						<Section title="Цензура">
							<p className="text-sm text-neutral-500 dark:text-gray-400">Не удалось загрузить данные цензуры.</p>
						</Section>
					);
				}
				if (!censorData.available) {
					return (
						<Section title="Цензура">
							<div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/20">
								<p className="text-sm text-neutral-700 dark:text-gray-300">
									Словарь цензуры доступен сообществам, у владельца которых есть Premium.
								</p>
							</div>
						</Section>
					);
				}
				const wordsByLevel = CENSOR_LEVELS.map((lvl) => ({
					level: lvl,
					words: censorData.words.filter((w) => w.level === lvl),
				})).filter((g) => g.words.length > 0);
				return (
					<>
						<Section
							title={`Словарь (${censorData.words.length} / ${censorData.limit})`}
							info="Слова проверяются подстрокой с учётом вариантов написания. Вносите корни, а не целые формы."
						>
							{censorError && (
								<p className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-sm">{censorError}</p>
							)}
							<div className="flex gap-2 mb-4">
								<input
									value={censorNewWord}
									onChange={(e) => setCensorNewWord(e.target.value)}
									onKeyDown={(e) => { if (e.key === "Enter") void handleCensorAdd(); }}
									placeholder="Слово или корень..."
									maxLength={CENSOR_WORD_MAX}
									className={`${inputCls} flex-1`}
								/>
								<select
									value={censorNewLevel}
									onChange={(e) => setCensorNewLevel(e.target.value as CensorLevel)}
									className="bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl px-2 py-2 text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-violet-400 dark:focus:border-cyan-400 flex-shrink-0"
									aria-label="Уровень"
								>
									{CENSOR_LEVELS.map((lvl) => (
										<option key={lvl} value={lvl}>{CENSOR_LEVEL_LABELS[lvl]}</option>
									))}
								</select>
								<Button size="sm" onClick={handleCensorAdd} loading={censorAdding} disabled={!censorNewWord.trim()}>
									Добавить
								</Button>
							</div>
							<div className="mb-1 flex gap-3 text-xs text-neutral-400 dark:text-gray-500 flex-wrap">
								{CENSOR_LEVELS.map((lvl) => (
									<span key={lvl} className="flex items-center gap-1">
										<span className="font-medium text-neutral-600 dark:text-gray-300">{CENSOR_LEVEL_LABELS[lvl]}</span>
										<InfoTooltip text={CENSOR_LEVEL_HINTS[lvl]} side="bottom" />
									</span>
								))}
							</div>
							{censorData.words.length === 0 ? (
								<p className="text-sm text-neutral-500 dark:text-gray-400 mt-3">Словарь пуст.</p>
							) : (
								<div className="space-y-4 mt-3">
									{wordsByLevel.map(({ level, words }) => (
										<div key={level}>
											<p className="text-xs font-semibold text-neutral-500 dark:text-gray-400 mb-1.5">
												{CENSOR_LEVEL_LABELS[level]}
											</p>
											<div className="flex flex-wrap gap-1.5">
												{words.map((w) => (
													<span
														key={w.id}
														className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
															level === "BLOCK"
																? "bg-red-500/10 text-red-600 dark:text-red-400"
																: level === "WARN"
																	? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
																	: "bg-neutral-500/10 text-neutral-600 dark:text-gray-300"
														}`}
													>
														{w.word}
														<button
															onClick={() => void handleCensorDelete(w.id)}
															className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
															aria-label={`Удалить ${w.word}`}
														>
															<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
														</button>
													</span>
												))}
											</div>
										</div>
									))}
								</div>
							)}
						</Section>
						<Section title="Счётчики" info="Участники, у которых срабатывал фильтр. Наблюдение — молчаливый учёт, цифры не обнуляются автоматически.">
							{censorData.counters.length === 0 ? (
								<p className="text-sm text-neutral-500 dark:text-gray-400">Пока нет срабатываний.</p>
							) : (
								<div className="space-y-1">
									{censorData.counters.map((c) => (
										<div key={c.userId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors">
											<GlowAvatar user={{ id: c.userId, name: c.userName, avatar: c.avatar, role: "USER" }} size={36} />
											<div className="min-w-0 flex-1">
												<span className="block text-sm font-medium text-neutral-900 dark:text-white truncate">{c.userName}</span>
												<span className="block text-xs text-neutral-500 dark:text-gray-400 truncate">
													@{c.username}
													{c.lastAt ? ` · ${new Date(c.lastAt).toLocaleDateString("ru-RU")}` : ""}
												</span>
											</div>
											<div className="flex items-center gap-2 flex-shrink-0 text-xs">
												<span className="font-semibold text-neutral-700 dark:text-gray-200">{c.total}</span>
												{CENSOR_LEVELS.filter((lvl) => (c.byLevel[lvl] ?? 0) > 0).map((lvl) => (
													<span
														key={lvl}
														className={`px-1.5 py-0.5 rounded-full font-medium ${
															lvl === "BLOCK"
																? "bg-red-500/10 text-red-600 dark:text-red-400"
																: lvl === "WARN"
																	? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
																	: "bg-neutral-500/10 text-neutral-600 dark:text-gray-300"
														}`}
														title={CENSOR_LEVEL_LABELS[lvl]}
													>
														{CENSOR_LEVEL_LABELS[lvl][0]}: {c.byLevel[lvl]}
													</span>
												))}
											</div>
										</div>
									))}
								</div>
							)}
						</Section>
					</>
				);
			}
			case "workspace":
				return (
					<Section title="Рабочая среда">
						<WorkspaceManager groupId={group.id} channels={group.channels} canManage={canManageWorkspace} onChanged={onUpdated} />
					</Section>
				);
			case "members":
				return (
					<Section title={`Участники (${memberTotal})`}>
						<input
							value={memberQuery}
							onChange={(e) => setMemberQuery(e.target.value)}
							placeholder="Поиск по имени или @юзернейму..."
							className={`${inputCls} mb-3`}
						/>
						<div className="space-y-1">
							{shownMembers.map((m) => {
								const targetRank = ROLE_RANK[m.role] ?? 0;
								const manageable = canManageRoles && targetRank < myRank;
								const kickable = canModerate && targetRank < myRank;
								return (
									<div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors">
										<GlowAvatar user={m.user} size={36} />
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-1.5">
												<span className="text-sm font-medium text-neutral-900 dark:text-white truncate">{m.user.name}</span>
												{m.role === "OWNER" && <span className="text-amber-500 flex-shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"><CrownIcon /></span>}
												{m.role === "ADMIN" && <span className="text-red-500 flex-shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"><ShieldIcon /></span>}
												{m.role === "MODERATOR" && <span className="text-violet-500 dark:text-cyan-400 flex-shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5"><ShieldIcon /></span>}
												{!!m.mutedUntil && new Date(m.mutedUntil) > new Date() && (
													<span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-500 flex-shrink-0" title={m.muteReason || undefined}>тайм-аут</span>
												)}
												{m.role === "GUIDE" && m.guidedUntil && new Date(m.guidedUntil) > new Date() && (
													<span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-teal-500/15 text-teal-500 flex-shrink-0"
														title={`Проводник до ${new Date(m.guidedUntil).toLocaleDateString("ru-RU")}`}>
														Проводник
													</span>
												)}
											</div>
											<p className="text-xs text-neutral-500 dark:text-gray-400 truncate">@{m.user.username}</p>
										</div>
										<span className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${ROLE_BADGE[m.role] ?? ROLE_BADGE.MEMBER}`}>
											{ROLE_LABEL[m.role] ?? m.role}
										</span>
										{manageable && (
											<select
												value={m.role}
												onChange={(e) => handleRoleChange(m.id, e.target.value)}
												className="text-[11px] bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-lg px-1.5 py-1 text-neutral-700 dark:text-gray-300 flex-shrink-0"
												aria-label={`Роль @${m.user.username}`}
											>
												<option value="MEMBER">Участник</option>
												<option value="GUIDE">Проводник (временная)</option>
												<option value="MODERATOR">Модератор</option>
												{isOwner && <option value="ADMIN">Админ</option>}
											</select>
										)}
										{kickable && (
											<div className="flex items-center gap-1 flex-shrink-0">
												<TimeoutButton groupId={group.id} memberId={m.id} mutedUntil={m.mutedUntil} onChanged={onUpdated} />
												<button onClick={() => handleBan(m)} className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" aria-label={`Забанить @${m.user.username}`} title="Забанить">
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93l14.14 14.14" /></svg>
												</button>
												<button onClick={() => handleKick(m)} className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" aria-label={`Исключить @${m.user.username}`} title="Исключить">
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
												</button>
											</div>
										)}
									</div>
								);
							})}
							{shownMembers.length === 0 && (
								<p className="text-sm text-neutral-500 dark:text-gray-400 px-3 py-4">
									{membersBusy ? "Загрузка..." : "Никого не найдено"}
								</p>
							)}
							{shownMembers.length < memberTotal && (
								<button
									type="button"
									onClick={loadMoreMembers}
									disabled={membersBusy}
									className="w-full px-3 py-2.5 rounded-xl text-sm text-neutral-500 dark:text-gray-400 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
								>
									{membersBusy ? "Загрузка..." : "Показать ещё"}
								</button>
							)}
						</div>
					</Section>
				);
			case "roles":
				return (
					<>
						<Section title="Системные роли" info="Встроенные роли группы: именно они решают, что участнику можно, а что нет. Ниже расписано, кто на что имеет право.">
							<div className="space-y-2">
								{[
									{ role: "OWNER", desc: "Полный доступ: назначение админов, передача и удаление группы." },
									{ role: "ADMIN", desc: "Настройки группы, рабочая среда, управление модераторами и участниками, баны." },
									{ role: "MODERATOR", desc: "Редактирование описания и правил, исключение и бан участников, приглашения, пург сообщений." },
									{ role: "GUIDE", desc: "Промежуточная роль на время (в днях). Может кикать и банить обычных участников, но не модераторов и выше. Укажите срок при назначении." },
									{ role: "MEMBER", desc: "Общение в каналах группы." },
								].map((r) => (
									<div key={r.role} className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-white/10">
										<span className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${ROLE_BADGE[r.role] ?? ROLE_BADGE.MEMBER}`}>{ROLE_LABEL[r.role] ?? r.role}</span>
										<p className="text-xs text-neutral-600 dark:text-gray-400">{r.desc}</p>
									</div>
								))}
							</div>
						</Section>
						<Section title="Роли-теги">
							<RoleManager
								groupId={group.id}
								canManage={canManageRoles}
								members={(allMembers ?? []).map((m) => ({ userId: m.user.id, name: m.user.name || m.user.username || "—", roleIds: (m.tags ?? []).map((t) => t.role?.id ?? "").filter(Boolean) }))}
							/>
						</Section>
						<Section title="Роли-возможности">
							<ChannelRoleManager
								groupId={group.id}
								canManage={canManageRoles}
								channels={group.channels.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
							/>
						</Section>
					</>
				);
			case "bans":
				return (
					<>
						{/* Форма бана */}
						<Section title="Забанить пользователя">
							<div className="space-y-3">
								<div>
									<label className="text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1 block">@ник пользователя</label>
									<input
										value={banUsername}
										onChange={(e) => setBanUsername(e.target.value)}
										placeholder="@username"
										className={inputCls}
									/>
								</div>
								<div>
									<label className="text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1 block">Причина</label>
									<div className="flex flex-wrap gap-2">
										{(["AD", "SPAM", "FRAUD", "CUSTOM"] as const).map((p) => (
											<button
												key={p}
												onClick={() => setBanReasonPreset(p)}
												className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
													banReasonPreset === p
														? "bg-red-500 text-white"
														: "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-200 dark:hover:bg-white/15"
												}`}
											>
												{{ AD: "Реклама", SPAM: "Спам", FRAUD: "Мошенничество", CUSTOM: "Своя причина" }[p]}
											</button>
										))}
									</div>
									{banReasonPreset === "CUSTOM" && (
										<input
											value={banReasonCustom}
											onChange={(e) => setBanReasonCustom(e.target.value)}
											placeholder="Укажите причину"
											className={`${inputCls} mt-2`}
											maxLength={300}
										/>
									)}
								</div>
								<div>
									<label className="text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1 block">Режим бана</label>
									<div className="flex gap-2">
										<button
											onClick={() => setBanMode("ban_only")}
											className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
												banMode === "ban_only"
													? "bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400"
													: "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5"
											}`}
										>
											Только бан
										</button>
										<button
											onClick={() => setBanMode("ban_and_purge")}
											className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
												banMode === "ban_and_purge"
													? "bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400"
													: "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5"
											}`}
										>
											Бан + удалить все сообщения
										</button>
									</div>
								</div>
								{banFormError && <p className="text-xs text-red-500">{banFormError}</p>}
								<Button
									variant="danger"
									size="sm"
									onClick={handleBanByUsername}
									disabled={banFormLoading}
									className="w-full"
								>
									{banFormLoading ? "Баним..." : "Забанить"}
								</Button>
							</div>
						</Section>
						{/* Список забаненных */}
						<Section title="Список забаненных">
							{bans === null ? (
								<p className="text-sm text-neutral-500 dark:text-gray-400">Загрузка...</p>
							) : bans.length === 0 ? (
								<p className="text-sm text-neutral-500 dark:text-gray-400">Никто не забанен.</p>
							) : (
								<div className="space-y-1">
									{bans.map((b) => (
										<div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors">
											<GlowAvatar user={b.user} size={36} />
											<div className="min-w-0 flex-1">
												<span className="block text-sm font-medium text-neutral-900 dark:text-white truncate">{b.user.name}</span>
												<span className="block text-xs text-neutral-500 dark:text-gray-400 truncate">
													@{b.user.username} &middot; {new Date(b.createdAt).toLocaleDateString("ru-RU")} &middot; бан от @{b.bannedBy.username}
													{b.reason ? ` · ${b.reason}` : ""}
												</span>
											</div>
											<button onClick={() => handleUnban(b)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors flex-shrink-0">
												Разбанить
											</button>
										</div>
									))}
								</div>
							)}
						</Section>
					</>
				);
			case "invites":
				return (
					<Section title="Приглашения" info="Сделайте ссылку с нужным сроком жизни и лимитом вступлений, а ненужную в любой момент отзовите — она перестанет работать.">
						<InvitesPanel groupId={group.id} />
					</Section>
				);
			case "reports":
				return (
					<Section title="Жалобы" info="Сюда попадает то, на что пожаловались участники. Игнор человек ставит себе сам и молча, а жалобой он зовёт вас разобраться. Здесь очередь только закрывается — наказать нарушителя можно в самом чате, правым кликом по участнику.">
						<ReportsPanel groupId={group.id} />
					</Section>
				);
			case "audit":
				return (
					<Section title="Журнал действий" info="История того, что делала модерация: баны, исключения, выданные роли, созданные и отозванные приглашения.">
						<AuditPanel groupId={group.id} />
					</Section>
				);
			case "danger":
				return (
					<>
						<Section title="Передача группы" subtitle="Новый владелец станет создателем, вы останетесь админом">
							<div className="flex gap-2">
								<select value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)} className={inputCls} aria-label="Новый владелец">
									<option value="">Выберите участника...</option>
									{(allMembers ?? []).filter((m) => m.role !== "OWNER").map((m) => (
										<option key={m.id} value={m.id}>
											{m.user.name} (@{m.user.username})
										</option>
									))}
								</select>
								<Button variant="secondary" size="sm" onClick={handleTransfer} disabled={!transferTarget}>
									Передать
								</Button>
							</div>
						</Section>
						<Section title="Удаление группы" subtitle="Группа, все каналы и сообщения будут удалены безвозвратно">
							<Button
								onClick={() =>
									setConfirm({
										message: `Удалить группу «${group.name}»? Это действие необратимо.`,
										confirmLabel: "Удалить",
										onConfirm: () => {
											setConfirm(null);
											onDelete();
										},
									})
								}
								variant="danger"
								size="md"
							>
								Удалить группу
							</Button>
						</Section>
					</>
				);
		}
	};

	return (
		<div className="fixed inset-0 z-[92] flex bg-neutral-100 dark:bg-neutral-950"> {/* FIX-SHAREZ: выше окна демонстрации экрана (z-76/77) */}
			{/* ─── Sidebar (grouped navigation, like /settings) ─── */}
			<aside className="hidden md:flex w-64 flex-col border-r border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 overflow-y-auto">
				<div className="flex items-center gap-3 mb-6 px-1">
					<div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
						{group.icon && group.icon.startsWith("/") ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={group.icon} alt="" className="w-full h-full object-cover" />
						) : (
							<span className="w-full h-full flex items-center justify-center text-base font-bold bg-gradient-to-br from-violet-500 to-indigo-500 dark:from-cyan-500 dark:to-blue-500 text-white">{group.name.slice(0, 1).toUpperCase()}</span>
						)}
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-neutral-900 dark:text-white truncate">{group.name}</p>
						<p className="text-xs text-neutral-500 dark:text-gray-400">Настройки группы</p>
					</div>
				</div>
				{NAV.map((g) => (
					<div key={g.group} className="mb-4">
						<p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-gray-500">{g.group}</p>
						<div className="space-y-0.5">
							{g.items.map((item) => (
								<button
									key={item.id}
									onClick={() => setSection(item.id)}
									className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-left ${
										section === item.id
											? "bg-neutral-200/70 dark:bg-white/10 text-neutral-900 dark:text-white"
											: item.danger
												? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
												: "text-neutral-600 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-gray-200"
									}`}
								>
									{item.icon}
									<span>{item.label}</span>
								</button>
							))}
						</div>
					</div>
				))}
			</aside>

			{/* ─── Content ─── */}
			<div className="flex-1 overflow-y-auto">
				<div className="max-w-3xl mx-auto p-4 md:p-8">
					<div className="flex items-center justify-between mb-6">
						<div>
							<h2 className="text-xl font-bold text-neutral-900 dark:text-white">{SECTION_TITLE[section]}</h2>
							<p className="text-xs text-neutral-500 dark:text-gray-400">{group.name}</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								onClick={onClose}
								className="w-9 h-9 rounded-full border border-neutral-300 dark:border-white/15 flex items-center justify-center text-neutral-500 dark:text-gray-400 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors"
								aria-label="Закрыть настройки"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
							</button>
							<span className="hidden md:inline text-[10px] font-medium text-neutral-400 dark:text-gray-500 border border-neutral-300 dark:border-white/15 rounded px-1.5 py-0.5">ESC</span>
						</div>
					</div>

					{/* Mobile section switcher */}
					<div className="flex md:hidden gap-1.5 overflow-x-auto pb-3 mb-3 -mx-1 px-1">
						{NAV.flatMap((g) => g.items).map((item) => (
							<button
								key={item.id}
								onClick={() => setSection(item.id)}
								className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
									section === item.id
										? "bg-violet-600 text-white dark:bg-cyan-500 dark:text-neutral-900"
										: "bg-white dark:bg-neutral-800 text-neutral-600 dark:text-gray-400 border border-neutral-200 dark:border-white/10"
								}`}
							>
								{item.label}
							</button>
						))}
					</div>

					{error && <p className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-sm">{error}</p>}
					{notice && <p className="mb-3 px-3 py-2 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 text-sm">{notice}</p>}

					{renderSection()}
				</div>
			</div>

			{/* ─── Confirm dialog ─── */}
			{confirm && (
				<div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(null)}>
					<div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
						<p className="text-sm text-neutral-800 dark:text-gray-200 mb-4">{confirm.message}</p>
						{confirm.withReason && (
							<input
								value={confirmReason}
								onChange={(e) => setConfirmReason(e.target.value)}
								placeholder="Причина (необязательно)"
								maxLength={300}
								className={`${inputCls} mb-3`}
							/>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>Отмена</Button>
							<Button variant="danger" size="sm" onClick={() => confirm.onConfirm(confirmReason)}>{confirm.confirmLabel}</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
