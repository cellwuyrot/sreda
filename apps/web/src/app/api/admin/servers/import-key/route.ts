import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { hashAgentToken } from "@/lib/serverMesh";
import { parseNodeKey } from "@/lib/nodeKey";

/**
 * NODE-KEY: добавление VPN-узла одной вставкой ключа.
 *
 * Почему отдельный маршрут, а не поле в общей форме узла. Создание узла по
 * ключу — это атомарная операция: адрес, публичный ключ, токен и одиннадцать
 * параметров маскировки имеют смысл только все вместе. Половина значений в базе
 * хуже, чем их отсутствие: узел появится в списке и начнёт выдавать профили,
 * которые не работают и не жалуются.
 *
 * Токен агента в открытом виде не хранится и не возвращается — только SHA-256,
 * как и у токенов, выданных самой панелью. Здесь он рождаётся на узле, а не в
 * панели: весь смысл ключа — один перенос вместо двух встречных.
 *
 * Повторная вставка ключа того же узла обновляет запись, а не создаёт вторую:
 * после переустановки узла (новый токен, тот же адрес) администратор должен
 * просто вставить новый ключ, а не искать и удалять старую карточку.
 */

const MAX_NAME = 60;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { key?: unknown; name?: unknown } | null;

  const parsed = parseNodeKey(body?.key);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const node = parsed.node;

  const endpointHost = `${node.host}:${node.port}`;

  /* Имя узла уникально в базе, поэтому по умолчанию берём адрес: два узла на
     одном адресе и порту — всё равно один узел. */
  const name =
    typeof body?.name === "string" && body.name.trim()
      ? sanitizeText(body.name).trim().slice(0, MAX_NAME)
      : `VPN ${node.host}`;

  /* Отчёт заполняется сразу, а не ждёт первого выхода агента на связь: иначе
     первая же попытка выдать профиль в ближайшую минуту оборвалась бы на
     отсутствии публичного ключа узла, хотя он есть и приехал в ключе. Агент
     перезапишет эту запись своим отчётом через минуту. */
  const seedReport = JSON.stringify({
    wgPublicKey: node.publicKey,
    endpoint: endpointHost,
    tool: "awg",
    peers: 0,
    source: "node-key",
  });

  const data = {
    role: "CHILD" as const,
    kind: "VPN" as const,
    endpointHost,
    transport: "OBFUSCATED" as const,
    obfuscation: JSON.stringify(node.awg),
    tokenHash: hashAgentToken(node.token),
    lastReport: seedReport,
    enabled: true,
  };

  const existing = await prisma.serverNode.findFirst({
    where: { kind: "VPN", endpointHost },
    select: { id: true, name: true },
  });

  try {
    const saved = existing
      ? await prisma.serverNode.update({ where: { id: existing.id }, data })
      : await prisma.serverNode.create({ data: { ...data, name } });

    return NextResponse.json({
      ok: true,
      created: !existing,
      node: {
        id: saved.id,
        name: saved.name,
        endpointHost: saved.endpointHost,
        transport: saved.transport,
        hasObfuscation: true,
        enabled: saved.enabled,
      },
    });
  } catch {
    /* Единственный ожидаемый отказ записи — совпадение имён. Подробности
       исключения наружу не отдаём: в них попадают имена полей базы. */
    return NextResponse.json(
      { error: "Узел с таким названием уже есть — укажите другое название" },
      { status: 409 },
    );
  }
}
