import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/** PUT /api/admin/about-blocks/[id] — обновить блок */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const block = await prisma.aboutBlock.update({
      where: { id },
      data: {
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
    return NextResponse.json(block);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** DELETE /api/admin/about-blocks/[id] — удалить блок */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await prisma.aboutBlock.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
