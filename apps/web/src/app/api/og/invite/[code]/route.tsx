import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";

// FIX-INVITE-OG: персональная OG-обложка приглашения в сообщество (1200×630).
// Node runtime — нужны Prisma (данные группы) и fs (иконка с диска).

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ─── Triskelion logo (same shape as /api/og) ───────────────────────────────
const ARM =
  "M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z";

function logoSvg(fill: string, opacity = 1): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<g transform="translate(50,52)" fill="${fill}" opacity="${opacity}">` +
    `<path d="${ARM}" transform="rotate(0)"/>` +
    `<path d="${ARM}" transform="rotate(120)"/>` +
    `<path d="${ARM}" transform="rotate(240)"/>` +
    `</g></svg>`
  );
}

function logoDataUrl(fill = "white", opacity = 1): string {
  return `data:image/svg+xml,${encodeURIComponent(logoSvg(fill, opacity))}`;
}

// ─── Brand accent (TZ.Connect cyan → violet) ──────────────────────────────
const ACCENT  = "#06b6d4"; // cyan
const ACCENT2 = "#6366f1"; // indigo
const A  = "6,182,212";
const A2 = "99,102,241";

async function loadIconDataUrl(icon: string | null): Promise<string | null> {
  if (!icon || !icon.startsWith("/uploads/") || icon.includes("..")) return null;
  const ext = icon.split(".").pop()?.toLowerCase();
  const mime =
    ext === "png"  ? "image/png"  :
    ext === "webp" ? "image/webp" :
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
  if (!mime) return null;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", icon));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  let invite: {
    expiresAt: Date | null;
    maxUses: number;
    uses: number;
    group: {
      name: string;
      description: string;
      icon: string | null;
      _count: { members: number; channels: number };
    };
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
            name: true,
            description: true,
            icon: true,
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

  const name        = dead || !invite ? "Приглашение недоступно" : invite.group.name;
  const description = dead || !invite
    ? "Ссылка истекла или была отозвана"
    : invite.group.description?.trim() || "Сообщество на платформе TZ.Connect";
  const members  = dead || !invite ? 0 : invite.group._count.members;
  const channels = dead || !invite ? 0 : invite.group._count.channels;
  const iconSrc  = dead || !invite ? null : await loadIconDataUrl(invite.group.icon);
  const letter   = (name.trim().charAt(0) || "T").toUpperCase();

  const logoSrc = logoDataUrl("white", 0.92);

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          alignItems: "center",
          background: "#07090f",
          position: "relative",
          overflow: "hidden",
          padding: "0 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* ── Background gradients ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            background:
              `radial-gradient(ellipse at 80% 20%, rgba(${A},.20) 0%, transparent 50%),` +
              `radial-gradient(ellipse at 15% 85%, rgba(${A2},.18) 0%, transparent 52%),` +
              `#07090f`,
          }}
        />
        {/* ── Grid ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            backgroundImage:
              `linear-gradient(rgba(${A},.05) 1px, transparent 1px),` +
              `linear-gradient(90deg, rgba(${A},.05) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        {/* ── Vignette ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.7) 100%)",
          }}
        />

        {/* ── Top accent bar ── */}
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2, display: "flex",
            background: `linear-gradient(90deg, transparent, ${ACCENT} 40%, ${ACCENT2} 60%, transparent)`,
          }}
        />

        {/* ── Rings ── */}
        <div style={{ position: "absolute", top: -160, right: -160, width: 580, height: 580, borderRadius: "50%", border: `1px solid rgba(${A},.1)`, display: "flex" }} />
        <div style={{ position: "absolute", top: -100, right: -100, width: 440, height: 440, borderRadius: "50%", border: `1px solid rgba(${A},.07)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: -180, left: -180, width: 620, height: 620, borderRadius: "50%", border: `1px solid rgba(${A2},.08)`, display: "flex" }} />

        {/* ── Corner brackets ── */}
        <div style={{ position: "absolute", top: 24, left: 24, width: 26, height: 26, borderTop: `1.5px solid rgba(${A},.35)`, borderLeft: `1.5px solid rgba(${A},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", top: 24, right: 24, width: 26, height: 26, borderTop: `1.5px solid rgba(${A2},.35)`, borderRight: `1.5px solid rgba(${A2},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 24, left: 24, width: 26, height: 26, borderBottom: `1.5px solid rgba(${A},.35)`, borderLeft: `1.5px solid rgba(${A},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 24, right: 24, width: 26, height: 26, borderBottom: `1.5px solid rgba(${A2},.35)`, borderRight: `1.5px solid rgba(${A2},.35)`, display: "flex" }} />

        {/* ── Diamond accents ── */}
        <div style={{ position: "absolute", top: 64, left: 64, width: 12, height: 12, background: ACCENT, transform: "rotate(45deg)", opacity: 0.3, display: "flex" }} />
        <div style={{ position: "absolute", top: 100, left: 98, width: 7, height: 7, background: ACCENT2, transform: "rotate(45deg)", opacity: 0.2, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 88, right: 88, width: 10, height: 10, background: ACCENT2, transform: "rotate(45deg)", opacity: 0.25, display: "flex" }} />

        {/* ─────────── Community avatar ─────────── */}
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: `2px solid rgba(${A},.45)`,
            boxShadow: `0 0 60px rgba(${A},.22), 0 0 120px rgba(${A2},.12)`,
            background: iconSrc
              ? "#0d0f18"
              : `linear-gradient(135deg, ${ACCENT2}, #4f46e5)`,
            overflow: "hidden",
          }}
        >
          {iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconSrc}
              alt=""
              width={220}
              height={220}
              style={{ width: 220, height: 220, objectFit: "cover", display: "flex" }}
            />
          ) : (
            <div style={{ fontSize: 108, fontWeight: 800, color: "white", display: "flex" }}>
              {letter}
            </div>
          )}
        </div>

        {/* ─────────── Text column ─────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 60,
            flex: 1,
            minWidth: 0,
          }}
        >
          {/* Eyebrow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: ACCENT,
              fontSize: 20,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
            }}
          >
            {/* Mini triskelion */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoDataUrl(ACCENT, 0.8)}
              width={18}
              height={18}
              style={{ display: "flex" }}
              alt=""
            />
            <div style={{ display: "flex" }}>Приглашение · TZ.Connect</div>
          </div>

          {/* Group name */}
          <div
            style={{
              fontSize: name.length > 22 ? 52 : 68,
              fontWeight: 900,
              color: "#f0f2ff",
              marginTop: 16,
              lineHeight: 1.08,
              letterSpacing: "-0.025em",
              display: "flex",
              textShadow: `0 0 50px rgba(${A},.25)`,
            }}
          >
            {name}
          </div>

          {/* Divider */}
          <div
            style={{
              width: 120,
              height: 1.5,
              marginTop: 16,
              marginBottom: 16,
              display: "flex",
              background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2}, transparent)`,
            }}
          />

          {/* Description */}
          <div
            style={{
              fontSize: 24,
              color: "rgba(192,200,214,.85)",
              lineHeight: 1.45,
              display: "flex",
            }}
          >
            {description.slice(0, 120)}
          </div>

          {/* Stats */}
          {!dead && (
            <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 20px",
                  borderRadius: 12,
                  background: "rgba(6,182,212,.08)",
                  border: `1px solid rgba(${A},.2)`,
                  color: "#e0e8f4",
                  fontSize: 22,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "flex", boxShadow: "0 0 6px #22c55e" }} />
                <div style={{ display: "flex" }}>
                  {members} {plural(members, "участник", "участника", "участников")}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 20px",
                  borderRadius: 12,
                  background: `rgba(${A2},.08)`,
                  border: `1px solid rgba(${A2},.2)`,
                  color: "#e0e8f4",
                  fontSize: 22,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: ACCENT2, display: "flex", boxShadow: `0 0 6px ${ACCENT2}` }} />
                <div style={{ display: "flex" }}>
                  {channels} {plural(channels, "канал", "канала", "каналов")}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            position: "absolute",
            bottom: 28, left: 0, right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            width={16}
            height={16}
            style={{ display: "flex", opacity: 0.4 }}
            alt=""
          />
          <div
            style={{
              fontSize: 14,
              color: `rgba(${A},.38)`,
              letterSpacing: "0.14em",
              display: "flex",
            }}
          >
            TRIOZ.RU · TZ.CONNECT
          </div>
          <div
            style={{
              width: 4, height: 4, borderRadius: "50%",
              background: ACCENT2, opacity: 0.4, display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
