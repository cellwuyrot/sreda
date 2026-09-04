import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const PAGES: Record<string, { title: string; subtitle: string; accent: string; accent2: string; tag: string }> = {
  main: {
    title: "TRIOZ",
    subtitle: "Ecosystem of projects",
    accent: "#6366f1",
    accent2: "#8b5cf6",
    tag: "trioz.ru",
  },
  about: {
    title: "About",
    subtitle: "TRIOZ — massive universe of projects",
    accent: "#8b5cf6",
    accent2: "#a78bfa",
    tag: "trioz.ru / about",
  },
  connect: {
    title: "TZ Connect",
    subtitle: "Communication platform",
    accent: "#06b6d4",
    accent2: "#3b82f6",
    tag: "trioz.ru / connect",
  },
  games: {
    title: "Games",
    subtitle: "Strategic online games",
    accent: "#ef4444",
    accent2: "#f97316",
    tag: "trioz.ru / games",
  },
  library: {
    title: "TZ Library",
    subtitle: "Knowledge base & lore",
    accent: "#10b981",
    accent2: "#06b6d4",
    tag: "trioz.ru / library",
  },
  pero: {
    title: "Pero",
    subtitle: "Books & tabletop games",
    accent: "#8b5cf6",
    accent2: "#ec4899",
    tag: "trioz.ru / pero",
  },
  projects: {
    title: "Projects",
    subtitle: "MMORPG, strategies, online games",
    accent: "#ef4444",
    accent2: "#f97316",
    tag: "trioz.ru / projects",
  },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") || "main";
  const cfg = PAGES[page] ?? PAGES.main;

  // hex → rgb for rgba() usage
  function hexRgb(hex: string) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
  }
  const a  = hexRgb(cfg.accent);
  const a2 = hexRgb(cfg.accent2);

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
        {/* ── Deep background gradient ── */}
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          background: `radial-gradient(ellipse at 15% 85%, rgba(${a},.22) 0%, transparent 50%),
                       radial-gradient(ellipse at 85% 15%, rgba(${a2},.16) 0%, transparent 50%),
                       radial-gradient(ellipse at 50% 50%, rgba(${a},.06) 0%, transparent 70%),
                       #07090f`,
        }} />

        {/* ── Grid texture ── */}
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          backgroundImage: `linear-gradient(rgba(${a},.05) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(${a},.05) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }} />

        {/* ── Vignette edges ── */}
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.7) 100%)",
        }} />

        {/* ── Top edge glow bar ── */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2, display: "flex",
          background: `linear-gradient(90deg, transparent 0%, rgba(${a},.0) 15%, ${cfg.accent} 50%, rgba(${a2},.0) 85%, transparent 100%)`,
        }} />

        {/* ── Bottom edge glow bar ── */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 1, display: "flex",
          background: `linear-gradient(90deg, transparent, rgba(${a},.3), transparent)`,
        }} />

        {/* ── Large rings ── */}
        <div style={{
          position: "absolute", top: -200, right: -200,
          width: 700, height: 700, borderRadius: "50%",
          border: `1px solid rgba(${a},.08)`, display: "flex",
        }} />
        <div style={{
          position: "absolute", top: -120, right: -120,
          width: 520, height: 520, borderRadius: "50%",
          border: `1px solid rgba(${a},.06)`, display: "flex",
        }} />
        <div style={{
          position: "absolute", bottom: -200, left: -200,
          width: 660, height: 660, borderRadius: "50%",
          border: `1px solid rgba(${a2},.07)`, display: "flex",
        }} />
        <div style={{
          position: "absolute", bottom: -130, left: -130,
          width: 480, height: 480, borderRadius: "50%",
          border: `1px solid rgba(${a2},.05)`, display: "flex",
        }} />

        {/* ── Diamond accents ── */}
        {[
          { top: 56,  left: 56,  size: 14, op: 0.35 },
          { top: 88,  left: 92,  size:  7, op: 0.18 },
          { top: 40,  left: 140, size:  5, op: 0.12 },
          { bottom: 72, right: 72,  size: 12, op: 0.28 },
          { bottom: 108, right: 120, size:  6, op: 0.15 },
          { top: 290, right: 44,  size:  8, op: 0.20 },
        ].map((d, i) => (
          <div key={i} style={{
            position: "absolute",
            top: d.top, bottom: d.bottom,
            left: d.left, right: d.right,
            width: d.size, height: d.size,
            background: i % 2 === 0 ? cfg.accent : cfg.accent2,
            opacity: d.op,
            transform: "rotate(45deg)",
            display: "flex",
          }} />
        ))}

        {/* ── Glowing orb behind title ── */}
        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          width: 500, height: 300,
          marginTop: -150, marginLeft: -250,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at center, rgba(${a},.12) 0%, transparent 70%)`,
          display: "flex",
          filter: "blur(40px)",
        }} />

        {/* ── Left vertical accent line ── */}
        <div style={{
          position: "absolute", left: 56, top: 56, bottom: 56,
          width: 1, display: "flex",
          background: `linear-gradient(180deg, transparent, rgba(${a},.25) 30%, rgba(${a2},.25) 70%, transparent)`,
        }} />

        {/* ── Main content (centered column) ── */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}>

          {/* Logo hex icon */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56, height: 56,
            marginBottom: 28,
            border: `1.5px solid rgba(${a},.5)`,
            borderRadius: 12,
            background: `rgba(${a},.08)`,
            position: "relative",
          }}>
            {/* X cross inside square */}
            <div style={{
              position: "absolute",
              top: 8, left: 8, right: 8, bottom: 8,
              display: "flex",
            }}>
              {/* diagonal lines simulated with thin borders */}
              <div style={{
                position: "absolute", inset: 0,
                border: `1.5px solid rgba(${a},.7)`,
                borderRadius: 3,
                display: "flex",
              }} />
              <div style={{
                position: "absolute",
                top: "50%", left: 0, right: 0,
                height: 1.5,
                background: `rgba(${a},.7)`,
                transform: "rotate(45deg)",
                display: "flex",
              }} />
              <div style={{
                position: "absolute",
                top: "50%", left: 0, right: 0,
                height: 1.5,
                background: `rgba(${a},.7)`,
                transform: "rotate(-45deg)",
                display: "flex",
              }} />
            </div>
          </div>

          {/* Title: TRIOZ */}
          <div style={{
            fontSize: cfg.title === "TRIOZ" ? 112 : 80,
            fontWeight: 900,
            color: "#f0f2ff",
            letterSpacing: cfg.title === "TRIOZ" ? "-0.04em" : "-0.02em",
            lineHeight: 1,
            display: "flex",
            textShadow: `0 0 80px rgba(${a},.4), 0 0 160px rgba(${a},.15)`,
          }}>
            {cfg.title}
          </div>

          {/* Accent divider */}
          <div style={{
            width: cfg.title === "TRIOZ" ? 180 : 120,
            height: 2,
            marginTop: 24,
            marginBottom: 24,
            display: "flex",
            background: `linear-gradient(90deg, transparent, ${cfg.accent}, ${cfg.accent2}, transparent)`,
            borderRadius: 1,
          }} />

          {/* Subtitle */}
          <div style={{
            fontSize: 26,
            fontWeight: 400,
            color: `rgba(${a},.7)`,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            display: "flex",
          }}>
            {cfg.subtitle}
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div style={{
          position: "absolute",
          bottom: 32,
          left: 0, right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}>
          {/* dot */}
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: cfg.accent, display: "flex",
            boxShadow: `0 0 8px ${cfg.accent}`,
          }} />
          <div style={{
            fontSize: 15,
            color: `rgba(${a},.4)`,
            letterSpacing: "0.12em",
            fontWeight: 500,
            display: "flex",
          }}>
            {cfg.tag.toUpperCase()}
          </div>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: cfg.accent2, display: "flex",
            boxShadow: `0 0 8px ${cfg.accent2}`,
          }} />
        </div>

        {/* ── Corner brackets (top-left, bottom-right) ── */}
        {/* top-left */}
        <div style={{ position: "absolute", top: 24, left: 24, display: "flex" }}>
          <div style={{
            width: 24, height: 24,
            borderTop: `1.5px solid rgba(${a},.3)`,
            borderLeft: `1.5px solid rgba(${a},.3)`,
            display: "flex",
          }} />
        </div>
        {/* top-right */}
        <div style={{ position: "absolute", top: 24, right: 24, display: "flex" }}>
          <div style={{
            width: 24, height: 24,
            borderTop: `1.5px solid rgba(${a2},.3)`,
            borderRight: `1.5px solid rgba(${a2},.3)`,
            display: "flex",
          }} />
        </div>
        {/* bottom-left */}
        <div style={{ position: "absolute", bottom: 24, left: 24, display: "flex" }}>
          <div style={{
            width: 24, height: 24,
            borderBottom: `1.5px solid rgba(${a},.3)`,
            borderLeft: `1.5px solid rgba(${a},.3)`,
            display: "flex",
          }} />
        </div>
        {/* bottom-right */}
        <div style={{ position: "absolute", bottom: 24, right: 24, display: "flex" }}>
          <div style={{
            width: 24, height: 24,
            borderBottom: `1.5px solid rgba(${a2},.3)`,
            borderRight: `1.5px solid rgba(${a2},.3)`,
            display: "flex",
          }} />
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
