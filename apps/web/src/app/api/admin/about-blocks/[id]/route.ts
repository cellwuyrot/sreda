import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const block = await prisma.aboutBlock.update({
    where: { id: params.id },
    data: {
      title: body.title,
      description: body.description,
      mediaUrl: body.mediaUrl,
      mediaType: body.mediaType,
      layout: body.layout,
      textAlign: body.textAlign,
      glowColor: body.glowColor,
      shape: body.shape,
      spacingTop: body.spacingTop,
      enabled: body.enabled,
    },
  });
  return NextResponse.json(block);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.aboutBlock.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
