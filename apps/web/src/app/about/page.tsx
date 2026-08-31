"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import DesktopDownload from "@/components/DesktopDownload";
import { LEGAL_DEFAULTS, LEGAL_SECTIONS, legalKeys } from "@/lib/legal";
import { AnimatePresence } from "framer-motion";

// ─── Types ───────────────────────────────────────────────────────────────────
interface AboutBlock {
  id: string;
  order: number;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: string;
  layout: string;
  textAlign: string;
  glowColor: string;
  shape: string;
  spacingTop: number;
  enabled: boolean;
}

// ─── Shape clip-paths ─────────────────────────────────────────────────────────
const SHAPE_CLIPS: Record<string, string> = {
  rectangle: "none",
  "skewed-left":  "polygon(0 4%, 100% 0, 100% 96%, 0 100%)",
  "skewed-right": "polygon(0 0, 100% 4%, 100% 100%, 0 96%)",
  rounded:        "none",   // handled via borderRadius
  hexagon:        "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  diamond:        "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
};

const SHAPE_RADIUS: Record<string, string> = {
  rectangle:      "1.5rem",
  "skewed-left":  "0",
  "skewed-right": "0",
  rounded:        "3rem",
  hexagon:        "0",
  diamond:        "0",
};

// ─── Single landing block ─────────────────────────────────────────────────────
function LandingBlock({ block, index }: { block: AboutBlock; index: number }) {
  const clip = SHAPE_CLIPS[block.shape] ?? "none";
  const radius = SHAPE_RADIUS[block.shape] ?? "1.5rem";
  const isCentered = block.layout === "centered";
  const mediaRight = block.layout === "text-left";

  const glowBg = `radial-gradient(ellipse 80% 60% at 50% 50%, ${block.glowColor}22 0%, transparent 70%)`;
  const border = `${block.glowColor}33`;
  const shadow = `0 0 60px -20px ${block.glowColor}55, 0 0 120px -40px ${block.glowColor}22`;

  const titleAlign =
    block.textAlign === "center" ? "text-center" :
    block.textAlign === "right"  ? "text-right"  : "text-left";

  const MediaEl = block.mediaUrl ? (
    <div className="relative flex-1 min-h-[200px] flex items-center justify-center">
      {block.mediaType === "video" ? (
        <video
          src={block.mediaUrl}
          autoPlay
          loop
          muted
          playsInline
          className="w-full max-h-[480px] rounded-2xl object-cover"
          style={{ boxShadow: `0 0 40px -10px ${block.glowColor}66` }}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={block.mediaUrl}
          alt={block.title}
          className="w-full max-h-[480px] rounded-2xl object-cover"
          style={{ boxShadow: `0 0 40px -10px ${block.glowColor}66` }}
        />
      )}
      {/* Glow under media */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{ boxShadow: `inset 0 0 60px -20px ${block.glowColor}44` }}
      />
    </div>
  ) : null;

  const TextEl = (
    <div className={`flex-1 flex flex-col justify-center gap-4 ${titleAlign}`}>
      <h2
        className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight"
        style={{
          background: `linear-gradient(135deg, #fff 0%, ${block.glowColor} 60%, #fff 100%)`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter: `drop-shadow(0 0 12px ${block.glowColor}88)`,
        }}
      >
        {block.title}
      </h2>
      <p
        className="text-base sm:text-lg leading-relaxed"
        style={{ color: "rgba(255,255,255,0.75)" }}
      >
        {block.description}
      </p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay: index * 0.05, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ marginTop: block.spacingTop }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          clipPath: clip !== "none" ? clip : undefined,
          borderRadius: clip === "none" ? radius : undefined,
          border: clip === "none" ? `1px solid ${border}` : undefined,
          background: `linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)`,
          boxShadow: clip === "none" ? shadow : undefined,
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Ambient glow bg */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: glowBg }}
        />
        {/* Top accent line */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${block.glowColor}88, transparent)` }}
        />

        <div className={`relative z-10 px-6 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-20 ${
          isCentered
            ? "flex flex-col items-center text-center gap-8"
            : "flex flex-col lg:flex-row items-center gap-8 lg:gap-16"
        }`}>
          {isCentered ? (
            <>
              {TextEl}
              {MediaEl && <div className="w-full max-w-2xl">{MediaEl}</div>}
            </>
          ) : mediaRight ? (
            <>{TextEl}{MediaEl}</>
          ) : (
            <>{MediaEl}{TextEl}</>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Legal section (unchanged) ────────────────────────────────────────────────
function LegalSection() {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/site-content")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, string>) => { if (d) setOverrides(d); })
      .catch(() => {});
  }, []);

  const pick = (key: string, def: string) => {
    const v = overrides[key];
    return v && v.trim() ? v : def;
  };

  const legalSections = LEGAL_SECTIONS.map((s, i) => ({
    title: pick(legalKeys.sectionTitle(i), s.title),
    content: pick(legalKeys.sectionContent(i), s.content),
  }));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-20">
      <div className="mb-8 flex items-center gap-4">
        <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
        <span className="text-xs font-medium uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>Юридическая информация</span>
        <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
      </div>
      <button
        onClick={() => setOpen(!open)}
        className="group relative w-full overflow-hidden rounded-2xl transition-all duration-300"
        style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5" style={{ color: "rgba(255,255,255,0.4)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">{pick(legalKeys.heading, LEGAL_DEFAULTS.heading)}</div>
              <div className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{pick(legalKeys.subheading, LEGAL_DEFAULTS.subheading)}</div>
            </div>
          </div>
          <motion.svg animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3 }}
            className="h-5 w-5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.25,0.1,0.25,1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl p-6" style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
              <p className="mb-6 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                {overrides[legalKeys.preamble]?.trim() ||
                  "Настоящий документ является официальным пользовательским соглашением проекта TRIOZ."}
              </p>
              <div className="space-y-2">
                {legalSections.map((s, i) => (
                  <div key={i} className="overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
                    <button
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                      style={{ background: expandedIdx === i ? "rgba(255,255,255,0.04)" : undefined }}
                    >
                      <span className="text-sm font-medium text-white">{s.title}</span>
                      <motion.svg animate={{ rotate: expandedIdx === i ? 180 : 0 }} transition={{ duration: 0.2 }}
                        className="h-4 w-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </motion.svg>
                    </button>
                    <AnimatePresence>
                      {expandedIdx === i && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                          <div className="px-4 pb-4">
                            <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "rgba(255,255,255,0.55)" }}>{s.content}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AboutPage() {
  const [blocks, setBlocks] = useState<AboutBlock[]>([]);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState("#000000");

  useEffect(() => {
    fetch("/api/admin/about-blocks")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AboutBlock[]) => setBlocks(data.filter((b) => b.enabled)))
      .catch(() => {});

    fetch("/api/site-content")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, string>) => {
        if (d["about.bg.url"]) setBgUrl(d["about.bg.url"]);
        if (d["about.bg.color"]) setBgColor(d["about.bg.color"]);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ color: "#fff" }}
    >
      {/* ── Background ── */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundColor: bgColor,
          backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
          backgroundRepeat: "repeat",
          backgroundSize: "auto",
        }}
      />

      {/* ── Back button ── */}
      <div className="fixed top-4 left-4 z-50">
        <Link href="/">
          <motion.button
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium backdrop-blur-xl transition-all duration-300"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.45)",
              color: "rgba(255,255,255,0.7)",
            }}
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

      {/* ── Content ── */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-24 pt-24">
        {blocks.length === 0 ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <p style={{ color: "rgba(255,255,255,0.25)" }} className="text-sm">
              Блоки ещё не добавлены — раздел заполняется в{" "}
              <Link href="/admin/about" className="underline opacity-60 hover:opacity-100">Админ-панели</Link>.
            </p>
          </div>
        ) : (
          <div>
            {blocks.map((block, i) => (
              <LandingBlock key={block.id} block={block} index={i} />
            ))}
          </div>
        )}

        {/* ── Desktop download ── */}
        <div className="mt-24">
          <DesktopDownload />
        </div>

        {/* ── Legal ── */}
        <LegalSection />

        {/* ── Footer ── */}
        <p className="mt-16 text-center text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>
          © {new Date().getFullYear()} T.Р.И.О.Z
        </p>
      </div>
    </div>
  );
}
