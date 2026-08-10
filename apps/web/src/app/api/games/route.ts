import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GAMES-CATALOG: публичный список игр для раздела /games.
 *
 * Отдаём только включённые записи и только те поля, что нужны карточке. Ни
 * адреса API, ни ключа разработчика здесь нет и быть не может — они существуют
 * исключительно для исходящих запросов с сервера.
 */

export async function GET() {
  const rows = await prisma.gameEntry.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      cover: true,
      players: true,
      tags: true,
      kind: true,
      launchUrl: true,
      partnerName: true,
      onlinePlayers: true,
    },
  });

  return NextResponse.json({
    games: rows.map((g) => ({
      ...g,
      tags: g.tags.split(",").map((t) => t.trim()).filter(Boolean),
    })),
  });
}
