import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const badges = await prisma.badge.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(badges);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const formData = await req.formData();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const icon = formData.get("icon") as string | null;
  const rarity = (formData.get("rarity") as string) || "common";
  const imageFile = formData.get("image") as File | null;

  if (!name || !description) {
    return NextResponse.json({ error: "Name and description required" }, { status: 400 });
  }

  let imageUrl: string | null = null;

  if (imageFile && imageFile.size > 0) {
    if (imageFile.size > 512 * 1024) {
      return NextResponse.json({ error: "Image must be under 512KB" }, { status: 400 });
    }

    const buffer = Buffer.from(await imageFile.arrayBuffer());
    // FIX-SEC-UPLOAD: проверяем реальную сигнатуру (magic bytes) и тип — иначе
    // можно было загрузить SVG/полиглот с <script> под видом image/webp и
    // получить его обратно как исполняемый контент (stored XSS). validateImageFile
    // допускает только png/jpeg/webp/gif; SVG отклоняется.
    const validation = validateImageFile(buffer, imageFile.type);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const ext = sanitizeExtension(imageFile.name);
    const filename = `badge-${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), "public/uploads/badges");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    imageUrl = `/uploads/badges/${filename}`;
  }

  const badge = await prisma.badge.create({
    data: { name, description, icon: icon || null, imageUrl, rarity },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "create",
    target: "Badge",
    targetId: badge.id,
    details: `Создание бейджа "${name}"`,
  });

  return NextResponse.json(badge, { status: 201 });
}
