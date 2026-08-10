import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const items = await prisma.ecosystemItem.findMany({
    where: { active: true },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { title, description, imageUrl, linkUrl, section, order } = await req.json();
  if (!title || !description || !section) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const item = await prisma.ecosystemItem.create({
    data: { title, description, imageUrl, linkUrl, section, order: order || 0 },
  });

  return NextResponse.json(item);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, title, description, imageUrl, linkUrl, section, order, active } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const item = await prisma.ecosystemItem.update({
    where: { id },
    data: { title, description, imageUrl, linkUrl, section, order, active },
  });

  return NextResponse.json(item);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.ecosystemItem.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
