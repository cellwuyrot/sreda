import type { Metadata } from "next";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import InviteClient from "./InviteClient";

// FIX-INVITE-OG: страница приглашения стала серверным компонентом с
// generateMetadata — при шаринге ссылки мессенджеры (Telegram, Discord, VK)
// показывают персональную карточку СООБЩЕСТВА (название, описание, число
// участников и сгенерированная обложка /api/og/invite/[code]) вместо
// общесайтовой заглушки «Т.Р.И.О.Z». Данные и так публичны по ссылке
// (их отдаёт GET /api/invites/[code] без авторизации) — новых утечек нет.

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;

  // Абсолютный базовый URL — краулерам мессенджеров нужны абсолютные ссылки на
  // картинку. Хост берём из заголовков запроса (за прокси — x-forwarded-*).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "connect.trioz.ru";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const fallback: Metadata = {
    title: "Приглашение — TZ.Connect",
    description: "Присоединяйтесь к сообществам на коммуникационной платформе TZ.Connect.",
  };

  let invite: {
    expiresAt: Date | null;
    maxUses: number;
    uses: number;
    group: { name: string; description: string; _count: { members: number } };
  } | null = null;
  try {
    invite = await prisma.invite.findUnique({
      where: { code },
      select: {
        expiresAt: true,
        maxUses: true,
        uses: true,
        group: { select: { name: true, description: true, _count: { select: { members: true } } } },
      },
    });
  } catch {
    return fallback;
  }

  const dead =
    !invite ||
    (invite.expiresAt !== null && invite.expiresAt < new Date()) ||
    (invite.maxUses > 0 && invite.uses >= invite.maxUses);
  if (dead || !invite) return fallback;

  const g = invite.group;
  const members = g._count.members;
  const title = `${g.name} — приглашение в сообщество`;
  const descriptionParts = [
    g.description?.trim() ? g.description.trim().slice(0, 140) : "Сообщество на платформе TZ.Connect.",
    `${members} ${plural(members, "участник", "участника", "участников")}`,
    "Нажмите, чтобы вступить",
  ];
  const description = descriptionParts.join(" · ");
  const pageUrl = `${base}/invite/${encodeURIComponent(code)}`;
  const imageUrl = `${base}/api/og/invite/${encodeURIComponent(code)}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "TZ.Connect",
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: `Приглашение в сообщество ${g.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function InvitePage() {
  return <InviteClient />;
}
