import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

/**
 * FIX-LINKSTATS: измерительная точка для окна соединения.
 *
 *  GET             — 204 без тела: замер задержки (пинг).
 *  GET ?size=N     — N байт балласта: замер скорости скачивания.
 *
 * Почему своя точка, а не сторонний сервис замера. Смысл показателей в том,
 * чтобы ответить на вопрос «мешает ли туннель работе», а для этого мерить надо
 * именно путь до нашего же сайта: чужой speedtest показал бы погоду до своего
 * ближайшего узла и ничего не сказал о нашем канале. К тому же внешние замеры
 * грузят сторонние домены в интерфейс мессенджера.
 *
 * Почему требуется вход и стоит лимит: отдача балласта — это бесплатный генератор
 * трафика. Без защиты такая точка — готовый инструмент вычерпать исходящий
 * канал сервера с чужой машины одной строкой в цикле.
 *
 * Балласт отдаётся потоком кусками по 64 КБ, а не одним буфером: иначе каждый
 * замер держал бы всё тело ответа в памяти процесса.
 */

export const dynamic = "force-dynamic";

/** Верхний предел балласта на один замер. */
const MAX_BYTES = 8_000_000;
const CHUNK_BYTES = 64 * 1024;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const size = Math.floor(Number(new URL(req.url).searchParams.get("size")) || 0);

  /* Пинг: ответ без тела. Лимит здесь не нужен и вреден: окно спрашивает
     раз в пять секунд, и отказ по лимиту выглядел бы как пропавшая связь. */
  if (size <= 0) {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  const limited = await rateLimit(req, "vpn-speedtest", { limit: 40, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const total = Math.min(size, MAX_BYTES);
  const chunk = new Uint8Array(CHUNK_BYTES);
  let sent = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const left = total - sent;
      controller.enqueue(left >= CHUNK_BYTES ? chunk : chunk.subarray(0, left));
      sent += Math.min(CHUNK_BYTES, left);
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(total),
      "Cache-Control": "no-store",
    },
  });
}
