import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { uploadDirRoot } from "@/lib/uploadPaths";
import { recordUpload } from "@/lib/uploadAccess";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { MAX_ASSET_BYTES, WORKSPACE_ASSET_TYPES } from "@/lib/workspaceAssets";

/**
 * WS-ASSETS: приём вложений рабочей среды.
 *
 * Раньше картинки, PDF и рисунки хранились строкой `data:` внутри состояния
 * среды — а состояние целиком лежит одной строкой в базе с пределом 2 МБ. Одна
 * фотография с телефона занимала в таком виде около двух мегабайт, то есть
 * переполняла среду целиком: дальше не сохранялось ничего, включая заметки и
 * задачи. Теперь байты приходят сюда, а в карточке остаётся адрес.
 *
 * Файл кладётся туда же, где живут вложения переписки, и с той же учётной
 * записью владельца — значит на него работает общая проверка права при выдаче
 * (см. lib/uploadAccess и раздатчик в server.ts). Никакого отдельного,
 * «более простого» пути к файлам рабочей среды не появляется.
 *
 * Личная среда и общий холст канала различаются одним: у общего указывается
 * канал, и тогда файл видят участники канала, а не только загрузивший. Право на
 * запись в этот канал проверяется здесь же — иначе через загрузку можно было бы
 * положить файл в чужой канал.
 */

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Предел частоты щедрый: вставка нескольких картинок подряд — обычное дело на
     доске, и упереться в него человек не должен. */
  const limited = await rateLimit(req, `workspace-upload:${session.user.id}`, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const channelIdRaw = formData.get("channelId");
    const channelId = typeof channelIdRaw === "string" && channelIdRaw ? channelIdRaw : null;

    if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

    const ext = WORKSPACE_ASSET_TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "Этот тип файла не поддерживается" }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
      return NextResponse.json({ error: "Файл слишком большой (макс. 12 МБ)" }, { status: 413 });
    }

    /* Общий холст: файл увидят участники канала, поэтому право на запись в этот
       канал проверяется до записи на диск. */
    if (channelId) {
      const permissions = await getChannelPermissions(session.user.id, channelId);
      if (!permissions?.canPost) {
        return NextResponse.json({ error: "Нет доступа к этому каналу" }, { status: 403 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadsDir = uploadDirRoot("workspace");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${uuid()}.${ext}`;
    /* Флаг wx: если имя вдруг занято, лучше отказ, чем молча затереть чужой файл. */
    await writeFile(path.join(uploadsDir, fileName), buffer, { flag: "wx" });

    await recordUpload({
      path: `workspace/${fileName}`,
      uploaderId: session.user.id,
      channelId,
    });

    return NextResponse.json({ url: `/uploads/workspace/${fileName}`, size: buffer.length });
  } catch (error) {
    console.error("[workspace-upload] не удалось принять вложение:", error);
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
