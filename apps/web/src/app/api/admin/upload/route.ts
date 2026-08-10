import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
// Allowed upload destinations (maps to subfolders under public/uploads/)
const ALLOWED_DIRS = ["ecosystem", "windows", "articles", "broadcast"] as const;
type UploadDir = (typeof ALLOWED_DIRS)[number];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const dirParam = (formData.get("dir") as string | null) ?? "ecosystem";

  if (!file) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 5 МБ)" }, { status: 400 });
  }
  if (!ALLOWED_DIRS.includes(dirParam as UploadDir)) {
    return NextResponse.json({ error: "Недопустимая папка назначения" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", dirParam);
  await mkdir(uploadDir, { recursive: true });

  const ext = sanitizeExtension(file.name);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  return NextResponse.json({ url: `/uploads/${dirParam}/${filename}` });
}
