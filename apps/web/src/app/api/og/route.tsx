import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

// ─── Triskelion logo SVG (three interlocked T-arms at 0°/120°/240°) ────────
// Arm path: crossbar with chamfered outer ends + stem converging to center.
// Rendered white on dark bg; container provides the color accent.
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

// ─── Page configurations ─────────────────────────────────────────────────────
type PageCfg = {
  title: string;
  subtitle: string;
  accent: string;
  accent2: string;
  tag: string;
  titleSize?: number;
};

const PAGES: Record<string, PageCfg> = {
  main: {
    title: "TRIOZ",
    subtitle: "Ecosystem of Projects",
    accent: "#6366f1",
    accent2: "#8b5cf6",
    tag: "TRIOZ.RU",
    titleSize: 112,
  },
  about: {
    title: "About",
    subtitle: "TRIOZ — Massive Universe of Projects",
    accent: "#8b5cf6",
    accent2: "#a78bfa",
    tag: "TRIOZ.RU / ABOUT",
    titleSize: 86,
  },
  connect: {
    title: "TZ Connect",
    subtitle: "Communication Platform",
    accent: "#06b6d4",
    accent2: "#3b82f6",
    tag: "TRIOZ.RU / CONNECT",
    titleSize: 86,
  },
  games: {
    title: "Games",
    subtitle: "Strategic Online Games",
    accent: "#ef4444",
    accent2: "#f97316",
    tag: "TRIOZ.RU / GAMES",
    titleSize: 86,
  },
  library: {
    title: "TZ Library",
    subtitle: "Knowledge Base & Universe Lore",
    accent: "#10b981",
    accent2: "#06b6d4",
    tag: "TRIOZ.RU / LIBRARY",
    titleSize: 86,
  },
  pero: {
    title: "Pero",
    subtitle: "Books & Tabletop Games",
    accent: "#8b5cf6",
    accent2: "#ec4899",
    tag: "TRIOZ.RU / PERO",
    titleSize: 86,
  },
  projects: {
    title: "Projects",
    subtitle: "MMORPG, Strategies, Online Games",
    accent: "#ef4444",
    accent2: "#f97316",
    tag: "TRIOZ.RU / PROJECTS",
    titleSize: 86,
  },
};

