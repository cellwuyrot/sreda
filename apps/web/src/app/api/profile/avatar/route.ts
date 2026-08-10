import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";
import { getIO } from "@/lib/socketEmit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const uploadType = (formData.get("type") as string) || "avatar";
  const file = (formData.get("file") as File) || (formData.get("avatar") as File);

  if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  const maxSize = uploadType === "banner" ? 10 * 1024 * 1024 : 3 * 1024 * 1024;
  if (file.size > maxSize)
    return NextResponse.json({ error: `Файл слишком большой (макс. ${uploadType === "banner" ? "10MB" : "3MB"})` }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // FIX-SEC-UPLOAD: валидируем сигнатуру ВСЕГДА. Раньше для GIF-баннеров проверка
  // пропускалась (можно было загрузить полиглот GIF+HTML/SVG). validateImageFile
  // штатно поддерживает GIF (GIF87a/GIF89a), так что легитимные гифки проходят.
  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const subDir = uploadType === "banner" ? "banners" : "avatars";
  const uploadDir = path.join(process.cwd(), "public", "uploads", subDir);
  await mkdir(uploadDir, { recursive: true });

  const ext = sanitizeExtension(file.name);
  const filename = `${session.user.id}-${Date.now()}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  const url = `/uploads/${subDir}/${filename}`;

  if (uploadType === "banner") {
    return NextResponse.json({ url });
  }

  const avatar = url;
  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { avatar },
    select: { id: true, avatar: true, avatarGlowEnabled: true, avatarGlowColors: true },
  });

  const io = getIO();
  if (io) io.emit("profile-updated", updated);

  return NextResponse.json({ avatar });
}
