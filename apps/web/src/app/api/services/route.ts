import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncServicesToMainCommunity } from "@/lib/mainCommunity";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = (session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR");
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "true";

  const services = await prisma.service.findMany({
    // Admins requesting all=true see everything; public sees only active
    where: isAdmin && all ? {} : { active: true },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(services);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { title, description, icon, order } = await req.json();
  if (!title || !description) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const service = await prisma.service.create({
    data: { title, description, icon, order: order || 0 },
  });

  // Sync to main community
  syncServicesToMainCommunity().catch(() => {});

  return NextResponse.json(service);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, title, description, icon, order, active } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const service = await prisma.service.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(icon !== undefined && { icon }),
      ...(order !== undefined && { order }),
      ...(active !== undefined && { active }),
    },
  });

  // Sync to main community
  syncServicesToMainCommunity().catch(() => {});

  return NextResponse.json(service);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  await prisma.service.delete({ where: { id } });

  // Sync to main community (removes orphaned channels)
  syncServicesToMainCommunity().catch(() => {});

  return NextResponse.json({ success: true });
}
