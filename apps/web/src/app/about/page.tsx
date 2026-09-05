"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import CosmicBackground from "@/components/about/CosmicBackground";
import DesktopDownload from "@/components/DesktopDownload";
import { LEGAL_DEFAULTS, LEGAL_SECTIONS } from "@/lib/legal";
import type {
  AboutBlockRow,
  HeroData,
  VideoData,
  StatsData,
  GalleryData,
  BentoData,
  TimelineData,
  TeamData,
  CtaData,
  GalleryItem,
} from "@/lib/aboutBlocks";

// ---------- helpers ----------

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, delay, ease: [0.25, 0.1, 0.25, 1] as [number,number,number,number] },
});

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-400 mb-3">
      {children}
    </p>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-4xl md:text-5xl font-black text-neutral-900 dark:text-white leading-[1.08] mb-3 ${className ?? ""}`}>
      {children}
    </h2>
  );
}

// ---------- Block components ----------

function HeroBlock({ data }: { data: HeroData }) {
  return (
    <section
      className="relative min-h-[640px] flex flex-col items-center justify-center px-6 py-20 overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.22) 0%,transparent 55%)," +
          "radial-gradient(ellipse at 15% 100%,rgba(139,92,246,.14) 0%,transparent 45%)," +
          "radial-gradient(ellipse at 85% 90%,rgba(6,182,212,.1) 0%,transparent 40%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,102,241,.06) 1px,transparent 1px)," +
            "linear-gradient(90deg,rgba(99,102,241,.06) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center,black 30%,transparent 75%)",
        }}
      />

      {data.badge && (
        <motion.div {...fadeUp(0.1)} className="mb-8 inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-5 py-2">
          <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">{data.badge}</span>
        </motion.div>
      )}

      <motion.h1
        {...fadeUp(0.15)}
        className="mb-3 text-center text-[80px] md:text-[100px] font-black leading-none"
        style={{
          background: "linear-gradient(135deg,#f0f2ff 0%,#c4b5fd 40%,#67e8f9 80%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          filter: "drop-shadow(0 0 60px rgba(99,102,241,.35))",
        }}
      >
        {data.title}
      </motion.h1>

      {data.subtitle && (
        <motion.p {...fadeUp(0.2)} className="mb-4 text-center text-2xl font-light text-white/40">
          {data.subtitle}
        </motion.p>
      )}

      {data.description && (
        <motion.p {...fadeUp(0.25)} className="mx-auto mb-10 max-w-lg text-center text-lg leading-relaxed text-white/60">
          {data.description}
        </motion.p>
      )}

      <motion.div {...fadeUp(0.3)} className="flex flex-wrap gap-4 justify-center">
        {data.primaryCta && (
          <Link
            href={data.primaryCta.href}
            className="flex items-center gap-2 rounded-xl px-7 py-3.5 text-[15px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 0 30px rgba(99,102,241,.4)" }}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {data.primaryCta.label}
          </Link>
        )}
        {data.secondaryCta?.href && (
          <Link
            href={data.secondaryCta.href}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-7 py-3.5 text-[15px] font-semibold text-white/70 hover:bg-white/[0.07] transition-colors"
          >
            {data.secondaryCta.label}
          </Link>
        )}
      </motion.div>
    </section>
  );
}

function VideoBlock({ data }: { data: VideoData }) {
  if (!data.url && !data.youtubeId) return null;
  return (
    <section className="px-6 py-4 flex justify-center">
      <motion.div
        {...fadeUp()}
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-indigo-500/30"
        style={{ boxShadow: "0 0 80px rgba(99,102,241,.2),0 40px 80px rgba(0,0,0,.6)" }}
      >
        {data.youtubeId ? (
          <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${data.youtubeId}?rel=0&modestbranding=1`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={data.url}
              controls
              playsInline
            />
          </div>
        )}
        {(data.tag || data.title) && (
          <div className="flex items-center gap-3 border-t border-indigo-500/15 bg-black/40 px-4 py-3">
            {data.tag && (
              <span className="rounded-full border border-indigo-500/35 bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-300">
                {data.tag}
              </span>
            )}
            {data.title && <span className="text-sm text-white/60">{data.title}</span>}
            {data.duration && <span className="ml-auto text-xs text-white/30">{data.duration}</span>}
          </div>
        )}
      </motion.div>
    </section>
  );
}

