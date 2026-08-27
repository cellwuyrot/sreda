import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { authOptions } from "@/lib/auth";
import { sanitizeExtension } from "@/lib/fileValidation";
import {
  MAX_DOCUMENT_SIZE,
  isAllowedDocument,
  formatSize,
} from "@/lib/businessPayment";
import { uploadDirRoot } from "@/lib/uploadPaths"; // FIX-SEC-DOCS
import { recordUpload } from "@/lib/uploadAccess"; // FIX-SEC-DOCS

/**
 * BUSINESS-PAY: загрузка договоров и приложений.
 *
 * FIX-SEC-DOCS: документы теперь хранятся в storage/uploads/documents
 * (приватный каталог, вне public/), а не в public/uploads/documents.
 * Адрес в базе прежний — /uploads/documents/<файл> — его перехватывает
 * server.ts и проверяет сессию до раздачи файла.
 *
 * ── Почему отдельный маршрут, а не /api/admin/upload ────────────────────────
 *
 * Старый маршрут пропускает только картинки (validateImageFile сверяет сигнатуру
 * файла) и только от администрации. Здесь нужно ровно обратное: PDF и DOCX —
 * основной формат договора, а подписанный экземпляр загружает в том числе КЛИЕНТ.
 * Расширять ради этого админский маршрут значило бы ослабить проверки там, где они
 * сейчас строгие, и открыть его не-админам. Дешевле завести свой.
 *
 * ── Безопасность ──────────────────────────────────────────────────
 *
 * Имя файла на диске генерируется сервером, расширение очищается до [a-z0-9] —
 * исходное имя никогда не участвует в пути, поэтому «../» и двойные расширения
 * невозможны. Показываемое человеку имя хранится отдельно, в базе.
 */

const UPLOAD_SUBDIR = "documents";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  /* Загружать может любой вошедший: клиент — свой подписанный договор,
     администрация — шаблоны к услуге. Право ПРИКРЕПИТЬ загруженный файл к
     услуге или к счёту проверяют соответствующие маршруты — здесь только байты. */
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return NextResponse.json(
      { error: `Файл слишком большой (макс. ${formatSize(MAX_DOCUMENT_SIZE)})` },
      { status: 400 },
    );
  }
  if (!isAllowedDocument(file.type || "", file.name || "")) {
    return NextResponse.json(
      { error: "Допустимы PDF, DOC, DOCX, RTF, TXT и снимки (JPG, PNG, WEBP)" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // FIX-SEC-DOCS: приватный каталог вне public/ — не раздаётся статикой Next.js
  const uploadDir = uploadDirRoot(UPLOAD_SUBDIR);
  await mkdir(uploadDir, { recursive: true });

  const ext = sanitizeExtension(file.name);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  const relPath = `${UPLOAD_SUBDIR}/${filename}`;
  const userId = (session.user as { id?: string }).id;
  if (userId) {
    // FIX-SEC-DOCS: регистрируем файл в указателе — server.ts применит
    // canAccessUpload при следующей попытке скачать этот документ.
    try {
      await recordUpload({ path: relPath, uploaderId: userId });
    } catch {
      // Незарегистрированный файл всё равно отдаётся вошедшему (UPLOADS_STRICT=0 по умолчанию);
      // это лучше, чем потерять уже загруженный договор. Журнал предупредит.
    }
  }

  return NextResponse.json({
    url: `/uploads/${UPLOAD_SUBDIR}/${filename}`,
    /* Исходное имя возвращаем обратно: его покажут в списке, а сгенерированное
       имя файла человеку ничего не говорит. */
    name: (file.name || "Документ").slice(0, 255),
    size: file.size,
    mime: file.type || null,
  });
}
