import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("icon") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Разрешены только PNG, JPG, WebP, GIF" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 2MB)" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Save to public/uploads/services/
  const uploadDir = path.join(process.cwd(), "public", "uploads", "services");
  await mkdir(uploadDir, { recursive: true });

  const ext = file.name.split(".").pop() || "png";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filepath = path.join(uploadDir, filename);

  await writeFile(filepath, buffer);

  const url = `/uploads/services/${filename}`;
  return NextResponse.json({ url });
}
