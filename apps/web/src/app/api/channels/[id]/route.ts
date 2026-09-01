import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getIO } from "@/lib/socketEmit";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { checkBan } from "@/lib/banCheck";
import { isChannelType } from "@/lib/channelModules";

async function checkChannelAdmin(userId: string, channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return null;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: channel.groupId } },
  });

  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN" && membership.role !== "MODERATOR")) {
    return null;
  }

  return channel;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // FIX-SEC-IDOR: раньше любой вошедший мог прочитать полный конфиг канала
  // (правила ограничений, hidden, ACL ролей) по прямому ID. Теперь — только
  // участник, которому канал реально виден.
  const perm = await getChannelPermissions(session.user.id, id);
  if (!perm) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!perm.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      allowedRoles: { select: { roleId: true, scope: true } },
    },
  });
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // FIX-QAACL: списки тегов разложены по назначению. roleIds сохраняет прежний
  // смысл (кто видит закрытый раздел), askRoleIds/answerRoleIds — новые.
  const inScope = (scope: string) =>
    channel.allowedRoles.filter((ar) => ar.scope === scope).map((ar) => ar.roleId);

  return NextResponse.json({
    ...channel,
    roleIds: inScope("VIEW"),
    askRoleIds: inScope("ASK"),
    answerRoleIds: inScope("ANSWER"),
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать редактировать настройки каналов.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const channel = await checkChannelAdmin(session.user.id, id);
  if (!channel) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    name, icon, type, isRestricted, roleIds, parentId, slowmode, postAccess, readAccess,
    hidden, sortOrder, channelGroupType,
    askAccess, answerAccess, askRoleIds, answerRoleIds, // FIX-QAACL
    noRecord, voiceLimit, // FIX-GROUPSETTINGS: голосовые настройки
    propagateToChildren, // FIX-GROUPSETTINGS: применить настройки ко всем каналам в группе
  } = await req.json();
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (icon !== undefined) data.icon = icon;
  // Whitelist — общий с созданием канала (lib/channelModules.ts). В своей копии
  // здесь не хватало COMMUNITY: смена типа на «Общественность» молча не
  // применялась — тип не проходил проверку, и поле просто не попадало в data.
  if (type !== undefined && isChannelType(type)) data.type = type;
  if (postAccess !== undefined && ["ALL", "MOD", "ADMIN"].includes(postAccess)) data.postAccess = postAccess;
  // FIX-NEWSACL: право читать канал (новости и прочие) — ALL / MOD / ADMIN.
  // Проверяется сервером в getChannelPermissions, поэтому ограничение нельзя
  // обойти прямым запросом к API или подпиской на Socket.IO.
  if (readAccess !== undefined && ["ALL", "MOD", "ADMIN"].includes(readAccess)) data.readAccess = readAccess;
  // FIX-QAACL: кто задаёт вопросы и кто отвечает в разделе «Вопросы-ответы».
  // ROLES — по тегам участника (списки приходят в askRoleIds/answerRoleIds).
  if (askAccess !== undefined && ["ALL", "MOD", "ADMIN", "ROLES"].includes(askAccess)) data.askAccess = askAccess;
  if (answerAccess !== undefined && ["ALL", "MOD", "ADMIN", "ROLES"].includes(answerAccess)) data.answerAccess = answerAccess;
  if (isRestricted !== undefined) data.isRestricted = isRestricted;
  if (parentId !== undefined) data.parentId = parentId || null;
  if (channelGroupType !== undefined) data.channelGroupType = channelGroupType === "VOICE" ? "VOICE" : channelGroupType === null ? null : "TEXT";
  if (slowmode !== undefined) data.slowmode = Math.max(0, Math.min(Number(slowmode) || 0, 3600));
  if (hidden !== undefined) data.hidden = !!hidden;
  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) data.sortOrder = Math.trunc(Number(sortOrder));
  // FIX-GROUPSETTINGS: управление записью и лимитом голосового канала
  if (noRecord !== undefined) data.noRecord = !!noRecord;
  if (voiceLimit !== undefined) {
    data.voiceLimit = (typeof voiceLimit === "number" && voiceLimit > 0) ? voiceLimit : null;
  }

  const updated = await prisma.channel.update({
    where: { id },
    data,
  });

  // FIX-QAACL: каждый список тегов перезаписывается независимо — раньше
  // deleteMany без scope стирал бы и права на вопросы/ответы.
  const replaceRoles = async (scope: string, ids: unknown) => {
    if (!Array.isArray(ids)) return;
    // Явное приведение к unknown[] перед фильтром: тип-предикат тогда даёт
    // ровно string[], без опоры на то, как TS сузил Array.isArray.
    const clean = [
      ...new Set((ids as unknown[]).filter((value): value is string => typeof value === "string")),
    ];
    if (clean.length > 0) {
      const valid = await prisma.groupRole.findMany({
        where: { groupId: channel.groupId, id: { in: clean } },
        select: { id: true },
      });
      if (valid.length !== clean.length) throw new Error("BAD_ROLES");
    }
    await prisma.channelRoleAccess.deleteMany({ where: { channelId: id, scope } });
    if (clean.length > 0) {
      await prisma.channelRoleAccess.createMany({
        data: clean.map((roleId) => ({ channelId: id, roleId, scope })),
        skipDuplicates: true,
      });
    }
  };

  try {
    await replaceRoles("VIEW", roleIds);
    await replaceRoles("ASK", askRoleIds);
    await replaceRoles("ANSWER", answerRoleIds);
  } catch {
    return NextResponse.json({ error: "Одна или несколько ролей не принадлежат сообществу" }, { status: 400 });
  }

  // FIX-GROUPSETTINGS: для CATEGORY-канала распространяем настройки на все
  // дочерние каналы, если флаг propagateToChildren = true.
  if (propagateToChildren && updated.type === "CATEGORY") {
    const children = await prisma.channel.findMany({
      where: { parentId: updated.id },
      select: { id: true },
    });
    if (children.length > 0) {
      const childData: Record<string, unknown> = {};
      if (isRestricted !== undefined) childData.isRestricted = !!isRestricted;
      if (postAccess !== undefined && ["ALL", "MOD", "ADMIN"].includes(postAccess)) childData.postAccess = postAccess;
      if (readAccess !== undefined && ["ALL", "MOD", "ADMIN"].includes(readAccess)) childData.readAccess = readAccess;
      if (hidden !== undefined) childData.hidden = !!hidden;
      if (noRecord !== undefined) childData.noRecord = !!noRecord;
      if (voiceLimit !== undefined) childData.voiceLimit = (typeof voiceLimit === "number" && voiceLimit > 0) ? voiceLimit : null;
      if (Object.keys(childData).length > 0) {
        await prisma.channel.updateMany({
          where: { parentId: updated.id },
          data: childData,
        });
      }
      // Propagate role access (VIEW scope) to all children
      if (Array.isArray(roleIds)) {
        const clean = [...new Set((roleIds as unknown[]).filter((v): v is string => typeof v === "string"))];
        for (const childId of children.map((c: { id: string }) => c.id)) {
          await prisma.channelRoleAccess.deleteMany({ where: { channelId: childId, scope: "VIEW" } });
          if (clean.length > 0) {
            await prisma.channelRoleAccess.createMany({
              data: clean.map((roleId: string) => ({ channelId: childId, roleId, scope: "VIEW" })),
              skipDuplicates: true,
            });
          }
        }
      }
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать удалять каналы группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const channel = await checkChannelAdmin(session.user.id, id);
  if (!channel) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* FIX-CHANDEL: канал услуги удаляется как любой другой: запрет, стоявший
     здесь раньше, лечил симптом — возвращала каналы сверка с Админ ▸ Услуги,
     и исправлена она там же (lib/mainCommunity). */

  await prisma.channel.delete({ where: { id } });

  const io = getIO();
  if (io) {
    io.emit("channel-deleted", { channelId: id, groupId: channel.groupId });
  }
  if (channel.type === "VOICE") {
    const kick = (globalThis as Record<string, unknown>).__kickVoiceChannel as ((id: string) => void) | undefined;
    if (kick) kick(id);
  }

  return NextResponse.json({ success: true });
}
