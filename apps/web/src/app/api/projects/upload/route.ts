import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
/* Приватные вложения лежат вне public/: см. lib/uploadPaths. */
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";

// FIX-CABINET: загрузка материалов проекта для личного кабинета.
// Ограничение по ТЗ раздела «Мои проекты» — не более 25 МБ на файл.

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const ALLOWED_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"],
  ["application/pdf", "pdf"], ["text/plain", "txt"], ["text/csv", "csv"], ["application/json", "json"],
  ["application/zip", "zip"], ["application/x-7z-compressed", "7z"],
  ["application/msword", "doc"], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"], ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"], ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["video/mp4", "mp4"], ["video/webm", "webm"], ["audio/mpeg", "mp3"],
  ["image/vnd.adobe.photoshop", "psd"],
]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = session.user.role;
  if (role !== "CONSULTANT" && role !== "ADMIN" && role !== "EDITOR") {
    return NextResponse.json({ error: "Загрузка материалов доступна только в личном кабинете" }, { status: 403 });
  }

  const limited = await rateLimit(req, `project-upload:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

    const ext = ALLOWED_TYPES.get(file.type);
    if (!ext) return NextResponse.json({ error: "Этот тип файла не поддерживается" }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Файл слишком большой (макс. 25 МБ)" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadsDir = uploadDirRoot("projects");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${uuid()}.${ext}`;
    await writeFile(path.join(uploadsDir, fileName), buffer, { flag: "wx" });

    /* У материала проекта нет ни канала, ни беседы: его видит только тот, кто
       загрузил (см. lib/uploadAccess). */
    await recordUpload({ path: `projects/${fileName}`, uploaderId: session.user.id });

    return NextResponse.json({
      url: `/uploads/projects/${fileName}`,
      name: file.name.slice(0, 180),
      size: buffer.length,
      type: file.type,
    });
  } catch (error) {
    console.error("[ProjectUpload] Error:", error);
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
