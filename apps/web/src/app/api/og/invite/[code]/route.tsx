import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";

// FIX-INVITE-OG: персональная OG-обложка приглашения в сообщество (1200×630).
// В отличие от общего /api/og (edge, статические пресеты), этот роут работает
// в Node-рантайме: ему нужны Prisma (данные группы) и чтение иконки с диска
// (иконка внедряется data-URL-ом — без сетевого self-fetch за прокси).
// Данные публичны по ссылке-приглашению, как и GET /api/invites/[code].

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const ACCENT = "#00f0ff"; // фирменный циан TZ.Connect
const VIOLET = "#8b5cf6";

async function loadIconDataUrl(icon: string | null): Promise<string | null> {
  // Только загруженные в наш /uploads растровые иконки; gif пропускаем —
  // satori не гарантирует его декодирование.
  if (!icon || !icon.startsWith("/uploads/") || icon.includes("..")) return null;
  const ext = icon.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
  if (!mime) return null;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", icon));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  let invite: {
    expiresAt: Date | null;
    maxUses: number;
    uses: number;
    group: { name: string; description: string; icon: string | null; _count: { members: number; channels: number } };
  } | null = null;
  try {
    invite = await prisma.invite.findUnique({
      where: { code },
      select: {
        expiresAt: true,
        maxUses: true,
        uses: true,
        group: {
          select: {
            name: true, description: true, icon: true,
            _count: { select: { members: true, channels: true } },
          },
        },
      },
    });
  } catch {
    invite = null;
  }

  const dead =
    !invite ||
    (invite.expiresAt !== null && invite.expiresAt < new Date()) ||
    (invite.maxUses > 0 && invite.uses >= invite.maxUses);

  const name = dead || !invite ? "Приглашение недоступно" : invite.group.name;
  const description = dead || !invite
    ? "Ссылка истекла или была отозвана"
    : invite.group.description?.trim() || "Сообщество на платформе TZ.Connect";
  const members = dead || !invite ? 0 : invite.group._count.members;
  const channels = dead || !invite ? 0 : invite.group._count.channels;
  const iconSrc = dead || !invite ? null : await loadIconDataUrl(invite.group.icon);
  const letter = (name.trim().charAt(0) || "T").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          alignItems: "center",
          background: "linear-gradient(135deg, #07070b 0%, #10101a 45%, #0a0a12 100%)",
          position: "relative",
          overflow: "hidden",
          padding: "0 90px",
        }}
      >
        {/* Ауры акцентов */}
        <div style={{ position: "absolute", top: -220, right: -160, width: 640, height: 640, borderRadius: "50%", background: `radial-gradient(circle, ${ACCENT}14 0%, transparent 70%)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: -260, left: -180, width: 700, height: 700, borderRadius: "50%", background: `radial-gradient(circle, ${VIOLET}16 0%, transparent 70%)`, display: "flex" }} />
        {/* Сетка */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: `linear-gradient(${ACCENT}07 1px, transparent 1px), linear-gradient(90deg, ${ACCENT}07 1px, transparent 1px)`, backgroundSize: "60px 60px", display: "flex" }} />
        {/* Орбитальные кольца */}
        <div style={{ position: "absolute", top: -120, right: -120, width: 460, height: 460, borderRadius: "50%", border: `2px solid ${ACCENT}22`, display: "flex" }} />
        <div style={{ position: "absolute", top: -80, right: -80, width: 380, height: 380, borderRadius: "50%", border: `1px solid ${ACCENT}14`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: -150, left: -150, width: 520, height: 520, borderRadius: "50%", border: `2px solid ${VIOLET}1e`, display: "flex" }} />
        {/* Верхняя акцентная линия */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, transparent, ${ACCENT}, ${VIOLET}, transparent)`, display: "flex" }} />
        {/* Ромбы-декор */}
        <div style={{ position: "absolute", top: 64, left: 64, width: 14, height: 14, background: ACCENT, transform: "rotate(45deg)", opacity: 0.35, display: "flex" }} />
        <div style={{ position: "absolute", top: 102, left: 100, width: 8, height: 8, background: VIOLET, transform: "rotate(45deg)", opacity: 0.3, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 90, right: 88, width: 12, height: 12, background: VIOLET, transform: "rotate(45deg)", opacity: 0.3, display: "flex" }} />

        {/* Аватар сообщества */}
        <div
          style={{
            width: 232,
            height: 232,
            borderRadius: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: `3px solid ${ACCENT}55`,
            boxShadow: `0 0 80px ${ACCENT}30`,
            background: iconSrc ? "#0d0d14" : `linear-gradient(135deg, ${VIOLET} 0%, #4f46e5 100%)`,
            overflow: "hidden",
          }}
        >
          {iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconSrc} alt="" width={232} height={232} style={{ width: 232, height: 232, objectFit: "cover" }} />
          ) : (
            <div style={{ fontSize: 118, fontWeight: 800, color: "white", display: "flex" }}>{letter}</div>
          )}
        </div>

        {/* Текстовая колонка */}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 64, flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: ACCENT,
              fontSize: 22,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
            }}
          >
            <div style={{ width: 10, height: 10, background: ACCENT, transform: "rotate(45deg)", display: "flex" }} />
            <div style={{ display: "flex" }}>Приглашение в сообщество</div>
          </div>

          <div
            style={{
              fontSize: name.length > 22 ? 56 : 72,
              fontWeight: 800,
              color: "white",
              marginTop: 18,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              display: "block",
              lineClamp: 2,
              textShadow: `0 0 60px ${ACCENT}25`,
            }}
          >
            {name}
          </div>

          <div
            style={{
              fontSize: 27,
              color: "#9aa3b5",
              marginTop: 18,
              lineHeight: 1.4,
              display: "block",
              lineClamp: 2,
            }}
          >
            {description.slice(0, 150)}
          </div>

          {/* Статистика */}
          {!dead && (
            <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6ecf5", fontSize: 24 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#22c55e", display: "flex" }} />
                <div style={{ display: "flex" }}>{members} {plural(members, "участник", "участника", "участников")}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6ecf5", fontSize: 24 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: ACCENT, display: "flex" }} />
                <div style={{ display: "flex" }}>{channels} {plural(channels, "канал", "канала", "каналов")}</div>
              </div>
            </div>
          )}
        </div>

        {/* Подвал */}
        <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${ACCENT}60`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: ACCENT }}>◈</div>
          <div style={{ fontSize: 17, color: "#6b7280", letterSpacing: "0.12em", display: "flex" }}>trioz.ru · TZ.Connect</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
