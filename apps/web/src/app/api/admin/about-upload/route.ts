import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { sanitizeExtension, mediaSignatureError, validateImageFile } from "@/lib/fileValidation";

const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO = 200 * 1024 * 1024; // 200 MB

const ALLOWED_MEDIA = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const kind = (formData.get("kind") as string | null) ?? "media"; // "media" | "bg"

  if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

  const isVideo = file.type.startsWith("video/");
  const maxSize = isVideo ? MAX_VIDEO : MAX_IMAGE;

  if (file.size > maxSize) {
    return NextResponse.json({ error: `Файл слишком большой (макс. ${isVideo ? "200" : "10"} МБ)` }, { status: 400 });
  }
  if (!ALLOWED_MEDIA.includes(file.type)) {
    return NextResponse.json({ error: "Разрешены: PNG, JPG, WebP, GIF, MP4, WebM, MOV" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isVideo) {
    const err = mediaSignatureError(file.type, buffer);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  } else {
    const v = validateImageFile(buffer, file.type);
    if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const subdir = kind === "bg" ? "about-bg" : "about";
  const uploadDir = path.join(process.cwd(), "public", "uploads", subdir);
  await mkdir(uploadDir, { recursive: true });

  const ext = sanitizeExtension(file.name);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  return NextResponse.json({
    url: `/uploads/${subdir}/${filename}`,
    type: isVideo ? "video" : "image",
  });
}
