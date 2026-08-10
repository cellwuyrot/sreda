import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";

// FIX-CABINET: проекты личного кабинета.
// GET  /api/projects             — свои проекты (владелец)
// GET  /api/projects?scope=staff — все проекты (ADMIN | EDITOR): заявки на обработку
// POST /api/projects             — создать проект (CONSULTANT | ADMIN)
//
// STAGES: вместе с проектом отдаём его услугу с набором этапов. Отдельного
// запроса за услугой нет намеренно: список кабинета рисует полоску прогресса
// сразу для всех проектов, и по запросу на каждую карточку это был бы десяток
// обращений к серверу на одну загрузку страницы.

const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // не более 25 МБ на файл

/** Что нужно кабинету от услуги: название и её набор этапов. */
const SERVICE_SELECT = { id: true, title: true, icon: true, stages: true } as const;

type ProjectFile = { url: string; name: string; size: number };

function sanitizeFiles(raw: unknown): ProjectFile[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FILES) return null;
  const files: ProjectFile[] = [];
  for (const item of raw) {
    const f = item as Partial<ProjectFile> | null;
    const url = typeof f?.url === "string" ? f.url : "";
    const name = typeof f?.name === "string" ? f.name.slice(0, 180) : "";
    const size = Number(f?.size);
    if (!url.startsWith("/uploads/projects/") || url.includes("..")) return null;
    if (!name || !Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) return null;
    files.push({ url, name, size });
  }
  return files;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const isStaff = session.user.role === "ADMIN" || session.user.role === "EDITOR";
  const staffScope = searchParams.get("scope") === "staff" && isStaff;

  const projects = await prisma.partnerProject.findMany({
    where: staffScope ? {} : { ownerId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { id: true, name: true, username: true, avatar: true } },
      service: { select: SERVICE_SELECT },
    },
  });

  return NextResponse.json({ projects, isStaff });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "CONSULTANT" && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Личный кабинет доступен только партнёрам TrioZ" }, { status: 403 });
  }

  const data = await req.json().catch(() => null);
  const name = String(data?.name || "").trim();
  const purpose = String(data?.purpose || "").trim();
  const domain = String(data?.domain || "").trim();
  const serviceId = String(data?.serviceId || "").trim();
  const files = sanitizeFiles(data?.files);

  if (!name || !purpose) {
    return NextResponse.json({ error: "Название и назначение проекта обязательны" }, { status: 400 });
  }
  if (name.length > 120 || purpose.length > 2000 || domain.length > 120) {
    return NextResponse.json({ error: "Слишком длинное значение поля" }, { status: 400 });
  }
  if (!files) {
    return NextResponse.json({ error: "Некорректный список материалов (макс. 10 файлов по 25 МБ)" }, { status: 400 });
  }

  /* STAGES: услуга обязательна. Без неё неизвестно, по каким этапам вести
     работу, и проект показал бы заказчику этапы создания сайта независимо от
     того, что он заказал, — именно эту ошибку правка и убирает. */
  if (!serviceId) {
    return NextResponse.json({ error: "Выберите услугу" }, { status: 400 });
  }
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
  if (!service) {
    return NextResponse.json({ error: "Услуга не найдена" }, { status: 400 });
  }

  const project = await prisma.partnerProject.create({
    data: { ownerId: session.user.id, name, purpose, domain, files, stepsDone: [], serviceId: service.id },
    include: {
      owner: { select: { id: true, name: true, username: true, avatar: true } },
      service: { select: SERVICE_SELECT },
    },
  });

  // Заявка сразу появляется у администраторов и редакторов в /admin/projects.
  const staff = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "EDITOR"] } }, select: { id: true } });
  await Promise.allSettled(staff.map((u) => createNotification({
    userId: u.id,
    type: "project",
    title: "Новая заявка на проект",
    body: `${project.owner.name}: ${name}`,
    link: "/admin/projects",
  })));

  return NextResponse.json({ project }, { status: 201 });
}