// hex → "r,g,b" for rgba()
function hexRgb(hex: string): string {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ].join(",");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") || "main";
  const cfg: PageCfg = PAGES[page] ?? PAGES.main;

  const a = hexRgb(cfg.accent);
  const a2 = hexRgb(cfg.accent2);
  const isMain = page === "main";
  const logoSrc = logoDataUrl("white", 0.95);
  const logoGlowSrc = logoDataUrl(cfg.accent, 0.15);
  const logoSize = isMain ? 100 : 72;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          background: "#07090f",
          position: "relative",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* ── Deep radial gradient background ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            background:
              `radial-gradient(ellipse at 18% 88%, rgba(${a},.24) 0%, transparent 52%),` +
              `radial-gradient(ellipse at 82% 16%, rgba(${a2},.17) 0%, transparent 50%),` +
              `radial-gradient(ellipse at 50% 50%, rgba(${a},.05) 0%, transparent 68%),` +
              `#07090f`,
          }}
        />

        {/* ── Grid texture ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            backgroundImage:
              `linear-gradient(rgba(${a},.05) 1px, transparent 1px),` +
              `linear-gradient(90deg, rgba(${a},.05) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        {/* ── Vignette ── */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            background:
              "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.75) 100%)",
          }}
        />

        {/* ── Top accent bar ── */}
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2, display: "flex",
            background: `linear-gradient(90deg, transparent, ${cfg.accent} 50%, ${cfg.accent2}, transparent)`,
          }}
        />
        {/* ── Bottom bar ── */}
        <div
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 1, display: "flex",
            background: `linear-gradient(90deg, transparent, rgba(${a},.3), transparent)`,
          }}
        />

        {/* ── Rings top-right ── */}
        <div style={{ position: "absolute", top: -200, right: -200, width: 700, height: 700, borderRadius: "50%", border: `1px solid rgba(${a},.09)`, display: "flex" }} />
        <div style={{ position: "absolute", top: -130, right: -130, width: 540, height: 540, borderRadius: "50%", border: `1px solid rgba(${a},.06)`, display: "flex" }} />
        {/* ── Rings bottom-left ── */}
        <div style={{ position: "absolute", bottom: -200, left: -200, width: 660, height: 660, borderRadius: "50%", border: `1px solid rgba(${a2},.08)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: -130, left: -130, width: 490, height: 490, borderRadius: "50%", border: `1px solid rgba(${a2},.05)`, display: "flex" }} />

        {/* ── Corner brackets ── */}
        <div style={{ position: "absolute", top: 24, left: 24, width: 28, height: 28, borderTop: `1.5px solid rgba(${a},.35)`, borderLeft: `1.5px solid rgba(${a},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", top: 24, right: 24, width: 28, height: 28, borderTop: `1.5px solid rgba(${a2},.35)`, borderRight: `1.5px solid rgba(${a2},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 24, left: 24, width: 28, height: 28, borderBottom: `1.5px solid rgba(${a},.35)`, borderLeft: `1.5px solid rgba(${a},.35)`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 24, right: 24, width: 28, height: 28, borderBottom: `1.5px solid rgba(${a2},.35)`, borderRight: `1.5px solid rgba(${a2},.35)`, display: "flex" }} />

        {/* ── Diamond accents ── */}
        {([
          { top: 60, left: 60, size: 12, op: 0.32, c: cfg.accent },
          { top: 90, left: 94, size: 6,  op: 0.18, c: cfg.accent2 },
          { top: 44, left: 140, size: 4, op: 0.12, c: cfg.accent },
          { bottom: 72, right: 72, size: 10, op: 0.25, c: cfg.accent2 },
          { bottom: 110, right: 124, size: 5, op: 0.14, c: cfg.accent },
        ] as Array<{ top?: number; bottom?: number; left?: number; right?: number; size: number; op: number; c: string }>)
          .map((d, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: d.top, bottom: d.bottom,
                left: d.left, right: d.right,
                width: d.size, height: d.size,
                background: d.c,
                opacity: d.op,
                transform: "rotate(45deg)",
                display: "flex",
              }}
            />
          ))}

        {/* ── Glow orb behind content ── */}
        <div
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            width: isMain ? 560 : 400, height: isMain ? 320 : 240,
            marginTop: isMain ? -160 : -120,
            marginLeft: isMain ? -280 : -200,
            borderRadius: "50%",
            background: `radial-gradient(ellipse at center, rgba(${a},.1) 0%, transparent 70%)`,
            filter: "blur(40px)",
            display: "flex",
          }}
        />

        {/* ── Left vertical accent line ── */}
        <div
          style={{
            position: "absolute", left: 56, top: 60, bottom: 60, width: 1, display: "flex",
            background: `linear-gradient(180deg, transparent, rgba(${a},.28) 30%, rgba(${a2},.28) 70%, transparent)`,
          }}
        />

        {/* ═════════════════ MAIN CONTENT (centered) ═════════════════ */}
        <div
          style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Logo mark with glow bg */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: logoSize + 24,
              height: logoSize + 24,
              marginBottom: isMain ? 28 : 20,
            }}
          >
            {/* Glow behind logo */}
            <div
              style={{
                position: "absolute", inset: -8,
                borderRadius: "50%",
                background: `radial-gradient(circle, rgba(${a},.2) 0%, transparent 70%)`,
                filter: "blur(16px)",
                display: "flex",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              width={logoSize}
              height={logoSize}
              style={{ display: "flex", filter: `drop-shadow(0 0 ${isMain ? 24 : 16}px rgba(${a},.55))` }}
              alt="TRIOZ"
            />
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: cfg.titleSize ?? 86,
              fontWeight: 900,
              color: "#f0f2ff",
              letterSpacing: isMain ? "-0.04em" : "-0.025em",
              lineHeight: 1,
              display: "flex",
              textShadow:
                `0 0 80px rgba(${a},.45),` +
                `0 0 160px rgba(${a},.18)`,
            }}
          >
            {cfg.title}
          </div>

          {/* Accent divider */}
          <div
            style={{
              width: isMain ? 200 : 140,
              height: 2,
              marginTop: 22,
              marginBottom: 22,
              display: "flex",
              background: `linear-gradient(90deg, transparent, ${cfg.accent}, ${cfg.accent2}, transparent)`,
              borderRadius: 1,
            }}
          />

          {/* Subtitle */}
          <div
            style={{
              fontSize: isMain ? 26 : 22,
              fontWeight: 400,
              color: `rgba(${a},.75)`,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            {cfg.subtitle}
          </div>
        </div>

        {/* ── Bottom domain bar ── */}
        <div
          style={{
            position: "absolute",
            bottom: 30, left: 0, right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          {/* mini logo mark */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoDataUrl(cfg.accent, 0.7)}
            width={18}
            height={18}
            style={{ display: "flex", opacity: 0.7 }}
            alt=""
          />
          <div
            style={{
              fontSize: 14,
              color: `rgba(${a},.42)`,
              letterSpacing: "0.14em",
              fontWeight: 500,
              display: "flex",
            }}
          >
            {cfg.tag}
          </div>
          <div
            style={{
              width: 5, height: 5, borderRadius: "50%",
              background: cfg.accent2,
              opacity: 0.5,
              display: "flex",
              boxShadow: `0 0 6px ${cfg.accent2}`,
            }}
          />
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
