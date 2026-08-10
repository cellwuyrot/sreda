import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/sanitize";
import { createNotification } from "@/lib/createNotification";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";

// FIX-ONBSEND: форму можно не только «включить для всех», но и адресно
// разослать — конкретным участникам и всем носителям тега. Получатель видит
// личное уведомление от имени группы и может заполнить анкету, даже когда она
// не активна для группы целиком (см. OnboardingInvite).
//
// FIX-COMMUNITY: онбординг группы (вкладка модуля «Общественность»).
// Форму создают и редактируют ТОЛЬКО создатель и админ группы (не модератор —
// требование фичи). Участник подаёт заявку не чаще раза в сутки; заявка
// уходит личным уведомлением создателю и админам (колокольчик / раздел
// уведомлений в настройках). Одобрение выдаёт роль-тег формы.

const FORM_MANAGERS = ["OWNER", "ADMIN"]; // модератор намеренно исключён
const MAX_QUESTIONS = 10;
const MAX_Q_LEN = 200;
const MAX_A_LEN = 1000;
const APPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // одна заявка в сутки

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function getMembership(userId: string, groupId: string) {
  return prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { id: true, role: true },
  });
}

// GET — форма + моя заявка; для OWNER/ADMIN дополнительно очередь заявок.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await getMembership(session.user.id, groupId);
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await prisma.onboardingForm.findUnique({
    where: { groupId },
    include: { role: { select: { id: true, name: true, color: true } } },
  });

  const myApplication = await prisma.onboardingApplication.findFirst({
    where: { groupId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true, reviewNote: true },
  });

  // FIX-ONBSEND: адресное приглашение открывает форму лично для получателя.
  const myInvite = form
    ? await prisma.onboardingInvite.findUnique({
        where: { formId_userId: { formId: form.id, userId: session.user.id } },
        select: { createdAt: true },
      })
    : null;

  const isManager = FORM_MANAGERS.includes(me.role);
  let recipients: unknown | undefined;
  if (isManager) {
    // Данные для диалога рассылки: теги группы и участники с их тегами.
    const [roles, members, sentCount] = await Promise.all([
      prisma.groupRole.findMany({
        where: { groupId },
        orderBy: [{ priority: "desc" }, { name: "asc" }],
        select: { id: true, name: true, color: true, _count: { select: { members: true } } },
      }),
      prisma.groupMember.findMany({
        where: { groupId },
        take: 500,
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          user: { select: { id: true, name: true, username: true, avatar: true } },
          tags: { select: { roleId: true } },
        },
      }),
      form ? prisma.onboardingInvite.count({ where: { formId: form.id } }) : Promise.resolve(0),
    ]);
    recipients = {
      roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, memberCount: r._count.members })),
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        username: m.user.username,
        avatar: m.user.avatar,
        roleIds: m.tags.map((t) => t.roleId),
      })),
      sentCount,
    };
  }

  let applications: unknown[] | undefined;
  if (isManager) {
    applications = await prisma.onboardingApplication.findMany({
      where: { groupId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true, answers: true, createdAt: true,
        user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
      },
    });
  }

  const nextApplyAt = myApplication && myApplication.status !== "APPROVED"
    ? new Date(new Date(myApplication.createdAt).getTime() + APPLY_COOLDOWN_MS)
    : null;

  return NextResponse.json({
    form: form
      ? {
          active: form.active,
          description: form.description,
          questions: parseJsonArray(form.questions),
          role: form.role,
        }
      : null,
    myApplication,
    nextApplyAt,
    isManager,
    invited: !!myInvite, // FIX-ONBSEND
    ...(recipients ? { recipients } : {}),
    ...(applications ? { applications } : {}),
  });
}

// PUT — создать/обновить форму (только OWNER/ADMIN).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать создавать и редактировать форму онбординга.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const me = await getMembership(session.user.id, groupId);
  if (!me || !FORM_MANAGERS.includes(me.role)) {
    return NextResponse.json({ error: "Форму онбординга настраивают только создатель и админ группы" }, { status: 403 });
  }

  const { active, description, questions, roleId } = await req.json();

  if (!Array.isArray(questions) || questions.length === 0 || questions.length > MAX_QUESTIONS) {
    return NextResponse.json({ error: `Нужно от 1 до ${MAX_QUESTIONS} вопросов` }, { status: 400 });
  }
  const cleanQuestions = questions
    .map((q) => (typeof q === "string" ? sanitizeText(q).slice(0, MAX_Q_LEN).trim() : ""))
    .filter((q) => q.length > 0);
  if (cleanQuestions.length === 0) {
    return NextResponse.json({ error: "Вопросы не могут быть пустыми" }, { status: 400 });
  }

  let cleanRoleId: string | null = null;
  if (roleId) {
    const role = await prisma.groupRole.findFirst({ where: { id: String(roleId), groupId }, select: { id: true } });
    if (!role) return NextResponse.json({ error: "Роль не найдена в этой группе" }, { status: 400 });
    cleanRoleId = role.id;
  }

  const data = {
    active: active === true,
    description: typeof description === "string" ? sanitizeText(description).slice(0, 1000) : "",
    questions: JSON.stringify(cleanQuestions),
    roleId: cleanRoleId,
  };

  const form = await prisma.onboardingForm.upsert({
    where: { groupId },
    create: { groupId, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, formId: form.id });
}