function StatsBlock({ data }: { data: StatsData }) {
  if (!data.items?.length) return null;
  return (
    <section
      className="grid border-y border-indigo-500/10 bg-white/[0.018]"
      style={{ gridTemplateColumns: `repeat(${data.items.length},1fr)` }}
    >
      {data.items.map((item, i) => (
        <motion.div
          key={i}
          {...fadeUp(i * 0.05)}
          className="flex flex-col items-center py-7 px-4 border-r border-indigo-500/08 last:border-0 text-center"
        >
          <span
            className="block text-4xl font-black mb-1"
            style={{ background: "linear-gradient(135deg,#a5b4fc,#67e8f9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            {item.value}
          </span>
          <span className="text-xs text-neutral-500 tracking-wide">{item.label}</span>
        </motion.div>
      ))}
    </section>
  );
}

function MediaItem({ item, fill }: { item: GalleryItem; fill?: boolean }) {
  const isVideo = item.mediaType === "video";
  const isGif = item.mediaType === "gif" || item.isGif;
  return (
    <>
      {isVideo ? (
        <video src={item.url} className={`${fill ? "absolute inset-0 h-full w-full" : "h-full w-full"} object-cover`} muted loop playsInline autoPlay />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.caption ?? ""} className={`${fill ? "absolute inset-0 h-full w-full" : "h-full w-full"} object-cover`} />
      )}
      {item.tag && (
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] uppercase tracking-wide text-white/70 border border-white/10">
          {item.tag}
        </span>
      )}
      {isGif && (
        <span className="absolute top-2.5 right-2.5 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">GIF</span>
      )}
    </>
  );
}

