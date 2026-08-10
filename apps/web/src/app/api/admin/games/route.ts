import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  apiKeyPreview,
  fetchPartnerManifest,
  isGameKind,
  normalizeApiBaseUrl,
  storeApiKey,
} from "@/lib/gamesCatalog";

/**
 * GAMES-CATALOG: управление каталогом игр. Только ADMIN — редактор сюда не
 * допускается: партнёрская связка означает исходящие запросы с нашим сервера и
 * хранение чужого ключа, это инфраструктура, а не контент.
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  cover: true,
  players: true,
  tags: true,
  kind: true,
  active: true,
  sortOrder: true,
  launchUrl: true,
  apiBaseUrl: true,
  apiKey: true,
  linkState: true,
  linkError: true,
  partnerName: true,
  onlinePlayers: true,
  lastSyncAt: true,
  createdAt: true,
} as const;

/** Ключ разработчика из ответа вырезается — вместо него остаётся хвост. */
function forClient<T extends { apiKey: string | null }>(row: T) {
  const { apiKey, ...rest } = row;
  return { ...rest, apiKeyPreview: apiKeyPreview(apiKey), hasApiKey: !!apiKey };
}

function slugify(raw: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  return raw
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || "game";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await prisma.gameEntry.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? sanitizeText(value).trim().slice(0, max) : "";

/** Обложка своей игры — внутренний путь, партнёрской — абсолютный https. */
function readCover(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim().slice(0, 500);
  if (v.startsWith("/")) return v;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** Ссылка запуска: внутренний путь или https. */
function readLaunchUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const v = value.trim().slice(0, 500);
  if (v.startsWith("/")) return v;
  try {
    return new URL(v).protocol === "https:" ? v : "";
  } catch {
    return "";
  }
}

/* ── Список ───────────────────────────────────────────────────────────── */

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.gameEntry.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: LIST_SELECT,
  });

  return NextResponse.json({
    games: rows.map(forClient),
    manifestPath: "/trioz/manifest",
  });
}

