import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotificationsBulk } from "@/lib/createNotification";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  // ROLE-STRUCT: рассылка всем пользователям — только администратор.
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { title, body, imageUrl } = await req.json();

  if (!title || !body) {
    return NextResponse.json({ error: "Тема и сообщение обязательны" }, { status: 400 });
  }

  // FIX-SEC: imageUrl вставляется в тело уведомления как [img]...[/img]. Раньше
  // принимался любой URL (внешний трекинг-пиксель/потенциальная инъекция при
  // разборе тега). Принимаем только относительный путь загрузки на нашем домене.
  const safeImg =
    typeof imageUrl === "string" && imageUrl.trim().startsWith("/uploads/") && !imageUrl.includes("..")
      ? imageUrl.trim()
      : null;

  const users = await prisma.user.findMany({ select: { id: true } });
  const userIds = users.map((u) => u.id);

  // Настройки и вставка пакетом: цикл давал по два запроса на каждого получателя
  const sent = await createNotificationsBulk({
    userIds,
    type: "system",
    title,
    body: safeImg ? `${body}\n[img]${safeImg}[/img]` : body,
    link: "/settings/notifications",
  });

  return NextResponse.json({ sent, total: users.length });
}
