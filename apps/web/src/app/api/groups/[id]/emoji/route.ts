import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { emitToGroup } from "@/lib/socketEmit";
import { rateLimit } from "@/lib/rateLimit";
import { validateImageFile } from "@/lib/fileValidation";
import { hasPremium } from "@/lib/premium";
import { EMOJI_SIZE_PX, FREE_GROUP_EMOJI, PREMIUM_GROUP_EMOJI, groupEmojiLimit } from "@/lib/premiumLimits";
/* Эмодзи — не секрет: их видно в каждом сообщении, поэтому каталог публичный
   (см. lib/uploadPaths: "emoji" не в списке приватных). */
import { uploadDirRoot } from "@/lib/uploadPaths";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { v4 as uuid } from "uuid";

/** Имя без двоеточий: его набирают руками в сообщении, поэтому только нижний
 *  регистр, цифры и подчёркивание — иначе `:Смех:` и `:smeh:` были бы разными
 *  эмодзи, а найти нужный стало бы делом угадывания. */
/* Хотя бы одна буква обязательна. Имя из одних цифр ломало бы обычный текст:
   эмодзи с именем «30» превращает «12:30:45» в картинку посреди времени. */
const NAME_RE = /^(?=.*[a-z])[a-z0-9_]{2,32}$/;

/** Вход ограничен 5 МБ: на выходе всё равно квадрат 128×128, и файл крупнее
 *  этого — только лишняя работа для sharp и лишний трафик. */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

const UPLOAD_DIR = "emoji";

/**
 * Один поход в базу за всем, что нужно для проверок: роль обратившегося в
 * сообществе и подписка владельца.
 *
 * Предел считается по подписке ВЛАДЕЛЬЦА, а не того, кто загружает: набор
 * принадлежит месту, а не человеку. Иначе премиум-администратор набивал бы
 * двадцать эмодзи в сообщество, которое потом остаётся без подписки.
 */
async function emojiAccess(userId: string, groupId: string) {
  const [group, membership] = await Promise.all([
    prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, owner: { select: { isPremium: true, role: true } } },
    }),
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: { role: true },
    }),
  ]);
  if (!group) return null;
  return {
    isMember: !!membership,
    // Добавлять и удалять эмодзи может владелец и администратор сообщества:
    // это оформление места, а не мера модерации, поэтому модератора здесь нет.
    canManage: membership?.role === "OWNER" || membership?.role === "ADMIN",
    ownerPremium: hasPremium(group.owner),
  };
}

// GET /api/groups/[id]/emoji — набор сообщества для любого его участника.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await emojiAccess(session.user.id, id);
  if (!access) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });
  if (!access.isMember) return NextResponse.json({ error: "Вы не участник сообщества" }, { status: 403 });

  const emojis = await prisma.groupEmoji.findMany({
    where: { groupId: id },
    select: { id: true, name: true, url: true },
    orderBy: { createdAt: "asc" },
  });

  /* `limit` и `total` отдаём вместе со списком, чтобы настройки показали «5 из
     20» без второго запроса и без своей копии чисел из premiumLimits. */
  return NextResponse.json({
    emojis,
    total: emojis.length,
    limit: groupEmojiLimit(access.ownerPremium),
    ownerPremium: access.ownerPremium,
    canManage: access.canManage,
  });
}

// POST /api/groups/[id]/emoji — multipart: file + name.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimit(req, `group-emoji:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог бы продолжать заливать картинки в сообщество.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await emojiAccess(session.user.id, id);
  if (!access) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });
  if (!access.canManage) {
    return NextResponse.json({ error: "Добавлять эмодзи может создатель или админ сообщества" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const rawName = formData.get("name");

  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  if (typeof rawName !== "string") return NextResponse.json({ error: "Имя не передано" }, { status: 400 });

  const name = rawName.trim().toLowerCase();
  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "Имя эмодзи: от 2 до 32 символов, только латиница в нижнем регистре, цифры и подчёркивание" },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "Картинка должна быть не больше 5 МБ" }, { status: 413 });
  }

  const limit = groupEmojiLimit(access.ownerPremium);
  const [total, existing] = await Promise.all([
    prisma.groupEmoji.count({ where: { groupId: id } }),
    prisma.groupEmoji.findUnique({ where: { groupId_name: { groupId: id, name } }, select: { id: true } }),
  ]);
  if (existing) {
    return NextResponse.json({ error: `Эмодзи «:${name}:» в этом сообществе уже есть` }, { status: 409 });
  }
  if (total >= limit) {
    const hint = access.ownerPremium
      ? "Удалите ненужный, чтобы освободить место."
      : `Без подписки владельца в наборе ${FREE_GROUP_EMOJI} эмодзи, с Premium — ${PREMIUM_GROUP_EMOJI}.`;
    return NextResponse.json({ error: `Набор заполнен: ${total} из ${limit}. ${hint}` }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  /* Тип проверяем по самим байтам, а не по заголовку из браузера: заявить
     «image/png» может кто угодно, а sharp получит на вход что придётся. */
  const check = validateImageFile(buffer, file.type);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const fileName = `${uuid()}.webp`;
  const dir = uploadDirRoot(UPLOAD_DIR);
  const url = `/uploads/${UPLOAD_DIR}/${fileName}`;

  try {
    /* Единый размер и формат делает сервер: клиент присылает что угодно, а в
       переписке эмодзи должны стоять в одной строке одинаковыми. `contain` с
       прозрачным фоном сохраняет пропорции — широкая картинка не растягивается
       в квадрат, а получает пустые поля. Анимацию не включаем: sharp без
       `animated: true` берёт первый кадр, что для GIF нам и нужно. */
    const webp = await sharp(buffer)
      .resize(EMOJI_SIZE_PX, EMOJI_SIZE_PX, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp()
      .toBuffer();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), webp, { flag: "wx" });
  } catch (error) {
    console.error("[GroupEmoji] convert/write failed:", error);
    return NextResponse.json({ error: "Не удалось обработать картинку" }, { status: 500 });
  }

  try {
    const emoji = await prisma.groupEmoji.create({
      data: { groupId: id, name, url, createdById: session.user.id },
      select: { id: true, name: true, url: true },
    });
    /* Набор в открытых клиентах подхватывается сразу: он запрашивается один раз
       при входе в канал, и без этого события только что добавленный эмодзи
       остался бы текстом до перезагрузки страницы — ровно на это и жаловались. */
    emitToGroup(id, "group-emoji-updated", { groupId: id });

    return NextResponse.json({ emoji, total: total + 1, limit });
  } catch (error) {
    /* Строка не легла (например, гонка за одно и то же имя) — картинку с диска
       убираем сразу, иначе каталог загрузок обрастает файлами без владельца. */
    await unlink(path.join(dir, fileName)).catch(() => {});
    console.error("[GroupEmoji] create failed:", error);
    return NextResponse.json({ error: `Эмодзи «:${name}:» не удалось сохранить` }, { status: 409 });
  }
}
