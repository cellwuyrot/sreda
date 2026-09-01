import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/** GET /api/admin/about-blocks — список всех блоков, отсортированный по order */
export async function GET() {
  const blocks = await prisma.aboutBlock.findMany({
    orderBy: { order: "asc" },
  });
  return NextResponse.json(blocks);
}

/** POST /api/admin/about-blocks — создать блок (порядковый номер = конец списка) */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  const last = await prisma.aboutBlock.findFirst({ orderBy: { order: "desc" } });
  const nextOrder = (last?.order ?? -1) + 1;

  const block = await prisma.aboutBlock.create({
    data: {
      order:       nextOrder,
      title:       body.title       ?? "",
      description: body.description ?? "",
      mediaUrl:    body.mediaUrl    ?? null,
      mediaType:   body.mediaType   ?? "image",
      layout:      body.layout      ?? "text-left",
      textAlign:   body.textAlign   ?? "left",
      glowColor:   body.glowColor   ?? "#8b5cf6",
      shape:       body.shape       ?? "rectangle",
      spacingTop:  body.spacingTop  ?? 60,
      enabled:     body.enabled     ?? true,
    },
  });

  return NextResponse.json(block, { status: 201 });
}

/**
 * PATCH /api/admin/about-blocks
 * Bulk reorder: body = Array<{ id: string; order: number }>
 */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items: Array<{ id: string; order: number }> = await req.json();

  await Promise.all(
    items.map((item) =>
      prisma.aboutBlock.update({
        where: { id: item.id },
        data:  { order: item.order },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
