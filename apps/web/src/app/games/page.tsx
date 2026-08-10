import prisma from "@/lib/prisma";
import GamesGallery, { type GameCard } from "@/components/games/GamesGallery";

/**
 * GAMES-CATALOG: раздел /games.
 *
 * Страница стала серверной и читает каталог напрямую. Раньше список игр был
 * захардкоженным массивом в этом файле — открыть игру означало сделать релиз.
 *
 * `force-dynamic` здесь осознанно: кнопка «Активировать» в админ-панели должна
 * срабатывать сразу. Кэш на минуту сэкономил бы запрос к базе на редко
 * посещаемой странице, но превратил бы выключатель в «сработает когда-нибудь» —
 * ровно то поведение, из-за которого такие кнопки перестают вызывать доверие.
 */

export const dynamic = "force-dynamic";

export default async function GamesPage() {
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

  const games: GameCard[] = rows.map((g) => ({
    ...g,
    tags: g.tags.split(",").map((t) => t.trim()).filter(Boolean),
  }));

  return <GamesGallery games={games} />;
}
