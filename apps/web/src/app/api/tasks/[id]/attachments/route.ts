import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { validateImageMagicBytes } from "@/lib/fileValidation";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
/* FIX-JIMP: sharp → Jimp. */
import Jimp from "jimp";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
/* Приватные вложения лежат вне public/: см. lib/uploadPaths. */
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";

// FIX-A2: ADMIN был пропущен в списке ролей с правом редактирования.
const EDIT_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

// Images are compressed to WebP; everything else is stored verbatim, so the two
// size budgets mirror the message composer (10 MB) and the Docs channel (25 MB).
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_DOC_SIZE = 25 * 1024 * 1024;
// FIX-TASKVIDEO: короткие ролики к задаче. Лимит намеренно жёсткий (5 МБ) —
// файлы лежат на диске приложения и раздаются без транскодирования.
const MAX_VIDEO_SIZE = 5 * 1024 * 1024;
const COMPRESS_MAX = 1920;
const COMPRESS_QUALITY = 80;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOC_EXT = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "rtf", "odt", "ods", "zip",
];
// FIX-TASKVIDEO: видео раньше отклонялось как «недопустимый тип файла» —
// его не было ни здесь, ни в списке типов на клиенте.
const ALLOWED_VIDEO_EXT = ["mp4", "webm", "mov"];
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/**
 * FIX-TASKVIDEO: проверка сигнатуры контейнера — расширению верить нельзя.
 * MP4/MOV: бокс "ftyp" на 4-м байте. WebM: заголовок EBML (1A 45 DF A3).
 */
function isRealVideo(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 12) return false;
  if (ext === "webm") {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  return (
    buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
  );
}

const attachmentSelect = {
  id: true,
  name: true,
  url: true,
  mime: true,
  size: true,
  createdAt: true,
  uploader: { select: { id: true, name: true, username: true } },
} as const;

async function loadAndAuthorize(taskId: string, userId: string) {
  const task = await prisma.channelTask.findUnique({
    where: { id: taskId },
    select: { id: true, creatorId: true, assigneeId: true, channel: { select: { groupId: true } } },
  });
  if (!task) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: task.channel.groupId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const canManage =
    EDIT_ROLES.includes(membership.role) || task.creatorId === userId;
  return { task, membership, canManage };
}

// POST — upload a file (multipart: file) and attach it to the task.
// Any group member may attach, mirroring who can comment on a task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "task-attachments", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
  const origName = (file.name || "file").slice(0, 200);
  const ext = (origName.split(".").pop() || "").toLowerCase();
  const isVideo = !isImage && ALLOWED_VIDEO_EXT.includes(ext); // FIX-TASKVIDEO

  if (!isImage && !isVideo && !ALLOWED_DOC_EXT.includes(ext)) {
    return NextResponse.json({ error: "Недопустимый тип файла" }, { status: 400 });
  }

  const sizeLimit = isImage ? MAX_IMAGE_SIZE : isVideo ? MAX_VIDEO_SIZE : MAX_DOC_SIZE;
  if (file.size > sizeLimit) {
    const human = isImage
      ? "Изображение слишком большое (макс. 10 МБ)"
      : isVideo
        ? "Видео слишком большое (макс. 5 МБ)"
        : "Файл слишком большой (макс. 25 МБ)";
    return NextResponse.json({ error: human }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const uploadsDir = uploadDirRoot("tasks");
  await mkdir(uploadsDir, { recursive: true });

  const fileId = randomUUID();
  let fileName: string;
  let finalBuffer: Buffer;
  let mime: string;

  if (isImage) {
    if (!validateImageMagicBytes(buffer, file.type)) {
      return NextResponse.json({ error: "Содержимое файла не соответствует изображению" }, { status: 400 });
    }
    if (file.type === "image/gif") {
      // Keep GIFs verbatim so animation survives.
      fileName = `${fileId}.gif`;
      finalBuffer = buffer;
      mime = "image/gif";
    } else {
      /* FIX-JIMP: JPEG вместо WebP — Jimp 0.x не требует плагина. */
      fileName = `${fileId}.jpg`;
      const img = await Jimp.read(buffer);
      if (img.getWidth() > COMPRESS_MAX || img.getHeight() > COMPRESS_MAX) {
        img.scaleToFit(COMPRESS_MAX, COMPRESS_MAX);
      }
      img.quality(COMPRESS_QUALITY);
      finalBuffer = await img.getBufferAsync(Jimp.MIME_JPEG);
      mime = "image/jpeg";
    }
  } else if (isVideo) {
    // FIX-TASKVIDEO: сохраняем как есть (без перекодирования), но с проверкой
    // сигнатуры и серверным MIME — клиентскому file.type не доверяем.
    if (!isRealVideo(buffer, ext)) {
      return NextResponse.json({ error: "Содержимое файла не похоже на видео" }, { status: 400 });
    }
    fileName = `${fileId}.${ext}`;
    finalBuffer = buffer;
    mime = VIDEO_MIME[ext] || "video/mp4";
  } else {
    const safeExt = ext.replace(/[^a-z0-9]/gi, "");
    fileName = `${fileId}.${safeExt}`;
    finalBuffer = buffer;
    mime = file.type || "application/octet-stream";
  }

  await writeFile(path.join(uploadsDir, fileName), finalBuffer);
  const url = `/uploads/tasks/${fileName}`;

  /* Файл принадлежит задаче, а право на неё считается по каналу задачи —
     выдача спросит то же самое (см. lib/uploadAccess). */
  await recordUpload({ path: `tasks/${fileName}`, uploaderId: session.user.id, taskId: id });

  const attachment = await prisma.taskAttachment.create({
    data: {
      taskId: id,
      uploaderId: session.user.id,
      name: origName,
      url,
      mime,
      size: finalBuffer.length,
    },
    select: attachmentSelect,
  });

  return NextResponse.json({ attachment }, { status: 201 });
}

// DELETE — remove an attachment (?attachmentId=). The uploader, the task
// creator and group moderators/owners may delete.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;

  const attachmentId = req.nextUrl.searchParams.get("attachmentId");
  if (!attachmentId) return NextResponse.json({ error: "attachmentId required" }, { status: 400 });

  const existing = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    select: { taskId: true, uploaderId: true },
  });
  if (!existing || existing.taskId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.uploaderId !== session.user.id && !auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.taskAttachment.delete({ where: { id: attachmentId } });
  return NextResponse.json({ ok: true });
}
