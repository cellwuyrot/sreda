import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import path from "path";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const VALID_NUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const godNum = Number(formData.get("godNum"));

  if (!file) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (!VALID_NUMS.includes(godNum)) {
    return NextResponse.json({ error: "Недопустимый номер бога" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 5 МБ)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const godsDir = path.join(process.cwd(), "public", "games", "velderan", "gods");
  await mkdir(godsDir, { recursive: true });

  // Remove old files for this god number
  const existing = await readdir(godsDir);
  for (const f of existing) {
    if (f.startsWith(`god-${godNum}.`)) {
      await unlink(path.join(godsDir, f)).catch(() => {});
    }
  }

  const ext = sanitizeExtension(file.name);
  const filename = `god-${godNum}.${ext}`;
  await writeFile(path.join(godsDir, filename), buffer);

  // Add cache-busting timestamp
  return NextResponse.json({ url: `/games/velderan/gods/${filename}?t=${Date.now()}` });
}
