import prisma from "@/lib/prisma";
import { parseDocuments } from "@/lib/businessPayment"; // FIX-SRVDOC

/**
 * Деловой чат по обращению.
 *
 * ── Как это устроено и почему именно так ────────────────────────────────────
 *
 * У КЛИЕНТА на каждое обращение свой чат. Отправил заявку — чат появился сразу,
 * ещё до того, как её кто-то взял: человек только что описал задачу и пойдёт
 * искать её там, где ему обещали разговор. Второе обращение — второй чат, а не
 * дописка в старый: это разные разговоры о разных задачах.
 *
 * Клиент разговаривает не с человеком, а с АДМИНИСТРАЦИЕЙ. Он не знает и не
 * должен знать, кто именно из проекта разбирает его заявку, и не должен ощущать
 * подмену собеседника, когда заявку передали другому. Поэтому в его списке
 * сторона называется «Администрация TZ Connect», а раздел — «Бизнес чат», а не
 * «Личные сообщения»: это не переписка с приятелем.
 *
 * У АДМИНИСТРАЦИИ это, по сути, общий чат. Доступ даёт РОЛЬ: очередь деловых
 * разговоров целиком видят все администраторы и редакторы — иначе заявка,
 * доставшаяся отсутствующему человеку, повисает. А отвечает по заявке один, и
 * его имя видно остальным (`handlerId`) — двое, отвечающих одному клиенту
 * разное, хуже, чем один отвечающий с задержкой.
 *
 * ── Связка ──────────────────────────────────────────────────────────────────
 *
 *   обращение (Appeal) ─ appealId ─→ разговор (DirectConversation, kind BUSINESS)
 *        │                                  │
 *        │ user1 = клиент ───────────────────┤ user2 = сторона администрации
 *        └ handlerId = кто ведёт ────────────┘
 *
 * `user1`/`user2` для делового разговора не переставляются: клиент всегда
 * первый. По этому порядку список понимает, кто из двоих заказчик, — без него
 * клиенту в собеседниках показалось бы его собственное имя.
 *
 * `user2` — реальный человек из администрации (старейший ADMIN, иначе EDITOR).
 * Так сделано затем, чтобы не заводить фальшивую учётную запись «Администрация»
 * и не менять во всём разделе личных сообщений допущение «в разговоре ровно два
 * участника». Кто именно занимает это место, для клиента не значит ничего: он
 * видит «Администрация TZ Connect».
 *
 * Логику чатов не переписываем: это обычный диалог личных сообщений
 * (DirectConversation) с пометкой `kind: "BUSINESS"`. Сообщения, вложения,
 * прочтения, сокет-события, поиск — всё уже работает и работает одинаково.
 *
 * ── Чего здесь нет ──────────────────────────────────────────────────────────
 *
 * Переписка из карточки обращения переносится в чат (ответ администратора и
 * дописка клиента), но НЕ наоборот: сообщения из чата в карточку не попадают.
 * Карточка — это очередь и история заявки, разговор живёт в чате. Знать об этом
 * важно: администратор, ответивший в чате, не увидит своего ответа в карточке.
 *
 * Здесь нет сокет-событий: этот модуль только пишет в базу и возвращает, кому
 * событие адресовано. Рассылает вызывающий маршрут — он и так знает имена
 * событий из общего пакета, а модуль остаётся проверяемым без сборки пакета.
 */

/** Виды диалогов. Значение хранится строкой — см. схему DirectConversation.
 *
 * SECURE — защищённая переписка с тем же человеком: ОТДЕЛЬНЫЙ разговор, а не
 * режим внутри обычного. Раньше шифрованные и открытые сообщения лежали в одной
 * переписке и разделялись только фильтром на клиенте — то есть фактически всё было
 * вперемешку, и переписка терялась при переключении режима. */
export const CONVERSATION_KINDS = ["PERSONAL", "BUSINESS", "SECURE"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export function isConversationKind(value: unknown): value is ConversationKind {
  return typeof value === "string" && (CONVERSATION_KINDS as readonly string[]).includes(value);
}

/**
 * Роли, составляющие администрацию проекта. Один список на весь код обращений:
 * ровно эти роли разбирают заявки, видят деловую очередь и получают уведомления
 * о новых обращениях. Раньше список был выписан в каждом месте по-своему, и
 * редакторы то входили в администрацию, то нет.
 */
export const STAFF_ROLES = ["ADMIN", "EDITOR"] as const;

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

/** Как клиент видит сторону администрации. Одна подпись на список и заголовок. */
export const ADMINISTRATION_NAME = "Администрация TZ Connect";

/** Категории обращений, для которых заводится деловой чат. */
const BUSINESS_CATEGORIES = new Set(["COOPERATION"]);

/**
 * Стоит ли по этому обращению открывать деловой чат.
 *
 * Обжалование блокировки — не деловой разговор: человек заблокирован, и
 * заводить ему чат с администратором значит открыть обход блокировки. Такие
 * обращения остаются в карточке.
 */
export function isBusinessAppeal(category: string | null | undefined): boolean {
  return !!category && BUSINESS_CATEGORIES.has(category);
}

/** Список администрации: кому доступна деловая очередь и уведомления по ней. */
export async function staffIds(excludeUserId?: string): Promise<string[]> {
  const staff = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { id: true },
  });
  /* Типы указаны явно: без сгенерированного клиента Prisma вывод даёт any, и
     под noImplicitAny сборка спотыкается на пустом месте. */
  return staff
    .map((person: { id: string }) => person.id)
    .filter((id: string) => id !== excludeUserId);
}

