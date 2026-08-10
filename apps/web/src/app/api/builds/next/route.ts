import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { findNodeByToken } from "@/lib/serverMesh";
import { nextJob, staleJobs } from "@/lib/builds";

/**
 * BUILDS: агент спрашивает, есть ли работа.
 *
 * Та же модель, что у VPN-узла, — «на вытягивание». Агент сам приходит с
 * токеном, а мы к нему не обращаемся никогда. Здесь это важно по другой
 * причине, чем у VPN: агент сборки обычно работает на самом главном сервере, и
 * входящий порт ему открывать было бы просто незачем.
 *
 * Ответ `{ job: null }` — обычное состояние: очередь пуста или сборка уже идёт.
 */

export async function POST(req: Request) {
  const node = await findNodeByToken(req.headers.get("authorization"));
  if (!node) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (node.kind !== "BUILD") {
    /* Токен VPN-узла не должен открывать сборку: у этих ролей разные права на
       машину, и путать их нельзя даже случайно. */
    return NextResponse.json({ error: "Узел не назначен сборщиком" }, { status: 403 });
  }

  const now = new Date();
  await prisma.serverNode.update({ where: { id: node.id }, data: { lastSeenAt: now } }).catch(() => null);

  const active = await prisma.buildJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
  const jobs = Array.isArray(active) ? active : [];

  // Брошенные задачи закрываем здесь же: иначе они держали бы очередь.
  for (const job of staleJobs(jobs, now.getTime())) {
    await prisma.buildJob
      .update({
        where: { id: job.id },
        data: { status: "FAILED", error: "Агент сборки перестал отвечать", finishedAt: now },
      })
      .catch(() => null);
  }

  const chosen = nextJob(jobs, now.getTime());
  if (!chosen) return NextResponse.json({ job: null });

  /* Берём задачу условным обновлением: `status: "QUEUED"` в условии — это
     защита от двух агентов, начавших одну и ту же сборку. Второй получит ноль
     изменённых строк и уйдёт ни с чем, а не станет собирать параллельно. */
  const claimed = await prisma.buildJob.updateMany({
    where: { id: chosen.id, status: "QUEUED" },
    data: { status: "RUNNING", nodeId: node.id, startedAt: now, heartbeatAt: now },
  });
  if (!claimed?.count) return NextResponse.json({ job: null });

  const job = await prisma.buildJob.findUnique({ where: { id: chosen.id } });
  return NextResponse.json({
    job: job ? { id: job.id, target: job.target, ref: job.ref } : null,
  });
}
