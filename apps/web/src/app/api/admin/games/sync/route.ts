import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiKeyPreview, fetchPartnerManifest, readApiKey } from "@/lib/gamesCatalog";

/**
 * GAMES-CATALOG: сверка партнёрской игры с манифестом разработчика.
 *
 * Одна кнопка «Проверить связь» делает и первичную интеграцию, и последующие
 * обновления карточки: манифест — единственный источник данных о партнёрской
 * игре, поэтому «подключить» и «обновить» — это одно и то же действие.
 *
 * Если связка сломалась у уже включённой игры, мы её выключаем. Оставить
 * активной карточку, которая ведёт в неизвестность, хуже, чем убрать её из
 * раздела до восстановления связи.
 */

const ROW_SELECT = {
  id: true, slug: true, title: true, description: true, cover: true, players: true,
  tags: true, kind: true, active: true, sortOrder: true, launchUrl: true,
  apiBaseUrl: true, apiKey: true, linkState: true, linkError: true,
  partnerName: true, onlinePlayers: true, lastSyncAt: true, createdAt: true,
} as const;

/** Ключ разработчика наружу не отдаётся — только его хвост. */
function forClient<T extends { apiKey: string | null }>(row: T) {
  const { apiKey, ...rest } = row;
  return { ...rest, apiKeyPreview: apiKeyPreview(apiKey), hasApiKey: !!apiKey };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указана игра" }, { status: 400 });

  const game = await prisma.gameEntry.findUnique({
    where: { id },
    select: { id: true, kind: true, apiBaseUrl: true, apiKey: true, active: true },
  });
  if (!game) return NextResponse.json({ error: "Игра не найдена" }, { status: 404 });
  if (game.kind !== "PARTNER") {
    return NextResponse.json({ error: "Сверять по API можно только партнёрские игры" }, { status: 400 });
  }
  if (!game.apiBaseUrl) return NextResponse.json({ error: "У игры не указан адрес API" }, { status: 400 });

  const key = readApiKey(game.apiKey);
  if (!key) {
    // Ключ либо не вводили, либо сменился ENCRYPTION_SECRET и расшифровать его
    // нечем. Второй случай важно назвать прямо, иначе админ будет искать
    // проблему на стороне партнёра.
    return NextResponse.json(
      { error: "Ключ разработчика недоступен — введите его заново" },
      { status: 400 },
    );
  }

  const result = await fetchPartnerManifest(game.apiBaseUrl, key);

  if ("error" in result) {
    const updated = await prisma.gameEntry.update({
      where: { id },
      data: {
        linkState: "ERROR",
        linkError: result.error.slice(0, 500),
        active: false,
        lastSyncAt: new Date(),
      },
      select: ROW_SELECT,
    });
    return NextResponse.json(
      { game: forClient(updated), error: result.error, wasActive: game.active },
      { status: 502 },
    );
  }

  const m = result.manifest;
  const updated = await prisma.gameEntry.update({
    where: { id },
    data: {
      title: m.title,
      description: m.description,
      cover: m.cover || null,
      players: m.players,
      tags: m.tags,
      launchUrl: m.launchUrl,
      partnerName: m.partnerName,
      onlinePlayers: m.online,
      linkState: "OK",
      linkError: "",
      lastSyncAt: new Date(),
    },
    select: ROW_SELECT,
  });

  return NextResponse.json({ game: forClient(updated) });
}
