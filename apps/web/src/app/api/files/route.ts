import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { validateImageFile } from "@/lib/fileValidation";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXT = ["docx","doc","pdf","xlsx","xls","pptx","ppt","txt","csv","rtf","odt","ods","png","jpg","jpeg","webp","gif","zip"];

// FIX-SEC-UPLOAD: MIME определяется сервером по расширению, а не берётся из
// клиентского file.type (иначе .html с заявленным text/html при отдаче мог бы
// рендериться в браузере → stored XSS). Неизвестное → octet-stream (скачивание).
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  zip: "application/zip",
};
// Расширения-картинки, для которых проверяем сигнатуру файла.
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

// GET /api/files?channelId=...
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  /* FIX-SEC-ACL: проверялось только членство в сообществе. Канал же бывает
     скрытым, ограниченным по ролям или закрытым на чтение — и тогда список
     документов недоступного канала (имена и прямые ссылки на файлы) отдавался
     любому участнику сообщества. Считаем права канала, как везде. */
  const permissions = await getChannelPermissions(session.user.id, channelId);
  if (!permissions) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!permissions.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const files = await prisma.workspaceFile.findMany({
    where: { channelId },
    select: {
      id: true, name: true, url: true, mime: true, size: true, createdAt: true,
      uploader: { select: { id: true, name: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const isSiteAdmin = session.user.role === "ADMIN";
  const canEdit = permissions.canModerate || isSiteAdmin;
  /* FIX-DOCSGEAR: право открыть настройки раздела. В остальных модулях
     (новости, вопросы-ответы) шестерёнку показывает признак модерации, а
     «Документы» его просто не получали — отсюда и отсутствие шестерёнки при
     наличии самой страницы настроек. Владелец, админ сообщества и модератор,
     плюс администратор сайта. */
  const canModerate = permissions.canModerate || isSiteAdmin;
  return NextResponse.json({ files, canEdit, canModerate, currentUserId: session.user.id });
}

// POST /api/files  (multipart: file, channelId)
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "files", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const channelId = form.get("channelId") as string | null;
  if (!file || !channelId) return NextResponse.json({ error: "Missing file or channelId" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Файл слишком большой (макс. 25 МБ)" }, { status: 400 });

  const origName = (file.name || "file").slice(0, 200);
  const ext = (origName.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ error: "Недопустимый тип файла" }, { status: 400 });

  const permissions = await getChannelPermissions(session.user.id, channelId);
  if (!permissions) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (permissions.channelType !== "DOCS") return NextResponse.json({ error: "Not a Docs channel" }, { status: 400 });
  if (!permissions.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!permissions.canModerate && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "No upload permission" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // FIX-SEC-UPLOAD: для картинок проверяем реальную сигнатуру файла (magic
  // bytes) — нельзя залить полиглот/подделку под видом png/gif/webp/jpg.
  if (IMAGE_MIME[ext]) {
    const v = validateImageFile(buffer, IMAGE_MIME[ext]);
    if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 });
  }

  /* Документы канала — приватный каталог: лежит вне public/ и отдаётся только
     вошедшему пользователю (см. lib/uploadPaths). */
  const uploadsDir = uploadDirRoot("documents");
  await mkdir(uploadsDir, { recursive: true });
  const fileId = randomUUID();
  const fileName = fileId + "." + ext;
  await writeFile(path.join(uploadsDir, fileName), buffer);
  const url = "/uploads/documents/" + fileName;

  /* Документ принадлежит каналу — по этой строке выдача проверит право на него. */
  await recordUpload({ path: `documents/${fileName}`, uploaderId: session.user.id, channelId });

  const record = await prisma.workspaceFile.create({
    data: {
      channelId,
      uploaderId: session.user.id,
      name: origName,
      url,
      // FIX-SEC-UPLOAD: серверный MIME по расширению, не клиентский file.type.
      mime: MIME_BY_EXT[ext] || "application/octet-stream",
      size: buffer.length,
    },
    select: {
      id: true, name: true, url: true, mime: true, size: true, createdAt: true,
      uploader: { select: { id: true, name: true, username: true } },
    },
  });
  return NextResponse.json({ file: record });
}
