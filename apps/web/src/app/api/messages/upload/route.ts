import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { validateImageMagicBytes } from "@/lib/fileValidation";
import { hasPremium } from "@/lib/premium";
import { FREE_UPLOAD_MB, PREMIUM_UPLOAD_MB, uploadLimitBytes } from "@/lib/premiumLimits";
import { canAccessConversation, getChannelPermissions } from "@/lib/connectPermissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { v4 as uuid } from "uuid";
/* Приватные вложения лежат вне public/: см. lib/uploadPaths. */
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";

/* Предел размера — по подписке (см. lib/premiumLimits): 10 МБ против 100 МБ.
   Раньше он был общий, 25 МБ на всех. */
const COMPRESS_MAX_WIDTH = 1920;
const COMPRESS_QUALITY = 80;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);
const ALLOWED_DOCUMENT_TYPES = new Map<string, string>([
  ["application/pdf", "pdf"], ["text/plain", "txt"], ["text/csv", "csv"], ["application/json", "json"],
  ["application/zip", "zip"], ["application/x-7z-compressed", "7z"],
  ["application/msword", "doc"], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"], ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"], ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
]);

/**
 * Тип файла без параметров: `video/webm;codecs=vp9` → `video/webm`.
 *
 * Это исправление бага, из-за которого видеосообщения и голосовые не отправлялись
 * вовсе. `MediaRecorder` отдаёт тип ВМЕСТЕ с кодеками — в браузере проверено:
 * `recorder.mimeType` равен `video/webm;codecs=vp9`, и точно эта строка уходит
 * как Content-Type части запроса. Здесь же тип сверялся точным равенством со
 * списком, поэтому запись получала 415 «Этот тип файла не поддерживается», а
 * клиент молча ничего не показывал. Голосовые страдали так же:
 * `audio/webm;codecs=opus` в списке тоже нет.
 *
 * Параметры для решения не значат ничего: контейнер задаётся первой частью, а
 * кодеки внутри всё равно не проверяются. Поэтому режем по первой точке с
 * запятой — и заодно приводим к нижнему регистру: тип присылает клиент, и
 * `VIDEO/WEBM` от него вполне возможен.
 */