/**
 * Кто займёт место администрации в разговоре.
 *
 * Старейший ADMIN, иначе старейший EDITOR: это место техническое, и человек на
 * нём для клиента безымянен. Совпадение с клиентом исключаем — иначе получился
 * бы разговор с самим собой, который в разделе личных сообщений уже занят
 * «Сейфом».
 */
export async function administrationSlotId(clientId: string): Promise<string | null> {
  const staff = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const usable = staff.filter((person: { id: string }) => person.id !== clientId);
  const admin = usable.find((person: { role: string }) => person.role === "ADMIN");
  return admin?.id ?? usable[0]?.id ?? null;
}

export interface EnsureBusinessChatParams {
  appealId: string;
  /** Автор обращения — клиент. */
  clientId: string;
  /** Тема обращения: с неё начинается разговор. */
  subject: string;
  /** Исходный текст заявки. */
  appealBody: string;
  /**
   * FIX-SRVDOC: услуга, выбранная клиентом в «Сотрудничестве». Если указана,
   * вторым сообщением в чат уйдут приложенные к услуге документы.
   */
  serviceId?: string | null;
}

/**
 * FIX-SRVDOC: прислать в деловой чат документы выбранной услуги.
 *
 * Автором ставится сторона администрации, а не клиент: бумаги выдаёт проект, и
 * в переписке они должны читаться как ответ администрации, а не как вложение
 * заявителя. Отсутствие документов — не ошибка: у части услуг бумаг просто нет.
 */
export async function sendServiceDocuments(params: {
  conversationId: string;
  authorId: string;
  serviceId: string;
}): Promise<boolean> {
  const service = await prisma.service.findUnique({
    where: { id: params.serviceId },
    select: { title: true, documents: true },
  });
  if (!service) return false;

  const documents = parseDocuments(service.documents);
  if (documents.length === 0) return false;

  /* FIX-SRVDOC2: бумаги уходят ВЛОЖЕНИЯМИ, а не строчками со ссылками.

     Раньше в чат уходил обычный текст вида «• название — /uploads/…». Для
     переписки это была строка без вложений: нажать не на что, скачать нечего,
     в списке вложений разговора документа нет — то есть со стороны клиента
     «документ отправлен» было написано, а документа не было.

     Формат вложения тот же, что у файла, отправленного руками (см. Attachment в
     components/dm/dmTypes): ничего особенного для деловых бумаг не заводим,
     иначе предпросмотр, скачивание и список вложений пришлось бы учить ещё
     одному виду сообщения. */
  const attachments = documents
    /* Только файлы из своего хранилища: проверка вложений в личных
       сообщениях принимает ровно такие адреса, и посторонняя ссылка,
       попавшая в базу ручной правкой, должна отнять один документ, а не
       всю отправку. */
    .filter((doc) => doc.url.startsWith("/uploads/"))
    .map((doc) => ({
      url: doc.url,
      name: doc.name,
      size: doc.size,
      type: doc.mime ?? "application/octet-stream",
      isImage: /\.(png|jpe?g|gif|webp|bmp)$/i.test(doc.url),
    }));
  if (attachments.length === 0) return false;

  /* Подпись к вложениям короткая: перечислять имена файлов в тексте больше
     не нужно — они видны на самих вложениях. */
  const content = `Документы по услуге «${service.title}» — работа выполняется согласно ним.`;

  const now = new Date();
  await prisma.directMessage.create({
    data: {
      conversationId: params.conversationId,
      userId: params.authorId,
      content,
      attachments: JSON.stringify(attachments),
    },
  });
  await prisma.directConversation.update({
    where: { id: params.conversationId },
    data: { lastMessageAt: now },
  });
  return true;
}

/**
 * Найти или создать деловой чат по обращению.
 *
 * Возвращает id разговора либо null, если создавать негде: в проекте нет ни
 * одного администратора или редактора, кроме самого заявителя. Молчать об этом
 * нельзя — пишем в журнал, потому что снаружи это выглядит как «чат не
 * появился».
 *
 * Повторные вызовы безопасны: разговор ищется по `appealId`, у которого в схеме
 * стоит уникальность. Именно поэтому парной уникальности [user1, user2, kind]
 * в схеме больше нет: с ней второе обращение того же клиента к тому же
 * администратору падало на вставке, и чат молча не создавался.
 */
