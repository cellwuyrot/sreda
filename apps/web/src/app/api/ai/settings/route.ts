import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { encrypt, decrypt, isEncrypted } from "@/lib/encryption";
import { logAction } from "@/lib/audit";

const AI_KEYS = ["ai_api_key", "ai_model", "ai_system_prompt", "ai_provider"];
const ENCRYPTED_KEYS = ["ai_api_key"];

export async function GET() {
  const session = await getServerSession(authOptions);
  // ROLE-STRUCT: настройки ИИ (API-ключ, модель, промт) — уровень проекта.
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const configs = await prisma.siteConfig.findMany({
    where: { key: { in: AI_KEYS } },
  });

  const settings: Record<string, string> = {};
  for (const c of configs) {
    if (c.key === "ai_api_key" && c.value) {
      try {
        const decrypted = isEncrypted(c.value) ? decrypt(c.value) : c.value;
        settings[c.key] = decrypted.slice(0, 8) + "..." + decrypted.slice(-4);
      } catch {
        settings[c.key] = "***encrypted***";
      }
    } else {
      settings[c.key] = c.value;
    }
  }

  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  // ROLE-STRUCT: настройки ИИ (API-ключ, модель, промт) — уровень проекта.
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  for (const key of AI_KEYS) {
    if (body[key] !== undefined) {
      const value = ENCRYPTED_KEYS.includes(key) && body[key]
        ? encrypt(body[key])
        : body[key];

      await prisma.siteConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  }

  const changedKeys = AI_KEYS.filter(k => body[k] !== undefined);
  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "AISettings",
    details: `Изменение настроек AI: ${changedKeys.join(", ")}`,
  });

  return NextResponse.json({ success: true });
}
