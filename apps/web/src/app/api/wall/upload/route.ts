import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { mediaSignatureError, validateImageMagicBytes } from "@/lib/fileValidation";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { resizeToWebp } from "@/lib/imageResize";
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";
import { baseMime, documentSignatureError, resolveAttachment } from "@/lib/attachmentTypes";

/**
 * FIX-WALLMEDIA: загрузка материалов для записи на стене профиля.
 *
 * Почему отдельный маршрут, а не /api/messages/upload: тот требует channelId или
 * conversationId и проверяет права на канал/беседу. У стены ни канала, ни беседы
 * нет — владелец у файла один, человек. И почему не /api/projects/upload: он
 * открыт только консультантам и администрации, а стена есть у каждого.
 *
 * Проверки содержимого — те же, что у вложений чата (сигнатуры картинок, медиа и
 * документов): доверять присланному типу нельзя нигде.
 */

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const COMPRESS_MAX = 1920;
const COMPRESS_QUALITY = 82;
const DIR = "wall";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimit(req, `wall-upload:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

    const resolved = resolveAttachment(file.type, file.name);
    if (!resolved) {
      return NextResponse.json({ error: "Этот тип файла не поддерживается" }, { status: 415 });
    }
    const mime = resolved.mime || baseMime(file.type);
    const isImage = resolved.kind === "image";
    const isVideo = resolved.kind === "video";
    const isAudio = resolved.kind === "audio";
    const documentExt = resolved.kind === "document" ? resolved.ext : undefined;

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Файл слишком большой (макс. 25 МБ)" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (isImage && !validateImageMagicBytes(buffer, mime)) {
      return NextResponse.json({ error: "Содержимое изображения не соответствует его типу" }, { status: 400 });
    }
    if (isVideo || isAudio) {
      const mediaError = mediaSignatureError(mime, buffer);
      if (mediaError) return NextResponse.json({ error: mediaError }, { status: 400 });
    }
    if (documentExt) {
      const signatureError = documentSignatureError(documentExt, buffer);
      if (signatureError) return NextResponse.json({ error: signatureError }, { status: 400 });
    }

    const uploadsDir = uploadDirRoot(DIR);
    await mkdir(uploadsDir, { recursive: true });
    const fileId = uuid();

    let fileName: string;
    let finalBuffer: Buffer;
    let responseType = mime;

    if (isImage) {
      fileName = `${fileId}.webp`;
      finalBuffer = await resizeToWebp(buffer, { maxDimension: COMPRESS_MAX, quality: COMPRESS_QUALITY });
      responseType = "image/webp";
    } else if (isVideo) {
      const ext =
        mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : mime === "video/x-matroska" ? "mkv" : "mp4";
      fileName = `${fileId}.${ext}`;
      finalBuffer = buffer;
    } else if (isAudio) {
      const ext =
        mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : mime === "audio/mpeg" ? "mp3" : mime === "audio/wav" ? "wav" : "webm";
      fileName = `${fileId}.${ext}`;
      finalBuffer = buffer;
    } else {
      fileName = `${fileId}.${documentExt}`;
      finalBuffer = buffer;
    }

    await writeFile(path.join(uploadsDir, fileName), finalBuffer, { flag: "wx" });
    await recordUpload({ path: `${DIR}/${fileName}`, uploaderId: session.user.id });

    return NextResponse.json({
      url: `/uploads/${DIR}/${fileName}`,
      name: file.name.slice(0, 180),
      size: finalBuffer.length,
      type: responseType,
      isImage,
      isVideo,
    });
  } catch (error) {
    console.error("[WallUpload] Error:", error);
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
