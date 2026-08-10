import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const config = await prisma.siteConfig.findUnique({ where: { key: "welcome_text" } });
  return NextResponse.json({
    text: config?.value ?? "Добро пожаловать в TrioZ!\n\nНажимая «Принять», вы соглашаетесь с условиями использования платформы и даёте согласие на обработку персональных данных в соответствии с Федеральным законом №152-ФЗ «О персональных данных».",
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { text } = await req.json();
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }

  await prisma.siteConfig.upsert({
    where: { key: "welcome_text" },
    update: { value: text },
    create: { key: "welcome_text", value: text },
  });

  return NextResponse.json({ success: true });
}
