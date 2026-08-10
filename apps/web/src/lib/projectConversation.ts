import prisma from "@/lib/prisma";
import { ensureAppealsChannel } from "@/lib/mainCommunity";
import { ensureBusinessChat } from "@/lib/businessChat";
import { notifyNewAppeal } from "@/lib/appealNotify";

/**
 * CHAT: один разговор по проекту вместо двух.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У проекта в личном кабинете висел собственный «Чат по проекту» со своим полем
 * ввода (PartnerProjectMessage). При этом по тому же самому вопросу у заказчика
 * УЖЕ был открыт деловой чат: заявка на сотрудничество (Appeal с категорией
 * COOPERATION) заводит разговор сразу при подаче — см. lib/businessChat.ts.
 *
 * Два места для одного разговора — это не удвоенное удобство, а разделённая
 * пополам история. Заказчик пишет в карточку проекта, администратор отвечает в
 * деловом чате, и оба уверены, что вторая сторона молчит.
 *
 * ── Что вместо ──────────────────────────────────────────────────────────────
 *
 * Кнопка в карточке проекта ведёт в деловой чат. Связи проекта с обращением в
 * данных не было, поэтому она заведена: `PartnerProject.appealId`.
 *
 * Ссылка проставляется ЛЕНИВО — при первом переходе, а не при создании проекта.
 * Так это работает одинаково и для новых проектов, и для тех, что заведены до
 * появления связи: разбирать «старые без обращения / новые с обращением» не
 * приходится вовсе. Плата за ленивость одна: обращение заводится в момент, когда
 * человек действительно захотел поговорить, — и это скорее плюс, чем минус,
 * потому что администрация не получает уведомление о разговоре, которого никто
 * не начинал.
 *
 * ── Какое обращение считается «тем самым» ───────────────────────────────────
 *
 * Сначала уже привязанное. Затем — незакрытая заявка на сотрудничество этого же
 * заказчика по этой же услуге: именно её он подавал кнопкой «Сотрудничество»,
 * и разговор по ней у него уже открыт. И только если такой нет — заводится
 * новая заявка по проекту.
 *
 * Искать по услуге, а не просто «последнее обращение автора», важно: у
 * заказчика может висеть обжалование блокировки или вопрос в поддержку, и
 * привязать проект к нему значило бы отправить обсуждение работ не туда.
 */

/** Категория обращений, по которым заводится деловой чат (см. businessChat). */
const COOPERATION = "COOPERATION";

/** Заявка кнопкой «Сотрудничество» называется ровно так (см. CooperationButton). */
export function cooperationSubject(serviceTitle: string): string {
  return `Сотрудничество: ${serviceTitle}`.slice(0, 120);
}

export interface ProjectForConversation {
  id: string;
  name: string;
  purpose: string;
  ownerId: string;
  appealId: string | null;
  service: { id: string; title: string } | null;
}

export interface ProjectConversation {
  appealId: string;
  /** null — деловой чат создать не удалось: в проекте нет ни одного администратора. */
  conversationId: string | null;
}

/** Канал обращений. Досоздаётся так же, как в POST /api/appeals. */
async function resolveAppealsChannel(): Promise<{ id: string } | null> {
  const find = () =>
    prisma.channel.findFirst({
      where: { type: "APPEALS", group: { isMain: true } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }).then((main) => main ?? prisma.channel.findFirst({
      where: { type: "APPEALS" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));

  const found = await find();
  if (found) return found;
  await ensureAppealsChannel();
  return find();
}

/**
 * Найти обращение, по которому уже идёт разговор об этой услуге.
 *
 * Закрытые не берём: закрытая заявка — законченный разговор, и дописывать в неё
 * обсуждение новой работы значит воскрешать то, что стороны сочли исчерпанным.
 */
async function findOpenCooperationAppeal(ownerId: string, serviceTitle: string): Promise<string | null> {
  const appeal = await prisma.appeal.findFirst({
    where: {
      authorId: ownerId,
      category: COOPERATION,
      subject: cooperationSubject(serviceTitle),
      status: { not: "CLOSED" },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return appeal?.id ?? null;
}

/**
 * Обращение и деловой чат по проекту: найти или завести.
 *
 * Возвращает null, если завести обращение негде — в установке нет канала
 * обращений и создать его не удалось. Молчать об этом нельзя: снаружи это
 * выглядит как «кнопка не работает», поэтому вызывающий маршрут отвечает
 * внятной ошибкой, а не пустым успехом.
 */
export async function ensureProjectConversation(
  project: ProjectForConversation,
  actorId: string,
): Promise<ProjectConversation | null> {
  let appealId = project.appealId;
  let subject = project.name;
  let body = project.purpose;

  if (appealId) {
    /* Обращение могли удалить вместе с каналом: ссылка тогда указывает в
       пустоту, и разговор надо завести заново, а не упасть. */
    const existing = await prisma.appeal.findUnique({
      where: { id: appealId },
      select: { id: true, subject: true, body: true },
    });
    if (existing) {
      subject = existing.subject;
      body = existing.body;
    } else {
      appealId = null;
    }
  }

  if (!appealId && project.service) {
    const reused = await findOpenCooperationAppeal(project.ownerId, project.service.title);
    if (reused) {
      const appeal = await prisma.appeal.findUnique({
        where: { id: reused },
        select: { id: true, subject: true, body: true },
      });
      if (appeal) {
        appealId = appeal.id;
        subject = appeal.subject;
        body = appeal.body;
      }
    }
  }

  let created = false;
  if (!appealId) {
    const channel = await resolveAppealsChannel();
    if (!channel) return null;

    subject = `Проект: ${project.name}`.slice(0, 120);
    body = project.purpose.slice(0, 4000);
    const appeal = await prisma.appeal.create({
      data: {
        channelId: channel.id,
        /* Автор обращения — ВЛАДЕЛЕЦ проекта, даже если разговор открыл
           администратор: в деловом чате первая сторона — заказчик, и по этому
           порядку список понимает, кто из двоих клиент (см. businessChat). */
        authorId: project.ownerId,
        subject,
        body,
        category: COOPERATION,
        status: "OPEN",
        messages: { create: { authorId: project.ownerId, body, isAdmin: false } },
      },
      select: { id: true },
    });
    appealId = appeal.id;
    created = true;
  }

  if (appealId !== project.appealId) {
    await prisma.partnerProject.update({ where: { id: project.id }, data: { appealId } });
  }

  const conversationId = await ensureBusinessChat({
    appealId,
    clientId: project.ownerId,
    subject,
    appealBody: body,
  });

  if (created) {
    /* Уведомляем разбирающих тем же путём, что и обычное обращение: иначе новая
       заявка появилась бы в очереди молча и ждала бы, пока кто-нибудь туда
       заглянет. Ошибку глотаем — разговор уже открыт, и ронять переход в чат
       из-за не ушедшего письма нельзя. */
    const owner = await prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true } });
    await notifyNewAppeal({
      appealId,
      actorId,
      authorName: owner?.name ?? "Клиент",
      subject,
      isBanAppeal: false,
      body,
    }).catch((err) => console.warn("[project] уведомление о новом обращении не ушло", appealId, err));
  }

  return { appealId, conversationId };
}
