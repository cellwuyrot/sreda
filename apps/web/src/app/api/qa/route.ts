import { NextRequest, NextResponse } from "next/server";


import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { getChannelPermissions } from "@/lib/connectPermissions"; // FIX-QAACL









// GET /api/qa?channelId=...&sort=new|top&status=all|open|resolved
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  const sort = searchParams.get("sort") || "new";
  const status = searchParams.get("status") || "all";
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  // FIX-QAACL: единая проверка прав вместо «просто участник группы» — та же
  // функция решает, кто видит раздел, кто спрашивает и кто отвечает.
  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!perm.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const where: { channelId: string; status?: string } = { channelId };
  if (status === "open") where.status = "OPEN";
  if (status === "resolved") where.status = "RESOLVED";

  const threads = await prisma.qAThread.findMany({
    where,
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      _count: { select: { answers: true, votes: true } },
    },
    orderBy: sort === "top" ? { votes: { _count: "desc" } } : { createdAt: "desc" },
    take: 100,
  });

  // Клиент прячет кнопку «Задать вопрос» и форму ответа, когда прав нет;
  // сами запросы всё равно проверяются на сервере ниже.
  return NextResponse.json({
    threads,
    permissions: { canAsk: perm.canAsk, canAnswer: perm.canAnswer, canModerate: perm.canModerate },
  });
}

// POST /api/qa  { channelId, title, body, tags }
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "qa", { limit: 20, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { channelId, title, body, tags } = await req.json();
  if (!channelId || !title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (title.length > 200) return NextResponse.json({ error: "Title too long" }, { status: 400 });
  if (body.length > 8000) return NextResponse.json({ error: "Body too long" }, { status: 400 });

  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (perm.channelType !== "QA") return NextResponse.json({ error: "Not a Q&A channel" }, { status: 400 });
  if (!perm.canView) return NextResponse.json({ error: perm.denialReason || "Forbidden" }, { status: 403 });
  // FIX-QAACL: право задавать вопросы настраивается шестерёнкой раздела и
  // может быть выдано по тегам участника.
  if (!perm.canAsk) {
    return NextResponse.json({ error: "В этом разделе вам недоступно создание вопросов" }, { status: 403 });
  }

  const thread = await prisma.qAThread.create({
    data: {
      channelId,
      authorId: session.user.id,
      title: sanitizeText(title),
      body: sanitizeText(body),
      tags: typeof tags === "string" ? tags.slice(0, 200) : "",
    },
    include: { author: { select: { id: true, name: true, username: true, avatar: true } }, _count: { select: { answers: true, votes: true } } },
  });

  return NextResponse.json({ thread });
}