/**
 * FIX-KEEP-CONTENT: удаление аккаунта как обезличивание.
 *
 * Зачем не `prisma.user.delete()`. Почти все связи пользователя объявлены с
 * `onDelete: Cascade` — и это верно для того, что относится только к нему
 * самому (сессии, устройства, дружбы). Но под тот же каскад попадало и всё,
 * что человек создал в СООБЩЕСТВАХ: сообщения, каналы, новости, задачи,
 * статьи, опросы. Удаление одного участника вычищало часть общей работы, и
 * восстановить её было нельзя.
 *
 * Материал принадлежит сообществу, а имя — человеку. Поэтому строка
 * пользователя остаётся жить, но теряет всё личное: имя становится
 * «Удалённый пользователь», почта и логин — техническими, пароль
 * заменяется случайным, а вход закрывается признаком `isDeleted`
 * (проверяется в `lib/auth.ts`). Ссылки на автора при этом целы: и в чате, и
 * в задачах вместо имени видно «Удалённый пользователь».
 *
 * Членство в сообществах снимается: человек ушёл, в списке участников его
 * быть не должно. Его каналы и сообщения остаются — они привязаны к группе и
 * каналу, а не к членству.
 */

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

/** Подпись вместо имени у обезличенного аккаунта. */
export const DELETED_USER_NAME = "Удалённый пользователь";

/**
 * Имя для показа. Берёт имя, а если его нет (или аккаунт обезличен) —
 * подставляет «Удалённый пользователь» вместо пустого места.
 */
export function displayUserName(
	user?: { name?: string | null; isDeleted?: boolean | null } | null,
): string {
	if (!user || user.isDeleted) return DELETED_USER_NAME;
	return user.name?.trim() || DELETED_USER_NAME;
}

/**
 * Обезличить аккаунт, сохранив всё, что человек создал в сообществах.
 *
 * Одной транзакцией: половинчатое состояние (имя стёрли, сессии остались)
 * означало бы живой доступ к аккаунту без владельца.
 */
export async function anonymizeUser(userId: string): Promise<void> {
	const suffix = randomBytes(4).toString("hex");
	/* Пароль не обнуляем, а заменяем случайным: пустое поле сравнивалось бы
	   bcrypt-ом при каждой попытке входа под старым логином. */
	const lockedPassword = await bcrypt.hash(
		`deleted-${userId}-${randomBytes(24).toString("hex")}`,
		10,
	);

	await prisma.$transaction(async (tx) => {
		await tx.user.update({
			where: { id: userId },
			data: {
				name: DELETED_USER_NAME,
				username: `deleted_${suffix}`,
				email: `deleted+${userId}@deleted.local`,
				password: lockedPassword,
				emailVerified: false,
				avatar: null,
				profileBanner: null,
				bio: null,
				socialLinks: null,
				customStatus: null,
				statusEmoji: null,
				activityStatus: null,
				activityEnabled: false,
				city: null,
				isPremium: false,
				banned: true,
				banReason: "Аккаунт удалён владельцем",
				isDeleted: true,
				deletedAt: new Date(),
				/* Эта отметка обесценивает все ранее выданные токены сессии
				   (см. FIX-SEC в lib/auth.ts): выход происходит сразу, на всех
				   устройствах, без ожидания истечения cookie. */
				passwordChangedAt: new Date(),
			},
		});

		/* Личное — удаляем. Это принадлежит только самому человеку и ни на чью
		   работу в сообществах не влияет. */
		await tx.userSession.deleteMany({ where: { userId } });
		await tx.pushDevice.deleteMany({ where: { userId } });
		await tx.friendship.deleteMany({
			where: { OR: [{ senderId: userId }, { receiverId: userId }] },
		});

		/* Членство в сообществах снимается — человек ушёл. Созданные им каналы,
		   новости, задачи и сообщения остаются: они привязаны к группе и каналу. */
		await tx.groupMember.deleteMany({ where: { userId } });
	});
}
