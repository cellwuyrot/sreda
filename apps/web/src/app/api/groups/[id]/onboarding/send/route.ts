import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { checkBan } from "@/lib/banCheck";

// FIX-ONBSEND: рассылка онбординг-формы.
//
// Создатель или админ группы выбирает получателей — поимённо и/или целыми
// тегами — и отправляет анкету. Каждый получает личное уведомление от имени
// группы (колокольчик и раздел «Уведомления»), а запись OnboardingInvite даёт
// ему право заполнить форму, даже если она выключена для группы целиком.
//
// Повторная отправка тому же человеку не плодит записи: уникальный ключ
// (formId, userId) обновляет существующее приглашение.

const FORM_MANAGERS = ["OWNER", "ADMIN"]; // модератор намеренно исключён
const MAX_RECIPIENTS = 500;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать рассылать форму онбординга участникам группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const limited = await rateLimit(req, `onboarding-send:${groupId}`, { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const me = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
    select: { role: true },
  });
  if (!me || !FORM_MANAGERS.includes(me.role)) {
    return NextResponse.json({ error: "Форму рассылают только создатель и админ группы" }, { status: 403 });
  }

  const form = await prisma.onboardingForm.findUnique({
    where: { groupId },
    select: { id: true, description: true, questions: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Сначала сохраните форму онбординга" }, { status: 400 });
  }

  // FIX-CI: тело запроса разбираем явным помощником. Раньше здесь стояло
  // `Array.isArray(payload?.userIds) ? payload.userIds : []` — сужение типа
  // относилось к выражению `payload?.userIds`, а читалось уже `payload.userIds`,
  // поэтому Set выводился как Set<unknown> и Prisma отвергала фильтр `in`.
  const payload = (await req.json().catch(() => null)) as
    | { userIds?: unknown; roleIds?: unknown }
    | null;

  const readIds = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
      : [];

  const userIds = readIds(payload?.userIds);
  const roleIds = readIds(payload?.roleIds);

  if (userIds.length === 0 && roleIds.length === 0) {
    return NextResponse.json({ error: "Выберите получателей: участников или теги" }, { status: 400 });
  }

  // Теги обязаны принадлежать этой группе — иначе можно было бы разослать
  // форму носителям чужого тега.
  if (roleIds.length > 0) {
    const validRoles = await prisma.groupRole.count({ where: { groupId, id: { in: roleIds } } });
    if (validRoles !== roleIds.length) {
      return NextResponse.json({ error: "Один или несколько тегов не принадлежат группе" }, { status: 400 });
    }
  }

  // Получатели: только участники этой группы. Из тегов раскрываем носителей.
  // viaRoleId сохраняет, каким тегом человек был захвачен (для отчётности).
  const viaRole = new Map<string, string>();

  if (roleIds.length > 0) {
    const tagged = await prisma.groupMemberRole.findMany({
      where: { roleId: { in: roleIds }, member: { groupId } },
      select: { roleId: true, member: { select: { userId: true } } },
      take: MAX_RECIPIENTS * 4,
    });
    for (const row of tagged) {
      if (!viaRole.has(row.member.userId)) viaRole.set(row.member.userId, row.roleId);
    }
  }

  if (userIds.length > 0) {
    const direct = await prisma.groupMember.findMany({
      where: { groupId, userId: { in: userIds } },
      select: { userId: true },
    });
    // Адресный выбор перекрывает попадание по тегу: viaRoleId остаётся пустым.
    for (const m of direct) viaRole.set(m.userId, "");
  }

  // Себе форму не шлём — управляющий и так видит её в конструкторе.
  viaRole.delete(session.user.id);

  const recipients = [...viaRole.entries()].slice(0, MAX_RECIPIENTS);
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Среди выбранных нет участников группы" }, { status: 400 });
  }

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
  const groupName = group?.name ?? "Сообщество";
  const senderName = session.user.name || session.user.username || "Управляющий";
  const shortDescription = (form.description || "").trim().slice(0, 160);

  await prisma.$transaction(
    recipients.map(([userId, roleId]) =>
      prisma.onboardingInvite.upsert({
        where: { formId_userId: { formId: form.id, userId } },
        create: {
          formId: form.id,
          groupId,
          userId,
          sentById: session.user.id,
          viaRoleId: roleId || null,
        },
        update: {
          sentById: session.user.id,
          viaRoleId: roleId || null,
          createdAt: new Date(),
        },
      }),
    ),
  );

  // Уведомления шлём после записи приглашений: перейдя по ссылке сразу, человек
  // уже имеет право открыть форму.
  await Promise.all(
    recipients.map(([userId]) =>
      createNotification({
        userId,
        type: "onboarding",
        title: `Анкета сообщества «${groupName}»`,
        body: shortDescription
          ? `${senderName} прислал(а) вам форму: ${shortDescription}`
          : `${senderName} прислал(а) вам форму онбординга. Откройте раздел «Общественность» группы.`,
        link: `/connect?group=${groupId}`,
      }).catch(() => null),
    ),
  );

  return NextResponse.json({ ok: true, sent: recipients.length });
}
