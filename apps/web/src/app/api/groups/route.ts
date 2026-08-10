import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { ensureMainCommunity, autoJoinMainCommunity, syncServicesToMainCommunity } from "@/lib/mainCommunity";
import { emitToUser } from "@/lib/socketEmit";
import { getCommunityTemplate } from "@/lib/communityTemplates";
import { FREE_COMMUNITY_LIMIT } from "@/lib/premiumFeatures";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json([]);
  }

  try {
    // Auto-create main community if it doesn't exist yet
    await ensureMainCommunity();
    // Auto-join current user to main community if not already a member
    await autoJoinMainCommunity(session.user.id);
    // Keep the community's «Разделы» in lockstep with the admin service list.
    // The sync is idempotent and only writes when something drifted, so this
    // self-heals stale titles/order even without an admin action.
    await syncServicesToMainCommunity().catch(() => {});

    const memberships = await prisma.groupMember.findMany({
      where: { userId: session.user.id },
      select: {
        sortOrder: true,
        group: {
          include: {
            _count: { select: { members: true, channels: true } },
            owner: { select: { id: true, name: true, username: true } },
          },
        },
      },
    });

    const groups = memberships
      .map((m) => ({ ...m.group, sortOrder: m.sortOrder }))
      .sort((a, b) => {
        if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    return NextResponse.json(groups);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "groups", { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { name, icon, description, templateId = "blank" } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  if (name.trim().length > 100) {
    return NextResponse.json({ error: "Имя группы слишком длинное (макс. 100 символов)" }, { status: 400 });
  }
  if (description && description.length > 1000) {
    return NextResponse.json({ error: "Описание слишком длинное (макс. 1000 символов)" }, { status: 400 });
  }

  const template = getCommunityTemplate(templateId);
  if (!template) return NextResponse.json({ error: "Неизвестный шаблон сообщества" }, { status: 400 });

  const creator = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isPremium: true, role: true },
  });
  const canBypassLimits = !!creator?.isPremium || creator?.role === "ADMIN";

  // Премиум-шаблоны доступны только Premium/ADMIN — как и раньше.
  if (template.premium && !canBypassLimits) {
    return NextResponse.json({ error: "Шаблоны сообществ доступны только Premium-пользователям" }, { status: 403 });
  }

  // FREE-COMMUNITY-LIMIT: обычный аккаунт может владеть не более чем
  // FREE_COMMUNITY_LIMIT своими сообществами (основное сообщество не считаем —
  // оно общее и создаётся автоматически). Premium и ADMIN — без ограничений.
  // Проверка на сервере, поэтому лимит нельзя обойти прямым запросом к API.
  if (!canBypassLimits) {
    const ownedCount = await prisma.group.count({
      where: { ownerId: session.user.id, isMain: false },
    });
    if (ownedCount >= FREE_COMMUNITY_LIMIT) {
      return NextResponse.json(
        { error: `Обычный аккаунт может создать не более ${FREE_COMMUNITY_LIMIT} своих сообществ. Оформите Premium, чтобы снять ограничение.` },
        { status: 403 },
      );
    }
  }

  const group = await prisma.group.create({
    data: {
      name: name.trim(),
      icon: icon || null,
      description: description || "",
      ownerId: session.user.id,
      /* SECTIONS-RESET: новая группа НИКОГДА не создаётся в блочном режиме.
         Раньше здесь стояло `template.channels.some((c) => c.section)`, а в
         каждом премиум-шаблоне каналы были помечены `section: true` — то есть
         любая группа по шаблону получала sectionsEnabled = true. Дальше connect
         рисовал её как ГЛАВНОЕ сообщество TZ Connect: блочный интерфейс
         разделов вместо обычного списка каналов, а панель «Разделы — рабочие
         модули группы» не появлялась вообще. Владелец при этом ничего такого не
         выбирал: он выбрал набор каналов, а получил другой интерфейс.
         Блочный режим — осознанное решение владельца: переключатель «Разделы» в
         настройках группы (PUT /api/groups/[id], доступен premium-владельцу).
         Побочным эффектом выбора шаблона он быть не должен. */
      sectionsEnabled: false,
      members: {
        create: { userId: session.user.id, role: "OWNER", rulesAccepted: true },
      },
      channels: {
        create: template.channels,
      },
    },
    include: {
      _count: { select: { members: true, channels: true } },
      channels: true,
    },
  });

  // Tell the creator's other open sessions (e.g. desktop + web at once) to
  // refresh their group list so the new group and its icon appear without a
  // manual reload.
  emitToUser(session.user.id, "group-updated", { id: group.id });

  return NextResponse.json(group);
}
