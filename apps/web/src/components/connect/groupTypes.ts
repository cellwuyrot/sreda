export interface Group {
	id: string;
	name: string;
	icon: string | null;
	description: string;
	ownerId: string;
	isMain?: boolean;
	sectionsEnabled?: boolean;
	/** NEW: баннер сообщества (data URL, как User.profileBanner) */
	banner?: string | null;
	/** NEW: обязательное принятие правил перед общением */
	requireRules?: boolean;
	/** NEW: пауза группы («скелетирование»): контент виден только OWNER/ADMIN */
	paused?: boolean;
	/** GROUP-SKIN: оформление сообщества (JSON, см. lib/groupTheme.ts) */
	theme?: string | null;
	_count: { members: number; channels: number };
}

export interface Channel {
	id: string;
	name: string;
	type: string;
	icon: string | null;
	groupId: string;
	serviceId?: string | null;
	parentId?: string | null;
	channelGroupType?: string | null;
	postAccess?: string;
	hidden?: boolean;
	sortOrder?: number;
	_count: { members: number; messages: number };
}

export interface GroupMember {
	id: string;
	role: string;
	/** NEW: активный тайм-аут (ISO-строка) и его причина */
	mutedUntil?: string | null;
	muteReason?: string | null;
	/** Проводник: дата истечения роли (ISO-строка) */
	guidedUntil?: string | null;
	user: { id: string; name: string; username: string; avatar: string | null; role: string; lastSeen?: string | null; avatarGlowEnabled?: boolean; avatarGlowColors?: string | null; profileBanner?: string | null };
	tags?: { role: { id: string; name: string; color: string } }[];
}

export interface GroupDetail extends Group {
	myRole: string;
	rules: string;
	rulesAccepted: boolean;
	createdAt: string;
	owner: { id: string; name: string; username: string; isPremium?: boolean };
	channels: Channel[];
	/** Первая страница участников: снимок сообщества больше не тянет весь список. */
	members: GroupMember[];
	/** Сколько участников всего — для счётчиков и признака «есть что догрузить». */
	membersTotal?: number;
	/** FIX-PREMIUM-EXPIRED: вычислено сервером через hasPremium(owner). */
	ownerHasPremium?: boolean;
	invites?: { code: string; uses: number; maxUses: number; expiresAt: string | null }[];
}