/* ── Создание ─────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = isGameKind(body?.kind) ? body.kind : "OWN";

  if (kind === "OWN") {
    const title = text(body?.title, 120);
    if (!title) return NextResponse.json({ error: "Укажите название игры" }, { status: 400 });
    const slug = await uniqueSlug(text(body?.slug, 48) ? slugify(text(body?.slug, 48)) : slugify(title));
    const game = await prisma.gameEntry.create({
      data: {
        slug,
        title,
        description: text(body?.description, 1000),
        cover: readCover(body?.cover),
        players: text(body?.players, 60),
        tags: text(body?.tags, 200),
        kind: "OWN",
        // Своя игра не требует связки, поэтому её можно включить сразу.
        active: body?.active === true,
        launchUrl: readLaunchUrl(body?.launchUrl) || `/games/${slug}`,
        sortOrder: typeof body?.sortOrder === "number" ? Math.trunc(body.sortOrder) : 0,
        linkState: "OK",
      },
      select: LIST_SELECT,
    });
    return NextResponse.json({ game: forClient(game) });
  }

  // ── Партнёрская игра: адрес API + ключ, остальное приходит из манифеста ──
  const base = normalizeApiBaseUrl(body?.apiBaseUrl);
  if ("error" in base) return NextResponse.json({ error: base.error }, { status: 400 });

  const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (key.length < 8) {
    return NextResponse.json({ error: "Ключ разработчика слишком короткий — минимум 8 символов" }, { status: 400 });
  }

  const result = await fetchPartnerManifest(base.url, key);
  const manifest = "manifest" in result ? result.manifest : null;
  const failure = "error" in result ? result.error : "";
  const fallbackTitle = text(body?.title, 120) || new URL(base.url).hostname;
  const slug = await uniqueSlug(
    text(body?.slug, 48) ? slugify(text(body?.slug, 48)) : slugify(manifest ? manifest.title : fallbackTitle),
  );

  // Запись создаётся даже при неудачной связке: иначе администратор потерял бы
  // введённые данные и не увидел причину отказа. Игра просто останется
  // выключенной с текстом ошибки, и её можно будет пересвязать кнопкой.
  const game = await prisma.gameEntry.create({
    data: {
      slug,
      kind: "PARTNER",
      apiBaseUrl: base.url,
      apiKey: storeApiKey(key),
      active: false,
      sortOrder: typeof body?.sortOrder === "number" ? Math.trunc(body.sortOrder) : 0,
      title: manifest ? manifest.title : fallbackTitle,
      description: manifest?.description ?? "",
      cover: manifest?.cover || null,
      players: manifest?.players ?? "",
      tags: manifest?.tags ?? "",
      launchUrl: manifest?.launchUrl ?? "",
      partnerName: manifest?.partnerName ?? "",
      onlinePlayers: manifest?.online ?? null,
      linkState: manifest ? "OK" : "ERROR",
      linkError: failure.slice(0, 500),
      lastSyncAt: new Date(),
    },
    select: LIST_SELECT,
  });

  return NextResponse.json(failure ? { game: forClient(game), warning: failure } : { game: forClient(game) });
}

/* ── Изменение и включение/выключение ─────────────────────────────────── */

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указана игра" }, { status: 400 });

  const current = await prisma.gameEntry.findUnique({
    where: { id },
    select: { id: true, kind: true, linkState: true, launchUrl: true },
  });
  if (!current) return NextResponse.json({ error: "Игра не найдена" }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (typeof body?.active === "boolean") {
    // Включать партнёрскую игру без рабочей связки нельзя: карточка появилась бы
    // в разделе и вела в пустоту. Это единственное место, где выключатель
    // отказывается сработать, и отказ здесь полезнее молчаливого согласия.
    if (body.active && current.kind === "PARTNER" && current.linkState !== "OK") {
      return NextResponse.json(
        { error: "Сначала свяжите игру с API разработчика — кнопка «Проверить связь»" },
        { status: 400 },
      );
    }
    if (body.active && !current.launchUrl && readLaunchUrl(body?.launchUrl) === "") {
      return NextResponse.json({ error: "У игры нет ссылки запуска" }, { status: 400 });
    }
    data.active = body.active;
  }

  if (body?.title !== undefined) {
    const title = text(body.title, 120);
    if (!title) return NextResponse.json({ error: "Название не может быть пустым" }, { status: 400 });
    data.title = title;
  }
  if (body?.description !== undefined) data.description = text(body.description, 1000);
  if (body?.players !== undefined) data.players = text(body.players, 60);
  if (body?.tags !== undefined) data.tags = text(body.tags, 200);
  if (body?.cover !== undefined) data.cover = readCover(body.cover);
  if (body?.launchUrl !== undefined) data.launchUrl = readLaunchUrl(body.launchUrl);
  if (body?.sortOrder !== undefined && typeof body.sortOrder === "number") {
    data.sortOrder = Math.trunc(body.sortOrder);
  }

  if (body?.apiBaseUrl !== undefined) {
    if (current.kind !== "PARTNER") {
      return NextResponse.json({ error: "Адрес API есть только у партнёрских игр" }, { status: 400 });
    }
    const base = normalizeApiBaseUrl(body.apiBaseUrl);
    if ("error" in base) return NextResponse.json({ error: base.error }, { status: 400 });
    data.apiBaseUrl = base.url;
    // Адрес сменился — прежняя связка больше ничего не подтверждает.
    data.linkState = "PENDING";
  }

  if (typeof body?.apiKey === "string" && body.apiKey.trim()) {
    if (current.kind !== "PARTNER") {
      return NextResponse.json({ error: "Ключ есть только у партнёрских игр" }, { status: 400 });
    }
    if (body.apiKey.trim().length < 8) {
      return NextResponse.json({ error: "Ключ разработчика слишком короткий" }, { status: 400 });
    }
    data.apiKey = storeApiKey(body.apiKey.trim());
    data.linkState = "PENDING";
  }

  if (!Object.keys(data).length) return NextResponse.json({ error: "Нечего менять" }, { status: 400 });

  const game = await prisma.gameEntry.update({ where: { id }, data, select: LIST_SELECT });
  return NextResponse.json({ game: forClient(game) });
}

/* ── Удаление ─────────────────────────────────────────────────────────── */

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Не указана игра" }, { status: 400 });

  const existing = await prisma.gameEntry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Игра не найдена" }, { status: 404 });

  await prisma.gameEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