function baseMime(value: string | undefined | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

function isPdf(buffer: Buffer) { return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-"; }
function isZip(buffer: Buffer) { return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]); }
function safeDuration(value: FormDataEntryValue | null): number | undefined { const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= 86_400 ? n : undefined; }

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimit(req, `upload:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const channelId = formData.get("channelId");
    const conversationId = formData.get("conversationId");
    if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

    if (typeof channelId === "string" && channelId) {
      const permission = await getChannelPermissions(session.user.id, channelId);
      if (!permission?.canUpload) return NextResponse.json({ error: permission?.denialReason ?? "Нет доступа к загрузке в этот канал" }, { status: 403 });
    } else if (typeof conversationId === "string" && conversationId) {
      if (!(await canAccessConversation(session.user.id, conversationId))) return NextResponse.json({ error: "Нет доступа к этому диалогу" }, { status: 403 });
    } else {
      return NextResponse.json({ error: "Для загрузки требуется channelId или conversationId" }, { status: 400 });
    }

    const e2eeIv = formData.get("e2eeIv");
    const isE2EE = typeof e2eeIv === "string" && e2eeIv.length >= 8 && e2eeIv.length <= 256;
    /* Дальше работаем с типом БЕЗ параметров: см. baseMime. */
    const mime = baseMime(file.type);
    const isImage = !isE2EE && ALLOWED_IMAGE_TYPES.has(mime);
    const isAudio = !isE2EE && ALLOWED_AUDIO_TYPES.has(mime);
    const isVideo = !isE2EE && ALLOWED_VIDEO_TYPES.has(mime);
    const documentExt = !isE2EE ? ALLOWED_DOCUMENT_TYPES.get(mime) : undefined;
    if (!isE2EE && !isImage && !isAudio && !isVideo && !documentExt) {
      return NextResponse.json({ error: "Этот тип файла не поддерживается" }, { status: 415 });
    }

    const premium = hasPremium(session.user);
    const sizeLimit = uploadLimitBytes(premium);
    if (file.size <= 0 || file.size > sizeLimit) {
      return NextResponse.json(
        {
          error: premium
            ? `Файл слишком большой (макс. ${PREMIUM_UPLOAD_MB} МБ)`
            : `Файл слишком большой (макс. ${FREE_UPLOAD_MB} МБ, с подпиской Premium — ${PREMIUM_UPLOAD_MB} МБ)`,
        },
        { status: 413 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    /* Приоритет полосы: загрузка без подписки притормаживается. Проверка была
       своя, голая по isPremium, — теперь общее правило (lib/premium), иначе
       администратор с премиумом по роли ждал бы наравне с бесплатным. */
    if (!premium) {
      await new Promise((r) => setTimeout(r, Math.min(20_000, Math.ceil((file.size / (8 * 1024 * 1024)) * 3000))));
    }
    if (isImage && !validateImageMagicBytes(buffer, mime)) return NextResponse.json({ error: "Содержимое изображения не соответствует его типу" }, { status: 400 });
    if (documentExt === "pdf" && !isPdf(buffer)) return NextResponse.json({ error: "Некорректный PDF-файл" }, { status: 400 });
    if (["zip", "docx", "xlsx", "pptx"].includes(documentExt ?? "") && !isZip(buffer)) return NextResponse.json({ error: "Содержимое архива не соответствует его типу" }, { status: 400 });

    const subDir = isVideo ? "videos" : isAudio || isE2EE ? "voice" : isImage ? "messages" : "documents";
    const uploadsDir = uploadDirRoot(subDir);
    await mkdir(uploadsDir, { recursive: true });
    const fileId = uuid();
    let fileName: string;
    let finalBuffer: Buffer;
    /* В ответе отдаём тип без параметров: он же записан во вложение сообщения, и
       клиенту от «;codecs=vp9» никакой пользы. */
    let responseType = mime;

    if (isImage) {
      fileName = `${fileId}.webp`;
      finalBuffer = await sharp(buffer).resize(COMPRESS_MAX_WIDTH, COMPRESS_MAX_WIDTH, { fit: "inside", withoutEnlargement: true }).webp({ quality: COMPRESS_QUALITY }).toBuffer();
      responseType = "image/webp";
    } else if (isVideo) {
      /* Расширение тоже считалось по полному типу — из-за этого webm-заметка,
         даже пройди она проверку, легла бы на диск как .mp4. */
      const ext = mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : mime === "video/x-matroska" ? "mkv" : "mp4";
      fileName = `${fileId}.${ext}`; finalBuffer = buffer;
    } else if (isE2EE) {
      fileName = `${fileId}.enc`; finalBuffer = buffer; responseType = "application/octet-stream";
    } else if (isAudio) {
      const ext = mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : mime === "audio/mpeg" ? "mp3" : mime === "audio/wav" ? "wav" : "webm";
      fileName = `${fileId}.${ext}`; finalBuffer = buffer;
    } else {
      fileName = `${fileId}.${documentExt}`; finalBuffer = buffer;
    }

    await writeFile(path.join(uploadsDir, fileName), finalBuffer, { flag: "wx" });

    /* Запоминаем, чему принадлежит файл: по этой строке выдача потом проверит
       право на канал или беседу, а не просто «человек вошёл». */
    await recordUpload({
      path: `${subDir}/${fileName}`,
      uploaderId: session.user.id,
      channelId: typeof channelId === "string" && channelId ? channelId : null,
      conversationId: typeof conversationId === "string" && conversationId ? conversationId : null,
    });

    const duration = safeDuration(formData.get("duration"));
    /* Видеосообщение («квадрат» с камеры) от обычного видео отличить по файлу
       нельзя — это то же webm. Признак ставит отправитель полем `note`, и мы ему
       верим ровно в одном: как это ПОКАЗАТЬ. Права, размер и тип уже проверены
       выше, поэтому подделка этого поля не даёт ничего, кроме квадратного вида
       у собственного видео. */
    const isVideoNote = isVideo && formData.get("note") === "1";
    return NextResponse.json({
      url: `/uploads/${subDir}/${fileName}`, name: file.name.slice(0, 180), size: finalBuffer.length, type: responseType,
      isImage, isVideo, isVoice: isAudio || isE2EE,
      ...(isVideoNote ? { isVideoNote: true } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(isE2EE ? { isE2EE: true, e2eeIv } : {}),
    });
  } catch (error) {
    console.error("[Upload] Error:", error);
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
