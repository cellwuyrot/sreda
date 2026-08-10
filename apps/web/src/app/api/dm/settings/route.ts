import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";

// FIX-DM: настройки личных сообщений по отношению к конкретному пользователю —
// чёрный список, запрет голосовых сообщений и автоответ.

const DEFAULTS = { blacklisted: false, voiceBan: false, autoReplyEnabled: false, autoReplyText: "" };

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetId = new URL(req.url).searchParams.get("targetId");
  if (!targetId) return NextResponse.json({ error: "targetId required" }, { status: 400 });

  try {
    const s = await prisma.dmUserSetting.findUnique({
      where: { ownerId_targetId: { ownerId: session.user.id, targetId } },
    });
    if (!s) return NextResponse.json(DEFAULTS);
    return NextResponse.json({
      blacklisted: s.blacklisted,
      voiceBan: s.voiceBan,
      autoReplyEnabled: s.autoReplyEnabled,
      autoReplyText: s.autoReplyText ?? "",
    });
  } catch {
    // Таблица ещё не создана (миграция не применена) — не ломаем чат.
    return NextResponse.json(DEFAULTS);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const targetId = typeof body.targetId === "string" ? body.targetId : null;
  if (!targetId) return NextResponse.json({ error: "targetId required" }, { status: 400 });
  if (targetId === session.user.id) return NextResponse.json({ error: "Нельзя настроить самого себя" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  const data: {
    blacklisted?: boolean;
    voiceBan?: boolean;
    autoReplyEnabled?: boolean;
    autoReplyText?: string | null;
  } = {};
  if (typeof body.blacklisted === "boolean") data.blacklisted = body.blacklisted;
  if (typeof body.voiceBan === "boolean") data.voiceBan = body.voiceBan;
  if (typeof body.autoReplyEnabled === "boolean") data.autoReplyEnabled = body.autoReplyEnabled;
  if (typeof body.autoReplyText === "string") {
    const text = sanitizeText(body.autoReplyText).slice(0, 500);
    data.autoReplyText = text || null;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const s = await prisma.dmUserSetting.upsert({
      where: { ownerId_targetId: { ownerId: session.user.id, targetId } },
      create: { ownerId: session.user.id, targetId, ...data },
      update: data,
    });
    return NextResponse.json({
      blacklisted: s.blacklisted,
      voiceBan: s.voiceBan,
      autoReplyEnabled: s.autoReplyEnabled,
      autoReplyText: s.autoReplyText ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Настройки недоступны — примените миграцию БД (npx prisma db push)" }, { status: 503 });
  }
}
