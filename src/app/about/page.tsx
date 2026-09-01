"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import DesktopDownload from "@/components/DesktopDownload";
import { LEGAL_DEFAULTS, LEGAL_SECTIONS, legalKeys } from "@/lib/legal";

/* ─── Types ─── */
interface AboutBlock {
  id: string;
  order: number;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: string;
  layout: string;     // text-left | text-right | centered
  textAlign: string;  // left | center | right
  glowColor: string;
  shape: string;      // rectangle | rounded | skewed-left | skewed-right | hexagon | diamond
  spacingTop: number;
  enabled: boolean;
}

/* ─── Clip-path map ─── */
const CLIP: Record<string, string> = {
  rectangle:      "none",
  rounded:        "none",
  "skewed-left":  "polygon(2% 0%, 100% 0%, 98% 100%, 0% 100%)",
  "skewed-right": "polygon(0% 0%, 98% 0%, 100% 100%, 2% 100%)",
  hexagon:        "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
  diamond:        "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
};

const RADIUS: Record<string, string> = {
  rectangle: "1rem",
  rounded:   "2.5rem",
};

/* ─── Landing block ─── */
function LandingBlock({ block, index }: { block: AboutBlock; index: number }) {
  const centered = block.layout === "centered";
  const textRight = block.layout === "text-right";
  const hasMedia = !!block.mediaUrl;

  const clipPath = CLIP[block.shape] ?? "none";
  const borderRadius = RADIUS[block.shape] ?? "0";

  const textSection = (
    <div
      className={`flex flex-col justify-center ${
        centered ? "items-center text-center" : ""
      }`}
      style={{ textAlign: block.textAlign as ("left" | "right" | "center" | "justify") }}
    >
      <h2
        className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight"
        style={{
          background: `linear-gradient(135deg, #fff 0%, ${block.glowColor} 100%)`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter: `drop-shadow(0 0 20px ${block.glowColor}88)`,
        }}
      >
        {block.title}
      </h2>
      {block.description && (
        <p
          className="mt-5 text-base md:text-lg leading-relaxed text-white/70 max-w-xl"
          style={{ margin: centered ? "1.25rem auto 0" : undefined }}
        >
          {block.description}
        </p>
      )}
    </div>
  );

  const mediaSection = hasMedia ? (
    <div className="relative flex items-center justify-center">
      <div
        className="overflow-hidden w-full max-h-[420px]"
        style={{
          clipPath,
          borderRadius,
          boxShadow: `0 0 60px -10px ${block.glowColor}66`,
        }}
      >
        {block.mediaType === "video" ? (
          <video
            src={block.mediaUrl!}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.mediaUrl!}
            alt={block.title}
            className="w-full h-full object-cover"
          />
        )}
      </div>
      {/* Glow halo */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(ellipse at center, ${block.glowColor}22 0%, transparent 70%)`,
        }}
      />
    </div>
  ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay: index * 0.05, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ marginTop: block.spacingTop }}
    >
      {/* Block wrapper with gradient + glow */}
      <div
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${block.glowColor}18 0%, #0a0a0a 60%)`,
          border: `1px solid ${block.glowColor}33`,
          borderRadius: "1.5rem",
          boxShadow: `0 0 40px -15px ${block.glowColor}55, inset 0 1px 0 ${block.glowColor}22`,
        }}
      >
        {/* Top accent line */}
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${block.glowColor}88 50%, transparent 100%)`,
          }}
        />

        <div
          className={`relative z-10 p-8 md:p-12 ${
            centered
              ? "flex flex-col items-center"
              : `grid gap-10 md:gap-16 items-center ${
                  hasMedia
                    ? "md:grid-cols-2"
                    : "grid-cols-1"
                }`
          }`}
        >
          {centered ? (
            <>
              {textSection}
              {hasMedia && <div className="mt-8 w-full">{mediaSection}</div>}
            </>
          ) : textRight ? (
            <>
              {hasMedia && mediaSection}
              {textSection}
            </>
          ) : (
            <>
              {textSection}
              {hasMedia && mediaSection}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Legal section (unchanged from original) ─── */
function LegalSection() {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/site-content")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        if (alive && data) setOverrides(data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const pick = (key: string, def: string) => {
    const v = overrides[key];
    return v && v.trim() ? v : def;
  };
  const legalSections = LEGAL_SECTIONS.map((s, i) => ({
    title:   pick(legalKeys.sectionTitle(i), s.title),
    content: pick(legalKeys.sectionContent(i), s.content),
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.6 }}
      className="mt-20"
    >
      <div className="mb-8 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <span className="text-xs font-medium uppercase tracking-widest text-white/30">Юридическая информация</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl transition-all duration-300 hover:border-white/[0.13] hover:shadow-lg"
      >
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gray-500 opacity-30 transition-opacity group-hover:opacity-60" />
        <div className="flex items-center justify-between p-5 pl-7">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">{pick(legalKeys.heading, LEGAL_DEFAULTS.heading)}</div>
              <div className="mt-0.5 text-xs text-gray-500">{pick(legalKeys.subheading, LEGAL_DEFAULTS.subheading)}</div>
            </div>
          </div>
          <motion.svg
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="h-5 w-5 flex-shrink-0 text-gray-500"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] backdrop-blur-xl p-6 md:p-8">
              <p className="mb-6 text-sm leading-relaxed text-gray-400">
                {overrides[legalKeys.preamble]?.trim() ? (
                  <span className="whitespace-pre-line">{overrides[legalKeys.preamble]}</span>
                ) : (
                  <>
                    Настоящий документ представляет собой официальное публичное предложение (публичную оферту)
                    проекта TRIOZ, доступного в сети Интернет по адресу{" "}
                    <a href="https://trioz.ru" className="text-accent hover:underline">trioz.ru</a>.
                  </>
                )}
              </p>
              <div className="space-y-2">
                {legalSections.map((s, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/[0.05]">
                    <button
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <span className="text-sm font-medium text-gray-300">{s.title}</span>
                      <motion.svg
                        animate={{ rotate: expandedIdx === i ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="h-4 w-4 flex-shrink-0 text-gray-600"
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </motion.svg>
                    </button>
                    <AnimatePresence>
                      {expandedIdx === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="overflow-hidden"
                        >
                          <div className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-gray-400">
                            {s.content}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-white/[0.05] pt-5 sm:flex-row sm:items-center">
                <div className="text-xs text-gray-600">Для юридических запросов:{" "}<a href="mailto:legal@trioz.ru" className="text-accent hover:underline">legal@trioz.ru</a></div>
                <div className="text-xs text-gray-600">trioz.ru — Юридическая документация</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Page ─── */
export default function AboutPage() {
  const [blocks, setBlocks]   = useState<AboutBlock[]>([]);
  const [bgUrl, setBgUrl]     = useState("");
  const [bgColor, setBgColor] = useState("#000000");

  useEffect(() => {
    // Load blocks
    fetch("/api/admin/about-blocks")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AboutBlock[]) => setBlocks(data.filter((b) => b.enabled)))
      .catch(() => {});

    // Load background from site-content
    fetch("/api/site-content")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        if (data["about.bg.url"])   setBgUrl(data["about.bg.url"]);
        if (data["about.bg.color"]) setBgColor(data["about.bg.color"]);
      })
      .catch(() => {});
  }, []);

  const bgStyle: React.CSSProperties = {
    backgroundColor: bgColor,
    ...(bgUrl
      ? {
          backgroundImage: `url(${bgUrl})`,
          backgroundRepeat: "repeat",
          backgroundSize: "auto",
          backgroundAttachment: "scroll",
        }
      : {}),
  };

  return (
    <div
      className="relative min-h-screen overflow-x-hidden text-white"
      style={bgStyle}
    >
      {/* Dark overlay so text stays readable over any texture */}
      <div className="pointer-events-none fixed inset-0 bg-black/40" style={{ zIndex: 0 }} />

      {/* Back button */}
      <div className="fixed top-4 left-4 z-50">
        <Link href="/">
          <motion.button
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm font-medium text-gray-300 backdrop-blur-xl transition-all duration-300 hover:border-cyan-400/40 hover:text-cyan-400"
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Назад
          </motion.button>
        </Link>
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-20 pb-24">
        {/* Landing blocks */}
        {blocks.length > 0 ? (
          <div>
            {blocks.map((block, i) => (
              <LandingBlock key={block.id} block={block} index={i} />
            ))}
          </div>
        ) : (
          /* Fallback hero if no blocks configured */
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="py-24 text-center"
          >
            <h1
              className="text-6xl md:text-8xl font-black leading-tight"
              style={{
                background: "linear-gradient(135deg, #fff 0%, #8b5cf6 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 0 30px #8b5cf688)",
              }}
            >
              TrioZ
            </h1>
            <p className="mt-6 text-lg text-white/60 max-w-xl mx-auto">
              Масштабная экосистема проектов в стиле dark fantasy и cyberpunk.
            </p>
          </motion.div>
        )}

        {/* Desktop download */}
        <div className="mt-16">
          <DesktopDownload />
        </div>

        {/* Legal section */}
        <LegalSection />

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-16 text-center text-sm text-white/20"
        >
          &copy; {new Date().getFullYear()} T.Р.И.О.Z &mdash; Экосистема проектов
        </motion.div>
      </div>
    </div>
  );
}
