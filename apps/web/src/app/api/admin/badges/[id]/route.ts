import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const formData = await req.formData();

  const data: Record<string, unknown> = {};

  const name = formData.get("name") as string | null;
  const description = formData.get("description") as string | null;
  const icon = formData.get("icon") as string | null;
  const rarity = formData.get("rarity") as string | null;
  const active = formData.get("active") as string | null;
  const imageFile = formData.get("image") as File | null;

  if (name) data.name = name;
  if (description) data.description = description;
  if (icon !== null) data.icon = icon || null;
  if (rarity) data.rarity = rarity;
  if (active !== null) data.active = active === "true";

  if (imageFile && imageFile.size > 0) {
    if (imageFile.size > 512 * 1024) {
      return NextResponse.json({ error: "Image must be under 512KB" }, { status: 400 });
    }
    const buffer = Buffer.from(await imageFile.arrayBuffer());
    // FIX-SEC-UPLOAD: валидируем сигнатуру и тип (см. POST) — без этого можно
    // было залить SVG/полиглот с <script> под видом картинки (stored XSS).
    const validation = validateImageFile(buffer, imageFile.type);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const ext = sanitizeExtension(imageFile.name);
    const filename = `badge-${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), "public/uploads/badges");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    data.imageUrl = `/uploads/badges/${filename}`;
  }

  const badge = await prisma.badge.update({ where: { id }, data });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "Badge",
    targetId: id,
    details: `Редактирование бейджа "${badge.name}"`,
  });

  return NextResponse.json(badge);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const badge = await prisma.badge.findUnique({ where: { id } });
  await prisma.badge.delete({ where: { id } });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "delete",
    target: "Badge",
    targetId: id,
    details: `Удаление бейджа "${badge?.name || id}"`,
  });

  return NextResponse.json({ ok: true });
}
