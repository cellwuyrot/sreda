import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const PAGES: Record<string, { title: string; subtitle: string; accent: string; icon: string }> = {
  main: {
    title: "T.Р.И.О.Z",
    subtitle: "Экосистема проектов",
    accent: "#8b5cf6",
    icon: "◈",
  },
  about: {
    title: "О проекте",
    subtitle: "T.Р.И.О.Z — масштабная вселенная",
    accent: "#8b5cf6",
    icon: "◇",
  },
  connect: {
    title: "TZ.Connect",
    subtitle: "Коммуникационная платформа",
    accent: "#00f0ff",
    icon: "◆",
  },
  games: {
    title: "Игры",
    subtitle: "Стратегические онлайн-игры",
    accent: "#ff4444",
    icon: "⬡",
  },
  library: {
    title: "TZ.Library",
    subtitle: "База знаний и лор вселенной",
    accent: "#10b981",
    icon: "◈",
  },
  pero: {
    title: "Перо Измерений",
    subtitle: "Книги и настольные игры",
    accent: "#8b5cf6",
    icon: "✦",
  },
  projects: {
    title: "Проекты",
    subtitle: "MMORPG, стратегии, онлайн-игры",
    accent: "#ff4444",
    icon: "⬢",
  },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") || "main";
  const config = PAGES[page] || PAGES.main;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0a0a0a 0%, #171717 40%, #0f0f0f 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Geometric shapes */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 400,
            height: 400,
            borderRadius: "50%",
            border: `2px solid ${config.accent}20`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            width: 320,
            height: 320,
            borderRadius: "50%",
            border: `1px solid ${config.accent}15`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -120,
            width: 500,
            height: 500,
            borderRadius: "50%",
            border: `2px solid ${config.accent}18`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: -80,
            width: 400,
            height: 400,
            borderRadius: "50%",
            border: `1px solid ${config.accent}10`,
            display: "flex",
          }}
        />

        {/* Accent glow */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${config.accent}08 0%, transparent 70%)`,
            display: "flex",
          }}
        />

        {/* Grid lines */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `linear-gradient(${config.accent}06 1px, transparent 1px), linear-gradient(90deg, ${config.accent}06 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
            display: "flex",
          }}
        />

        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, transparent, ${config.accent}, transparent)`,
            display: "flex",
          }}
        />

        {/* Diamond shapes */}
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 60,
            width: 16,
            height: 16,
            background: config.accent,
            transform: "rotate(45deg)",
            opacity: 0.3,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 100,
            left: 100,
            width: 8,
            height: 8,
            background: config.accent,
            transform: "rotate(45deg)",
            opacity: 0.2,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 80,
            right: 80,
            width: 12,
            height: 12,
            background: config.accent,
            transform: "rotate(45deg)",
            opacity: 0.25,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 120,
            right: 140,
            width: 6,
            height: 6,
            background: config.accent,
            transform: "rotate(45deg)",
            opacity: 0.15,
            display: "flex",
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            zIndex: 10,
          }}
        >
          {/* Icon */}
          <div
            style={{
              fontSize: 56,
              color: config.accent,
              display: "flex",
              filter: `drop-shadow(0 0 30px ${config.accent}60)`,
            }}
          >
            {config.icon}
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: "white",
              letterSpacing: "-0.02em",
              textAlign: "center",
              display: "flex",
              textShadow: `0 0 60px ${config.accent}30`,
            }}
          >
            {config.title}
          </div>

          {/* Divider */}
          <div
            style={{
              width: 100,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${config.accent}, transparent)`,
              display: "flex",
            }}
          />

          {/* Subtitle */}
          <div
            style={{
              fontSize: 24,
              color: "#a3a3a3",
              textAlign: "center",
              display: "flex",
            }}
          >
            {config.subtitle}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: "absolute",
            bottom: 30,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: `2px solid ${config.accent}60`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: config.accent,
            }}
          >
            ◈
          </div>
          <div
            style={{
              fontSize: 16,
              color: "#666",
              letterSpacing: "0.1em",
              display: "flex",
            }}
          >
            connect.trioz.ru
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
