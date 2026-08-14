import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { mediaSignatureError, validateImageMagicBytes } from "@/lib/fileValidation";
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
/* FIX-FORMATS: единый список типов вместо локальных копий — см. lib/attachmentTypes. */
import { baseMime, documentSignatureError, resolveAttachment } from "@/lib/attachmentTypes";

/* Предел размера — по подписке (см. lib/premiumLimits): 10 МБ против 100 МБ.
   Раньше он был общий, 25 МБ на всех. */
const COMPRESS_MAX_WIDTH = 1920;
const COMPRESS_QUALITY = 80;
/* Списки типов и проверки сигнатур живут в lib/attachmentTypes.

   Раньше они были здесь жёстким белым списком ПО MIME — и именно это ломало
   отправку `.md` и `.rar`: браузеры присылают для них либо пустоту, либо
   `text/plain`/`application/octet-stream`, а ни одного из этих значений в списке
   быть не может. Теперь тип восстанавливается по расширению, а безопасность
   держится на проверке содержимого ниже — как и должно было быть изначально. */
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
    /* Зашифрованное вложение не разбираем вовсе: содержимое — шум, типа у него нет. */
    const resolved = isE2EE ? null : resolveAttachment(file.type, file.name);
    if (!isE2EE && !resolved) {
      return NextResponse.json({ error: "Этот тип файла не поддерживается" }, { status: 415 });
    }
    /* Дальше везде используем РАЗРЕШЁННЫЙ тип, а не присланный: у `.md` из Chrome
       присланный вообще пустой, и записывать его во вложение нельзя. */
    const mime = resolved ? resolved.mime : baseMime(file.type);
    const isImage = resolved?.kind === "image";
    const isAudio = resolved?.kind === "audio";
    const isVideo = resolved?.kind === "video";
    const documentExt = resolved?.kind === "document" ? resolved.ext : undefined;

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
    /* FIX-SEC: звук и видео раньше принимались НА СЛОВО: любой фаи́л с именем
       .mp4 ложился в хранилище и получал ссылку с домена сервиса. */
    if (isVideo || isAudio) {
      const mediaError = mediaSignatureError(mime, buffer);
      if (mediaError) return NextResponse.json({ error: mediaError }, { status: 400 });
    }
    /* Проверка содержимого — единственное, чему здесь вообще можно верить.
       Вместе с rar добавилась его сигнатура: раньше архив либо не доходил сюда
       вовсе, либо отклонялся проверкой zip — у rar другие первые байты. */
    if (documentExt) {
      const signatureError = documentSignatureError(documentExt, buffer);
      if (signatureError) return NextResponse.json({ error: signatureError }, { status: 400 });
    }

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