function GalleryBlock({ data }: { data: GalleryData }) {
  const items = data.items ?? [];
  if (!items.length) return null;
  const big = items[0];
  const rest = items.slice(1, 5);
  return (
    <section
      className="px-6 md:px-10 lg:px-16 py-16"
      style={{ background: "radial-gradient(ellipse at 90% 50%,rgba(6,182,212,.06) 0%,transparent 55%)" }}
    >
      <motion.div {...fadeUp()}>
        {data.title && <SectionLabel>Медиа-галерея</SectionLabel>}
        {data.title && <SectionTitle>{data.title}</SectionTitle>}
        {data.subtitle && <p className="mb-10 text-sm text-neutral-500">{data.subtitle}</p>}
      </motion.div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "1.6fr 1fr 1fr", gridTemplateRows: "200px 200px" }}>
        {big && (
          <motion.div {...fadeUp(0.05)} className="row-span-2 overflow-hidden rounded-2xl border border-white/06 bg-neutral-900 relative group">
            <MediaItem item={big} fill />
          </motion.div>
        )}
        {rest.map((item, i) => (
          <motion.div key={item.id} {...fadeUp(0.1 + i * 0.05)} className="overflow-hidden rounded-2xl border border-white/06 bg-neutral-900 relative group">
            <MediaItem item={item} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function BentoBlock({ data }: { data: BentoData }) {
  const items = data.items ?? [];
  if (!items.length) return null;
  return (
    <section className="px-6 md:px-10 lg:px-16 py-16">
      <motion.div {...fadeUp()}>
        {data.title && <SectionLabel>Разделы</SectionLabel>}
        {data.title && <SectionTitle>{data.title}</SectionTitle>}
        {data.subtitle && <p className="mb-8 text-sm text-neutral-500">{data.subtitle}</p>}
      </motion.div>
      <div className="grid gap-3 grid-cols-3">
        {items.map((item, i) => (
          <motion.div key={item.key} {...fadeUp(i * 0.07)} className={item.wide ? "col-span-2" : ""}>
            <Link
              href={item.href ?? "#"}
              className="group relative flex h-full min-h-[160px] flex-col overflow-hidden rounded-2xl border border-white/07 bg-white/[0.025] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-40 transition-opacity group-hover:opacity-100"
                style={{ background: `linear-gradient(90deg,transparent,${item.color},transparent)` }}
              />
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border text-xl transition-transform duration-300 group-hover:scale-110"
                style={{ color: item.color, borderColor: `${item.color}40`, backgroundColor: `${item.color}14`, boxShadow: `0 0 20px -6px ${item.color}66` }}
              >
                {item.icon}
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">{item.title}</h3>
              <p className="text-sm leading-relaxed text-neutral-500">{item.description}</p>
              <span className="mt-4 flex items-center gap-1.5 text-xs font-semibold transition-all duration-200 group-hover:gap-2" style={{ color: item.color }}>
                Перейти{" "}
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TimelineBlock({ data }: { data: TimelineData }) {
  const items = data.items ?? [];
  if (!items.length) return null;
  return (
    <section className="px-6 md:px-10 lg:px-16 py-16">
      <motion.div {...fadeUp()}>
        {data.title && <SectionLabel>История</SectionLabel>}
        {data.title && <SectionTitle>{data.title}</SectionTitle>}
      </motion.div>
      <div className="relative mt-8 flex flex-col pl-6">
        <div
          className="pointer-events-none absolute left-[7px] top-4 bottom-4 w-px"
          style={{ background: "linear-gradient(180deg,rgba(99,102,241,.5),rgba(139,92,246,.3),transparent)" }}
        />
        {items.map((item, i) => (
          <motion.div key={i} {...fadeUp(i * 0.08)} className="flex gap-5 py-4">
            <div
              className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 -ml-7"
              style={{
                background: item.color ?? "#6366f1",
                borderColor: item.color ?? "#6366f1",
                boxShadow: item.current ? `0 0 10px ${item.color ?? "#6366f1"}` : undefined,
                borderStyle: item.current ? "dashed" : "solid",
              }}
            />
            <div className="min-w-[40px] text-xs font-semibold text-neutral-500 pt-0.5">{item.year}</div>
            <div>
              <div
                className="mb-1 text-[15px] font-bold text-white"
                style={item.current ? { color: item.color ?? "#6366f1" } : undefined}
              >
                {item.title}
              </div>
              {item.description && (
                <div className="text-sm leading-relaxed text-neutral-600">{item.description}</div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TeamBlock({ data }: { data: TeamData }) {
  const members = data.members ?? [];
  if (!members.length) return null;
  return (
    <section className="px-6 md:px-10 lg:px-16 py-16">
      <motion.div {...fadeUp()}>
        {data.title && <SectionLabel>Команда</SectionLabel>}
        {data.title && <SectionTitle>{data.title}</SectionTitle>}
      </motion.div>
      <div className="mt-10 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {members.map((m, i) => (
          <motion.div
            key={m.id}
            {...fadeUp(i * 0.07)}
            className="flex flex-col items-center rounded-2xl border border-white/06 bg-white/[0.022] p-6 text-center"
          >
            {m.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.avatarUrl}
                alt={m.name}
                className="mb-4 h-16 w-16 rounded-full object-cover border-2"
                style={{ borderColor: `${m.color ?? "#6366f1"}55` }}
              />
            ) : (
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl border-2"
                style={{ background: `${m.color ?? "#6366f1"}14`, borderColor: `${m.color ?? "#6366f1"}40` }}
              >
                {m.emoji ?? "👤"}
              </div>
            )}
            <div className="mb-1 text-[15px] font-bold text-white">{m.name}</div>
            <div className="text-xs text-neutral-500">{m.role}</div>
          </motion.div>
        ))}
        {data.joinLabel && data.joinHref && (
          <motion.div {...fadeUp(members.length * 0.07)}>
            <Link
              href={data.joinHref}
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-500/15 p-6 text-center hover:border-indigo-500/30 transition-colors h-full min-h-[160px]"
            >
              <div className="mb-3 text-3xl text-neutral-600">+</div>
              <div className="text-sm font-semibold text-neutral-600">{data.joinLabel}</div>
            </Link>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function CtaBlock({ data }: { data: CtaData }) {
  return (
    <section
      className="mx-6 md:mx-10 lg:mx-16 mb-12 overflow-hidden rounded-3xl border border-indigo-500/22 p-14 text-center relative"
      style={{ background: "linear-gradient(135deg,rgba(99,102,241,.14),rgba(139,92,246,.09))" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center,rgba(99,102,241,.1),transparent 70%)" }}
      />
      <motion.div {...fadeUp()}>
        <h2 className="relative mb-4 text-5xl font-black text-white">{data.title}</h2>
        {data.subtitle && <p className="relative mb-9 text-lg text-neutral-500">{data.subtitle}</p>}
        <div className="relative flex flex-wrap gap-4 justify-center">
          {data.primaryCta && (
            <Link
              href={data.primaryCta.href}
              className="flex items-center gap-2 rounded-xl px-8 py-3.5 text-[15px] font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 0 30px rgba(99,102,241,.4)" }}
            >
              {data.primaryCta.label}
            </Link>
          )}
          {data.secondaryCta && (
            <Link
              href={data.secondaryCta.href}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-8 py-3.5 text-[15px] font-semibold text-white/70 hover:bg-white/[0.07] transition-colors"
            >
              {data.secondaryCta.label}
            </Link>
          )}
        </div>
      </motion.div>
    </section>
  );
}

// ---------- Legal accordion (сохранена из старой страницы) ----------

function LegalAccordion() {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8 }}
      className="px-6 md:px-10 lg:px-16 pb-10"
    >
      {/* Divider */}
      <div className="mb-8 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <span className="text-xs font-medium uppercase tracking-widest text-neutral-600">Юридическая информация</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* Toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl transition-all duration-300 hover:border-white/[0.13]"
      >
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gray-500 opacity-30 transition-opacity group-hover:opacity-60" />
        <div className="flex items-center justify-between p-5 pl-7">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">{LEGAL_DEFAULTS.heading}</div>
              <div className="mt-0.5 text-xs text-neutral-500">{LEGAL_DEFAULTS.subheading}</div>
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

      {/* Expandable */}
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
              <p className="mb-6 text-sm leading-relaxed text-neutral-500">
                Настоящий документ представляет собой официальную публичную оферту проекта TRIOZ, доступного
                по адресу{" "}
                <a href="https://trioz.ru" className="text-indigo-400 hover:underline">trioz.ru</a>.
                Использование Платформы является акцептом данной оферты.
              </p>

              <div className="space-y-2">
                {LEGAL_SECTIONS.map((s, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/[0.05]">
                    <button
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <span className="text-sm font-medium text-neutral-300">{s.title}</span>
                      <motion.svg
                        animate={{ rotate: expandedIdx === i ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="h-4 w-4 flex-shrink-0 text-neutral-600"
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
                          <div className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-neutral-500">
                            {s.content}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-white/[0.05] pt-5 sm:flex-row sm:items-center">
                <div className="text-xs text-neutral-600">
                  Для юридических запросов:{" "}
                  <a href="mailto:legal@trioz.ru" className="text-indigo-400 hover:underline">legal@trioz.ru</a>
                </div>
                <div className="text-xs text-neutral-600">trioz.ru — Юридическая документация</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------- Page ----------

export default function AboutPage() {
  const [blocks, setBlocks] = useState<AboutBlockRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/about-blocks")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AboutBlockRow[]) => setBlocks(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const renderBlock = (block: AboutBlockRow) => {
    const d = block.data as unknown;
    switch (block.type) {
      case "hero":     return <HeroBlock     key={block.id} data={d as HeroData} />;
      case "video":    return <VideoBlock     key={block.id} data={d as VideoData} />;
      case "stats":    return <StatsBlock     key={block.id} data={d as StatsData} />;
      case "gallery":  return <GalleryBlock   key={block.id} data={d as GalleryData} />;
      case "bento":    return <BentoBlock     key={block.id} data={d as BentoData} />;
      case "timeline": return <TimelineBlock  key={block.id} data={d as TimelineData} />;
      case "team":     return <TeamBlock      key={block.id} data={d as TeamData} />;
      case "cta":      return <CtaBlock       key={block.id} data={d as CtaData} />;
      default:         return null;
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-neutral-900 dark:text-white bg-[#07090f]">
      <CosmicBackground />

      {/* Back button */}
      <div className="fixed top-4 left-4 z-50">
        <Link href="/">
          <motion.button
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm font-medium text-gray-300 backdrop-blur-xl hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-300"
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

      {/* Dynamic blocks */}
      <AnimatePresence>
        {loading ? (
          <div className="flex min-h-screen items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : (
          <>{blocks.map(renderBlock)}</>
        )}
      </AnimatePresence>

      {/* ── Статичные блоки — всегда видны ── */}

      {/* Скачать приложения (DesktopDownload) */}
      <div className="px-6 md:px-10 lg:px-16">
        <DesktopDownload />
      </div>

      {/* Политика конфиденциальности / Пользовательское соглашение */}
      <LegalAccordion />

      {/* Footer */}
      <footer className="border-t border-indigo-500/10 px-6 py-8 flex items-center justify-between text-xs text-neutral-700">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 100 100" aria-hidden>
            <g transform="translate(50,52)" fill="#6366f1" opacity=".6">
              <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(0)"/>
              <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(120)"/>
              <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(240)"/>
            </g>
          </svg>
          <span>TRIOZ</span>
        </div>
        <span>© {new Date().getFullYear()} TRIOZ. Все права защищены.</span>
      </footer>
    </div>
  );
}
