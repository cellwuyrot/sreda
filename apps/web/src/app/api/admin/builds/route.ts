import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isBuildTarget, isTerminal, normalizeRef, queueRefusal, staleJobs } from "@/lib/builds";

/**
 * BUILDS: очередь сборок глазами администратора.
 *
 * Только ADMIN. Сборка выполняется на сервере, из кода репозитория, и её
 * результат раздаётся всем — это распоряжение выпуском, а не правка содержимого.
 *
 * Здесь нет ни одного действия, которое что-то запускает прямо сейчас: маршрут
 * только ставит запись в очередь. Работу делает агент (`apps/builder`), и это
 * не деталь реализации, а условие живучести: сборка идёт минуты и переживает
 * перезапуск приложения только потому, что живёт в другом процессе.
 */

const LIST_LIMIT = 20;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

/** Журнал целиком в список не отдаём: он бывает в десятки килобайт на задачу. */
function publicJob(job: {
  id: string;
  target: string;
  status: string;
  ref: string;
  version: string;
  artifacts: string;
  error: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}) {
  return {
    id: job.id,
    target: job.target,
    status: job.status,
    ref: job.ref,
    version: job.version,
    artifacts: job.artifacts ? job.artifacts.split(",").filter(Boolean) : [],
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/**
 * Закрыть задачи, которые агент взял и бросил.
 *
 * Делается при каждом просмотре списка, а не отдельной задачей по расписанию:
 * зависшая сборка — редкость, а лишняя служба, которую надо не забыть завести
 * на новом сервере, — постоянный источник «почему не работает».
 */
async function closeStale() {
  const running = await prisma.buildJob.findMany({ where: { status: "RUNNING" } });
  const stale = staleJobs(Array.isArray(running) ? running : [], Date.now());
  for (const job of stale) {
    await prisma.buildJob
      .update({
        where: { id: job.id },
        data: { status: "FAILED", error: "Агент сборки перестал отвечать", finishedAt: new Date() },
      })
      .catch(() => null);
  }
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await closeStale();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  /* Запрос одной задачи — это просмотр журнала. Отдельным адресом, потому что
     журнал тяжёлый и в списке он не нужен. */
  if (id) {
    const job = await prisma.buildJob.findUnique({ where: { id } });
    if (!job) return NextResponse.json({ error: "Сборка не найдена" }, { status: 404 });
    return NextResponse.json({ job: { ...publicJob(job), log: job.log } });
  }

  const [jobs, agent] = await Promise.all([
    prisma.buildJob.findMany({ orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
    prisma.serverNode.findFirst({
      where: { kind: "BUILD", enabled: true },
      select: { name: true, lastSeenAt: true },
    }),
  ]);

  return NextResponse.json({
    jobs: (Array.isArray(jobs) ? jobs : []).map(publicJob),
    /* Без агента очередь просто копится. Панель должна говорить об этом сразу,
       а не оставлять человека наедине с задачей в статусе «ожидает». */
    agent: agent ? { name: agent.name, lastSeenAt: agent.lastSeenAt } : null,
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { target?: unknown; ref?: unknown } | null;

  if (!isBuildTarget(body?.target)) {
    return NextResponse.json({ error: "Укажите, что собираем" }, { status: 400 });
  }

  const ref = normalizeRef(body?.ref);
  if (ref === null) {
    return NextResponse.json({ error: "Недопустимое имя ветки или коммита" }, { status: 400 });
  }

  await closeStale();

  const active = await prisma.buildJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
  const refusal = queueRefusal(Array.isArray(active) ? active : [], body.target);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  const job = await prisma.buildJob.create({
    data: { target: body.target, ref, requestedById: admin.id, status: "QUEUED" },
  });

  return NextResponse.json({ job: publicJob(job) });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указана сборка" }, { status: 400 });
  if (body?.action !== "cancel") return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });

  const job = await prisma.buildJob.findUnique({ where: { id }, select: { status: true } });
  if (!job) return NextResponse.json({ error: "Сборка не найдена" }, { status: 404 });
  if (isTerminal(job.status)) {
    return NextResponse.json({ error: "Сборка уже завершена" }, { status: 409 });
  }

  /* Отмена ждущей задачи — мгновенная. Отмена ИДУЩЕЙ помечает её отменённой, но
     процесс на агенте продолжает работать до конца: убивать сборку на середине
     нечем — у нас нет обратного канала к агенту, связь односторонняя. Агент
     увидит отмену при следующем обращении и просто выбросит результат. */
  const updated = await prisma.buildJob.update({
    where: { id },
    data: { status: "CANCELED", finishedAt: new Date(), error: "Отменена администратором" },
  });

  return NextResponse.json({ job: publicJob(updated) });
}
