import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeRichText } from "@/lib/sanitize";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR";

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const published = searchParams.get("published");

  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  // Non-admins can ONLY see published articles — ignore any ?published= param
  if (!isAdmin) {
    where.published = true;
  } else if (published !== null) {
    where.published = published === "true";
  }

  const articles = await prisma.article.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(articles);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { title, content, category, tags, published } = await req.json();
  if (!title || !content || !category) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const sanitizedTitle = sanitizeRichText(title);
  const sanitizedContent = sanitizeRichText(content);

  if (!sanitizedTitle || !sanitizedContent) {
    return NextResponse.json({ error: "Title and content cannot be empty" }, { status: 400 });
  }

  const slug = sanitizedTitle
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);

  const article = await prisma.article.create({
    data: {
      title: sanitizedTitle,
      slug: `${slug}-${Date.now()}`,
      content: sanitizedContent,
      category,
      tags: tags || "",
      published: published ?? false,
    },
  });

  return NextResponse.json(article);
}
