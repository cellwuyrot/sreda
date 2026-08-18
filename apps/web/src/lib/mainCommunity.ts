import prisma from "@/lib/prisma";

let ensurePromise: Promise<void> | null = null;

/**
 * Find the main community group.
 */
export async function getMainCommunity() {
  return prisma.group.findFirst({ where: { isMain: true } });
}

/**
 * Ensure the main community exists. Auto-creates it on first call
 * using the first ADMIN user as owner. Safe to call from any context.
 */
export async function ensureMainCommunity() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    try {
      const existing = await getMainCommunity();
      if (existing) return;

      const admin = await prisma.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      if (!admin) return;

      await setupMainCommunity(admin.id, "TZ Connect");
    } catch {
      // Ignore — concurrent creation race or DB issue
    } finally {
      ensurePromise = null;
    }
  })();
  return ensurePromise;
}

/**
 * Auto-join a user to the main community.
 * Admins join as OWNER, others as MEMBER.
 * No-op if already a member or no main community exists.
 */
export async function autoJoinMainCommunity(userId: string) {
  const main = await getMainCommunity();
  if (!main) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return;

  const memberRole = user.role === "ADMIN" ? "OWNER" : "MEMBER";

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: main.id } },
  });

  if (existing) {
    if (user.role === "ADMIN" && existing.role !== "OWNER") {
      await prisma.groupMember.update({
        where: { id: existing.id },
        data: { role: "OWNER" },
      });
    }
    return;
  }

  await prisma.groupMember.create({
    data: { userId, groupId: main.id, role: memberRole, rulesAccepted: true },
  });
}

/**
 * Sync services from the admin list into the main community channels so the
 * group's «Разделы» panel is a faithful mirror of the admin «Управление
 * услугами» list — same titles, icons, order and visibility.
 *
 * For each service we keep exactly three linked channels:
 *  - 1 NEWS channel: "{service.title}"                — the section header/feed
 *  - 1 TEXT channel: "{service.title} — Обсуждение"
 *  - 1 TEXT channel: "{service.title} — Вопросы"
 *
 * The function is *authoritative* and self-healing: on every run it renames,
 * re-icons, re-orders and re-restricts the channels to match the current
 * service, recreates any that went missing, and deletes stray/duplicate or
 * orphaned (deleted-service) channels. That way renaming or reordering a
 * service in the admin panel is immediately reflected in the community.
 *
 * Ordering: channels are given a `sortOrder` derived from the service order
 * (base = (index+1)*10) so the sections line up with the admin list; the two
 * discussion channels follow their NEWS header (base+1, base+2).
 *
 * Inactive services keep their channels but `isRestricted = true`, hiding them
 * from regular members while admins/moderators still see them.
 */
const DISCUSSION_SUFFIX = " \u2014 \u041E\u0431\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0435"; // " — Обсуждение"
const QUESTIONS_SUFFIX = " \u2014 \u0412\u043E\u043F\u0440\u043E\u0441\u044B"; // " — Вопросы"
const NEWS_ICON = "\uD83D\uDCF0"; // 📰
const DISCUSSION_ICON = "\uD83D\uDCAC"; // 💬
const QUESTIONS_ICON = "\u2753"; // ❓

/**
 * Имя и значок канала обращений. Имя переименовать можно — сверка ищет канал по
 * ТИПУ, а не по названию, иначе переименование заводило бы второй канал.
 */
const APPEALS_CHANNEL_NAME = "Обращения";
const APPEALS_CHANNEL_ICON = "support";

/**
 * Убедиться, что в главном сообществе есть канал обращений.
 *
 * Зачем отдельная сверка, а не только набор при создании: сообщество на рабочих
 * установках уже создано, и `ensureMainCommunity` при существующем сообществе
 * сразу возвращается, ничего не досоздавая. Без этой функции правка помогла бы
 * только новым установкам, а на существующих отправка обращений продолжала бы
 * отвечать «раздел не настроен».
 *
 * Ищем по всей установке, а не только в главном сообществе: приём обращений
 * (api/appeals) точно так же берёт первый канал типа APPEALS в любом
 * сообществе, поэтому если такой канал уже где-то есть — второй не нужен.
 */
export async function ensureAppealsChannel(): Promise<void> {
  try {
    const existing = await prisma.channel.findFirst({ where: { type: "APPEALS" }, select: { id: true } });
    if (existing) return;
    const main = await getMainCommunity();
    if (!main) return;
    await prisma.channel.create({
      data: {
        name: APPEALS_CHANNEL_NAME,
        type: "APPEALS",
        icon: APPEALS_CHANNEL_ICON,
        groupId: main.id,
        sortOrder: 20,
      },
    });
    console.log("[main] создан канал обращений в главном сообществе");
  } catch (err) {
    // Гонка двух одновременных вызовов или недоступная база: приём обращений
    // сам скажет, что раздел не настроен, а сверка повторится при следующем
    // обращении к сообществу.
    console.warn("[main] не удалось создать канал обращений:", err);
  }
}