export async function ensureBusinessChat(params: EnsureBusinessChatParams): Promise<string | null> {
  const existing = await prisma.directConversation.findUnique({
    where: { appealId: params.appealId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const slotId = await administrationSlotId(params.clientId);
  if (!slotId) {
    console.warn("[business] некому вести деловой чат: в проекте нет администраторов и редакторов");
    return null;
  }

  const now = new Date();
  try {
    const conversation = await prisma.directConversation.create({
      data: {
        /* Порядок несёт смысл: клиент — user1. Не сортируем. */
        user1Id: params.clientId,
        user2Id: slotId,
        kind: "BUSINESS",
        appealId: params.appealId,
        lastMessageAt: now,
        messages: {
          create: [
            {
              /* Первое сообщение — от клиента: это его заявка. Автором ставим
                 клиента, а не систему, чтобы чат читался как разговор, а не как
                 журнал событий, и чтобы у администратора сразу была суть. */
              userId: params.clientId,
              content: `Заявка: ${params.subject}\n\n${params.appealBody}`,
            },
          ],
        },
      },
      select: { id: true },
    });

    /* FIX-SRVDOC: документы выбранной услуги уходят вторым сообщением сразу после
       заявки: клиент открывает чат и видит бумаги, по которым будет идти работа, без
       отдельного вопроса администрации. Ошибку глотаем: сам чат уже создан, и
       терять его из-за неотправленного списка файлов нельзя. */
    if (params.serviceId) {
      try {
        await sendServiceDocuments({
          conversationId: conversation.id,
          authorId: slotId,
          serviceId: params.serviceId,
        });
      } catch (err) {
        console.warn("[business] не удалось приложить документы услуги", params.serviceId, err);
      }
    }

    return conversation.id;
  } catch (err) {
    /* Гонка двух одновременных вызовов: уникальность по appealId не даст создать
       второй разговор, и проигравший вызов должен вернуть уже созданный, а не
       упасть. */
    const raced = await prisma.directConversation.findUnique({
      where: { appealId: params.appealId },
      select: { id: true },
    });
    if (raced) return raced.id;
    console.warn("[business] не удалось создать деловой чат по обращению", params.appealId, err);
    return null;
  }
}

export interface MirrorAppealMessageParams {
  appeal: { id: string; authorId: string; subject: string; body: string; category: string | null };
  /** Кто написал: клиент или человек из администрации. */
  authorId: string;
  body: string;
  /** true — писал администратор или редактор. */
  fromStaff: boolean;
}

export interface MirroredAppealMessage {
  conversationId: string;
  /** Кто ведёт разговор после этого сообщения. null — заявку ещё не взяли. */
  handlerId: string | null;
  /** Кому адресовать сокет-событие: клиент и вся администрация. */
  recipients: string[];
  /** Созданное сообщение в том же виде, в каком его отдаёт маршрут ЛС. */
  message: {
    id: string;
    content: string;
    userId: string;
    conversationId: string;
    createdAt: Date;
    user: { id: string; name: string; username: string; avatar: string | null; role: string };
  };
}

/**
 * Перенести сообщение из карточки обращения в деловой чат.
 *
 * Ответ администратора здесь же назначает его ведущим, если заявку ещё не брали:
 * взял в работу тот, кто первым ответил. Дальше имя ведущего видят остальные, и
 * второй администратор понимает, что заявка уже занята.
 *
 * Чат досоздаётся: обращения, поданные до этой правки, чата не имеют, и первый
 * же ответ должен его открыть, а не упереться в отсутствие разговора.
 */
export async function mirrorAppealMessage(
  params: MirrorAppealMessageParams,
): Promise<MirroredAppealMessage | null> {
  if (!isBusinessAppeal(params.appeal.category)) return null;

  const conversationId = await ensureBusinessChat({
    appealId: params.appeal.id,
    clientId: params.appeal.authorId,
    subject: params.appeal.subject,
    appealBody: params.appeal.body,
  });
  if (!conversationId) return null;

  const conversation = await prisma.directConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, user1Id: true, user2Id: true, handlerId: true },
  });
  if (!conversation) return null;

  let handlerId = conversation.handlerId;
  if (params.fromStaff && !handlerId) {
    handlerId = params.authorId;
    await prisma.directConversation.update({
      where: { id: conversationId },
      data: { handlerId },
    });
  }

  const now = new Date();
  const message = await prisma.directMessage.create({
    data: { conversationId, userId: params.authorId, content: params.body },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true } },
    },
  });
  await prisma.directConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });

  const recipients = await businessAudience(conversation);

  return {
    conversationId,
    handlerId,
    recipients,
    message: {
      id: message.id,
      content: message.content,
      userId: message.userId,
      conversationId,
      createdAt: message.createdAt,
      user: message.user,
    },
  };
}

/**
 * Кому адресовать событие о сообщении делового разговора.
 *
 * Клиенту и всей администрации: очередь у администраторов общая, и новое
 * сообщение должно поднимать разговор в списке у каждого, а не только у того,
 * кто уже открыл чат.
 */
export async function businessAudience(conversation: {
  user1Id: string;
  user2Id: string;
}): Promise<string[]> {
  const staff = await staffIds();
  return Array.from(new Set([conversation.user1Id, conversation.user2Id, ...staff]));
}
