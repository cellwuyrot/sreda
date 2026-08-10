import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ensureProjectConversation } from "@/lib/projectConversation";

/**
 * CHAT: переход из карточки проекта в деловой чат.
 *
 * POST /api/projects/[id]/chat → { conversationId }
 *
 * Метод POST, а не GET, потому что вызов может ЗАВЕСТИ обращение и разговор:
 * прятать создание данных за GET значит разрешить его любому предзагрузчику
 * ссылок и обходу браузера.
 *
 * Кто может: владелец проекта и администрация. Оба идут в один и тот же
 * разговор — в этом вся суть правки.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const project = await prisma.partnerProject.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      purpose: true,
      ownerId: true,
      appealId: true,
      service: { select: { id: true, title: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const isStaff = session.user.role === "ADMIN" || session.user.role === "EDITOR";
  if (!isStaff && project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const link = await ensureProjectConversation(project, session.user.id);
  if (!link) {
    /* Канала обращений нет и создать его не удалось. Человеку важно понять, что
       делать дальше, а не то, как устроена установка. */
    return NextResponse.json(
      { error: "Чат сейчас недоступен. Сообщите администратору — раздел обращений не создан." },
      { status: 503 },
    );
  }
  if (!link.conversationId) {
    /* Обращение есть, а собеседника нет: в проекте не заведено ни одного
       администратора или редактора (см. businessChat.administrationSlotId). */
    return NextResponse.json(
      { error: "Разговор не открыт: в проекте нет ни одного администратора" },
      { status: 503 },
    );
  }

  return NextResponse.json({ conversationId: link.conversationId, appealId: link.appealId });
}