export async function syncServicesToMainCommunity() {
  const main = await getMainCommunity();
  if (!main) return;

  const services = await prisma.service.findMany({ orderBy: [{ order: "asc" }, { title: "asc" }] });
  const serviceIds = new Set(services.map((s) => s.id));

  // Get all service-linked channels in the main community
  const existingChannels = await prisma.channel.findMany({
    where: { groupId: main.id, serviceId: { not: null } },
  });
  type ExistingChannel = (typeof existingChannels)[number];

  // Group existing channels by serviceId; anything whose service no longer
  // exists is queued for deletion.
  const channelsByService = new Map<string, ExistingChannel[]>();
  const toDelete: string[] = [];
  for (const ch of existingChannels) {
    if (!ch.serviceId || !serviceIds.has(ch.serviceId)) {
      toDelete.push(ch.id);
      continue;
    }
    const arr = channelsByService.get(ch.serviceId) ?? [];
    arr.push(ch);
    channelsByService.set(ch.serviceId, arr);
  }

  // Reconcile each service against its (up to three) expected channels.
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    const base = (i + 1) * 10;
    const restricted = !service.active;
    const existing = channelsByService.get(service.id) ?? [];

    // Match the three roles regardless of the current (possibly stale) title.
    // The discussion/questions suffixes are stable, so they still match after
    // a rename; the NEWS channel is matched purely by type.
    const news = existing.find((c) => c.type === "NEWS");
    const questions = existing.find((c) => c !== news && c.name.endsWith("\u0412\u043E\u043F\u0440\u043E\u0441\u044B"));
    const discussion = existing.find((c) => c !== news && c !== questions);
    // Any leftover channels (duplicates / legacy) are removed.
    for (const c of existing) {
      if (c !== news && c !== questions && c !== discussion) toDelete.push(c.id);
    }

    const desired: Array<{
      role: ExistingChannel | undefined;
      name: string;
      type: string;
      icon: string;
      sortOrder: number;
    }> = [
      { role: news, name: service.title, type: "NEWS", icon: service.icon || NEWS_ICON, sortOrder: base },
      { role: discussion, name: `${service.title}${DISCUSSION_SUFFIX}`, type: "TEXT", icon: DISCUSSION_ICON, sortOrder: base + 1 },
      { role: questions, name: `${service.title}${QUESTIONS_SUFFIX}`, type: "TEXT", icon: QUESTIONS_ICON, sortOrder: base + 2 },
    ];

    for (const d of desired) {
      if (!d.role) {
        await prisma.channel.create({
          data: {
            name: d.name,
            type: d.type,
            icon: d.icon,
            groupId: main.id,
            serviceId: service.id,
            isRestricted: restricted,
            // FIX-SRVHIDE: выключенная в админке услуга убирается из блочной
            // структуры целиком. Одного isRestricted не хватало: канал без
            // выданных ролей проходит проверку доступа как открытый
            // (см. app/api/groups/[id]/route.ts) и продолжал висеть у всех.
            hidden: restricted,
            sortOrder: d.sortOrder,
          },
        });
        continue;
      }
      // Only write when something actually drifted.
      if (
        d.role.name !== d.name ||
        d.role.icon !== d.icon ||
        d.role.type !== d.type ||
        d.role.isRestricted !== restricted ||
        d.role.hidden !== restricted ||
        d.role.sortOrder !== d.sortOrder
      ) {
        await prisma.channel.update({
          where: { id: d.role.id },
          data: { name: d.name, icon: d.icon, type: d.type, isRestricted: restricted, hidden: restricted, sortOrder: d.sortOrder },
        });
      }
    }
  }

  if (toDelete.length > 0) {
    await prisma.channel.deleteMany({ where: { id: { in: toDelete } } });
  }
}

/**
 * Set up (or return existing) the main community group.
 * Creates the group with default channels + 4 voice channels.
 * Adds all existing users as members.
 */
export async function setupMainCommunity(ownerId: string, name: string) {
  const existing = await getMainCommunity();
  if (existing) return existing;

  const group = await prisma.group.create({
    data: {
      name,
      isMain: true,
      description: "\u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E TZ Connect",
      ownerId,
      members: {
        create: { userId: ownerId, role: "OWNER", rulesAccepted: true },
      },
      channels: {
        create: [
          { name: "\u041E\u0431\u0449\u0438\u0439", type: "TEXT", icon: "\uD83D\uDCAC" },
          { name: "\u041E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u044F", type: "NEWS", icon: "\uD83D\uDCE2" },
          { name: APPEALS_CHANNEL_NAME, type: "APPEALS", icon: APPEALS_CHANNEL_ICON },
          { name: "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 1", type: "VOICE", icon: "\uD83C\uDF99\uFE0F" },
          { name: "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 2", type: "VOICE", icon: "\uD83C\uDF99\uFE0F" },
          { name: "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 3", type: "VOICE", icon: "\uD83C\uDF99\uFE0F" },
          { name: "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 4", type: "VOICE", icon: "\uD83C\uDF99\uFE0F" },
        ],
      },
    },
    include: { channels: true },
  });

  // Add all existing users as members (admins as OWNER)
  const users = await prisma.user.findMany({
    where: { id: { not: ownerId } },
    select: { id: true, role: true },
  });

  if (users.length > 0) {
    await prisma.groupMember.createMany({
      data: users.map((u) => ({
        userId: u.id,
        groupId: group.id,
        role: u.role === "ADMIN" ? "OWNER" : "MEMBER",
        rulesAccepted: true,
      })),
      skipDuplicates: true,
    });
  }

  // Sync service channels
  await syncServicesToMainCommunity();
  await ensureAppealsChannel();

  return group;
}
