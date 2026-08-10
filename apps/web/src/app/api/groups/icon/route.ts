import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { validateImageFile, sanitizeExtension } from "@/lib/fileValidation";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("icon") as File | null;

  if (!file) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  if (file.size > 2 * 1024 * 1024)
    return NextResponse.json({ error: "Файл слишком большой (макс. 2MB)" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "groups");
  await mkdir(uploadDir, { recursive: true });

  const ext = sanitizeExtension(file.name);
  const filename = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  const iconUrl = `/uploads/groups/${filename}`;
  return NextResponse.json({ icon: iconUrl });
}
