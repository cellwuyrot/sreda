import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { normalizeDomain } from "@/lib/emailWhitelist";

/* MAIL-WHITELIST: таблица разрешённых почтовых доменов.

   Раздел «Сервисы и система» → «Белые списки». Правки доступны только
   администратору: списком решается, кто вообще может завести учётную запись,
   и редактору такое решение не принадлежит. Каждое изменение попадает в
   журнал действий — иначе внезапно закрытая регистрация выглядит поломкой. */

const PER_PAGE = 10;
const NOTE_MAX = 80;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);

  const where = query
    ? {
        OR: [
          { domain: { contains: query, mode: "insensitive" as const } },
          { note: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.emailDomainWhitelist.count({ where }),
    prisma.emailDomainWhitelist.findMany({
      where,
      orderBy: { domain: "asc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);

  return NextResponse.json({
    rows,
    total,
    page,
    perPage: PER_PAGE,
    pages: Math.max(1, Math.ceil(total / PER_PAGE)),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const body = await req.json().catch(() => ({}));
  const domain = normalizeDomain(String(body?.domain ?? ""));
  if (!domain) {
    return NextResponse.json({ error: "Укажите домен, например gmail.com" }, { status: 400 });
  }
  const note = String(body?.note ?? "").trim().slice(0, NOTE_MAX);

  const existing = await prisma.emailDomainWhitelist.findUnique({ where: { domain } });
  if (existing) {
    return NextResponse.json({ error: "Этот домен уже в списке" }, { status: 409 });
  }

  const row = await prisma.emailDomainWhitelist.create({
    data: { domain, note, active: true, createdById: session.user.id },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username ?? session.user.email ?? "admin",
    action: "WHITELIST_ADD",
    target: "EmailDomainWhitelist",
    targetId: row.id,
    details: domain,
  });

  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "Не указана запись" }, { status: 400 });

  const current = await prisma.emailDomainWhitelist.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });

  const data: { domain?: string; note?: string; active?: boolean } = {};

  if (body?.domain !== undefined) {
    const domain = normalizeDomain(String(body.domain));
    if (!domain) return NextResponse.json({ error: "Некорректный домен" }, { status: 400 });
    if (domain !== current.domain) {
      const clash = await prisma.emailDomainWhitelist.findUnique({ where: { domain } });
      if (clash) return NextResponse.json({ error: "Этот домен уже в списке" }, { status: 409 });
      data.domain = domain;
    }
  }
  if (body?.note !== undefined) data.note = String(body.note).trim().slice(0, NOTE_MAX);
  if (body?.active !== undefined) data.active = !!body.active;

  if (Object.keys(data).length === 0) return NextResponse.json(current);

  const row = await prisma.emailDomainWhitelist.update({ where: { id }, data });

  await logAction({
    userId: session.user.id,
    username: session.user.username ?? session.user.email ?? "admin",
    action: "WHITELIST_EDIT",
    target: "EmailDomainWhitelist",
    targetId: row.id,
    details: `${current.domain} → ${row.domain}${row.active ? "" : " (выключен)"}`,
  });

  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Не указана запись" }, { status: 400 });

  const current = await prisma.emailDomainWhitelist.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });

  await prisma.emailDomainWhitelist.delete({ where: { id } });

  await logAction({
    userId: session.user.id,
    username: session.user.username ?? session.user.email ?? "admin",
    action: "WHITELIST_REMOVE",
    target: "EmailDomainWhitelist",
    targetId: id,
    details: current.domain,
  });

  return NextResponse.json({ ok: true });
}