// POST — подать заявку (участник; не чаще одной в сутки).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать подавать заявки на вступление через онбординг.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const limited = await rateLimit(req, `onboarding:${groupId}`, { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const me = await getMembership(session.user.id, groupId);
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await prisma.onboardingForm.findUnique({ where: { groupId } });
  if (!form) {
    return NextResponse.json({ error: "Онбординг в этой группе не настроен" }, { status: 400 });
  }
  if (!form.active) {
    // FIX-ONBSEND: форма выключена для группы — заполнить её может только тот,
    // кому её прислали адресно.
    const invite = await prisma.onboardingInvite.findUnique({
      where: { formId_userId: { formId: form.id, userId: session.user.id } },
      select: { id: true },
    });
    if (!invite) {
      return NextResponse.json({ error: "Онбординг в этой группе не настроен" }, { status: 400 });
    }
  }
  const questions = parseJsonArray(form.questions);

  const last = await prisma.onboardingApplication.findFirst({
    where: { groupId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true },
  });
  if (last?.status === "PENDING") {
    return NextResponse.json({ error: "Ваша заявка уже на рассмотрении" }, { status: 409 });
  }
  if (last?.status === "APPROVED") {
    return NextResponse.json({ error: "Ваша заявка уже одобрена" }, { status: 409 });
  }
  if (last && Date.now() - new Date(last.createdAt).getTime() < APPLY_COOLDOWN_MS) {
    return NextResponse.json({ error: "Заявку можно подавать один раз в сутки" }, { status: 429 });
  }

  const { answers } = await req.json();
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    return NextResponse.json({ error: "Ответьте на все вопросы формы" }, { status: 400 });
  }
  const cleanAnswers = answers.map((a) =>
    typeof a === "string" ? sanitizeText(a).slice(0, MAX_A_LEN).trim() : "",
  );
  if (cleanAnswers.some((a) => a.length === 0)) {
    return NextResponse.json({ error: "Ответьте на все вопросы формы" }, { status: 400 });
  }

  const application = await prisma.onboardingApplication.create({
    data: {
      formId: form.id,
      groupId,
      userId: session.user.id,
      answers: JSON.stringify(cleanAnswers),
    },
  });

  // Личные уведомления создателю и админам группы (не модераторам) — попадает
  // в колокольчик и раздел уведомлений настроек.
  const [group, managers] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
    prisma.groupMember.findMany({
      where: { groupId, role: { in: FORM_MANAGERS } },
      select: { userId: true },
    }),
  ]);
  const applicantName = session.user.name || session.user.username || "Участник";
  await Promise.all(
    managers.map((m) =>
      createNotification({
        userId: m.userId,
        type: "onboarding",
        title: `Заявка онбординга — ${group?.name ?? "группа"}`,
        body: `${applicantName} заполнил(а) форму. Откройте раздел «Общественность» группы, чтобы рассмотреть заявку.`,
        link: "/settings/notifications",
      }).catch(() => null),
    ),
  );

  return NextResponse.json({ ok: true, applicationId: application.id });
}

// PATCH — рассмотреть заявку (только OWNER/ADMIN): approve выдаёт роль формы.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать одобрять и отклонять заявки онбординга.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const me = await getMembership(session.user.id, groupId);
  if (!me || !FORM_MANAGERS.includes(me.role)) {
    return NextResponse.json({ error: "Заявки рассматривают только создатель и админ группы" }, { status: 403 });
  }

  const { applicationId, action, note } = await req.json();
  if (typeof applicationId !== "string" || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const application = await prisma.onboardingApplication.findFirst({
    where: { id: applicationId, groupId },
    include: { form: { select: { roleId: true, role: { select: { name: true } } } } },
  });
  if (!application) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  if (application.status !== "PENDING") {
    return NextResponse.json({ error: "Заявка уже рассмотрена" }, { status: 409 });
  }

  const approved = action === "approve";
  let grantedRole: string | null = null;

  if (approved && application.form.roleId) {
    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: application.userId, groupId } },
      select: { id: true },
    });
    if (member) {
      await prisma.groupMemberRole.upsert({
        where: { memberId_roleId: { memberId: member.id, roleId: application.form.roleId } },
        create: { memberId: member.id, roleId: application.form.roleId },
        update: {},
      });
      grantedRole = application.form.role?.name ?? null;
    }
  }

  await prisma.onboardingApplication.update({
    where: { id: application.id },
    data: {
      status: approved ? "APPROVED" : "REJECTED",
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      reviewNote: typeof note === "string" ? sanitizeText(note).slice(0, 300) : null,
    },
  });

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
  await createNotification({
    userId: application.userId,
    type: "onboarding",
    title: approved ? `Заявка одобрена — ${group?.name ?? "группа"}` : `Заявка отклонена — ${group?.name ?? "группа"}`,
    body: approved
      ? grantedRole
        ? `Вам выдана роль «${grantedRole}».`
        : "Ваша заявка онбординга одобрена."
      : "Вы можете подать новую заявку через сутки после предыдущей.",
    link: "/settings/notifications",
  }).catch(() => null);

  return NextResponse.json({ ok: true, status: approved ? "APPROVED" : "REJECTED", grantedRole });
}
