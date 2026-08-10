import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";

export async function GET() {
  const configs = await prisma.siteConfig.findMany({
    where: { key: { startsWith: "content:" } },
  });

  const result: Record<string, string> = {};
  for (const c of configs) {
    result[c.key.replace("content:", "")] = c.value;
  }

  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await req.json();
  if (key) {
    await prisma.siteConfig.deleteMany({ where: { key: `content:${key}` } });
  } else {
    await prisma.siteConfig.deleteMany({ where: { key: { startsWith: "content:" } } });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key, value } = await req.json();
  if (!key || !value) {
    return NextResponse.json({ error: "Key and value required" }, { status: 400 });
  }

  const dbKey = `content:${key}`;

  await prisma.siteConfig.upsert({
    where: { key: dbKey },
    update: { value },
    create: { key: dbKey, value },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "SiteContent",
    targetId: key,
    details: `Изменение контента "${key}"`,
  });

  return NextResponse.json({ ok: true });
}
