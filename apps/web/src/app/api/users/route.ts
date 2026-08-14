import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * ADM-USERS: список пользователей админ-панели — с поиском и листами.
 *
 * Раньше маршрут отдавал ВСЕХ пользователей одним массивом. На сотне
 * аккаунтов это ещё терпимо, на десяти тысячах — уже нет: весь список
 * едет по сети и целиком рисуется в DOM.
 *
 * ── Обратная совместимость ──────────────────────────────────────
 *
 * Этот же маршрут дёргают ещё две страницы — «Значки» и «Премиум», и обе
 * ждут голый массив (`.then(setUsers)`). Поэтому форма ответа зависит от
 * запроса: без параметров — старый массив целиком, с параметрами листания —
 * конверт `{ users, total, page, pages, perPage }`. Так новая страница пользователей
 * получает листы, а соседние два экрана продолжают работать без правок.
 */

/** Сколько пользователей на одном листе по умолчанию. */
export const USERS_PER_PAGE = 20;
/** Потолок размера листа: чтобы `?perPage=100000` не вернул всю таблицу. */
const MAX_PER_PAGE = 100;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // FIX-SEC-EXPOSURE: PII и детали бана (email, banReason, bannedUntil) видит
  // только ADMIN. EDITOR получает статус `banned` (для плашек в панели), но не
  // персональные данные и не внутренние причины/сроки бана.
  const isAdmin = session.user.role === "ADMIN";

  const select = {
    id: true,
    name: true,
    username: true,
    avatar: true,
    role: true,
    isPremium: true,
    /* VPN-PLAN: подписка «только VPN» — отдельное право, не часть Premium.
       Разделу «Подписки пользователей» нужны оба статуса сразу, иначе
       проверка «есть ли VPN» превращается в запрос на каждого человека.
       Это не PII: наличие подписки видно так же, как и флаг Premium. */
    vpnAccess: true,
    vpnAccessUntil: true,
    banned: true,
    lastSeen: true,
    createdAt: true,
    _count: { select: { messages: true } },
    ...(isAdmin ? { email: true, banReason: true, bannedUntil: true } : {}),
  };

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();

  /* Листание включается только явным параметром. См. комментарий о совместимости
     выше: старые вызовы без параметров обязаны получить ровно то же, что и раньше. */
  const paginated = searchParams.has("page") || searchParams.has("perPage") || searchParams.has("q");

  /* Поиск по имени и логину. Почта — только для ADMIN: иначе EDITOR, которому
     адреса не отдаются в ответе, смог бы вытащить их побуквенно подбором
     запросов — запрет на показ без запрета на поиск ничего не защищает. */
  const where = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { username: { contains: query, mode: "insensitive" as const } },
          ...(isAdmin ? [{ email: { contains: query, mode: "insensitive" as const } }] : []),
        ],
      }
    : {};

  if (!paginated) {
    const users = await prisma.user.findMany({
      select,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(users);
  }

  const perPageRaw = Number(searchParams.get("perPage"));
  const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0
    ? Math.min(Math.floor(perPageRaw), MAX_PER_PAGE)
    : USERS_PER_PAGE;

  const total = await prisma.user.count({ where });
  const pages = Math.max(1, Math.ceil(total / perPage));

  /* Номер листа зажимаем в границы УЖЕ после подсчёта. Случай из жизни:
     админ стоит на пятом листе и вводит поиск, под который подходят три
     человека. Без зажима он увидел бы пустой экран вместо найденного. */
  const pageRaw = Number(searchParams.get("page"));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(Math.floor(pageRaw), pages) : 1;

  const users = await prisma.user.findMany({
    where,
    select,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * perPage,
    take: perPage,
  });

  return NextResponse.json({ users, total, page, pages, perPage });
}
