import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { findNodeByToken } from "@/lib/serverMesh";
import { appendLog, isBuildStatus, isTerminal, normalizeArtifacts, normalizeVersion } from "@/lib/builds";

/**
 * BUILDS: агент докладывает о ходе и результате сборки.
 *
 * Один адрес на три вещи, которые агент делает по ходу работы:
 *
 *   • «я жив» — иначе через полчаса молчания задача считается брошенной;
 *   • кусок журнала — чтобы в панели было видно, на чём стоим;
 *   • итог — успех с именами файлов или отказ с причиной.
 *
 * Журнал приходит кусками, а не целиком в конце: у сборки, которая идёт десять
 * минут, единственный способ понять, что она не встала, — смотреть журнал по
 * мере появления.
 */

const MAX_CHUNK = 16 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const node = await findNodeByToken(req.headers.get("authorization"));
  if (!node) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (node.kind !== "BUILD") return NextResponse.json({ error: "Узел не назначен сборщиком" }, { status: 403 });

  const { id } = await params;
  const job = await prisma.buildJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Сборка не найдена" }, { status: 404 });

  /* Чужую задачу трогать нельзя: агентов может быть несколько, и доклад одного
     о работе другого — это либо ошибка настройки, либо чужой токен. */
  if (job.nodeId && job.nodeId !== node.id) {
    return NextResponse.json({ error: "Сборка занята другим агентом" }, { status: 409 });
  }

  /* Задача уже закрыта — например, отменена администратором. Отвечаем об этом
     прямо: агент по этому ответу прекращает работу сам. Обратного канала к
     нему нет, и это единственный способ до него достучаться. */
  if (isTerminal(job.status)) {
    return NextResponse.json({ ok: false, canceled: true, status: job.status });
  }

  const body = (await req.json().catch(() => null)) as
    | { log?: unknown; status?: unknown; version?: unknown; artifacts?: unknown; error?: unknown }
    | null;

  const data: Record<string, unknown> = { heartbeatAt: new Date() };

  if (typeof body?.log === "string" && body.log) {
    data.log = appendLog(job.log, body.log.slice(0, MAX_CHUNK));
  }
  if (typeof body?.version === "string") {
    const version = normalizeVersion(body.version);
    if (version) data.version = version;
  }

  if (body?.status !== undefined) {
    if (!isBuildStatus(body.status) || (body.status !== "SUCCESS" && body.status !== "FAILED")) {
      return NextResponse.json({ error: "Агент сообщает только успех или отказ" }, { status: 400 });
    }
    data.status = body.status;
    data.finishedAt = new Date();
    data.artifacts = normalizeArtifacts(body.artifacts).join(",");
    data.error =
      body.status === "FAILED"
        ? (typeof body.error === "string" ? body.error : "").slice(0, 300) || "Сборка завершилась с ошибкой"
        : "";
  }

  const updated = await prisma.buildJob.update({ where: { id }, data });
  return NextResponse.json({ ok: true, status: updated.status });
}
