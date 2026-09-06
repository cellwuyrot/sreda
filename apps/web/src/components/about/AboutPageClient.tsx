
"use client";

/**
 * Клиентская разметка страницы /about.
 *
 * Важно: здесь НЕТ ни fetch, ни состояния загрузки. Все данные приходят
 * пропами из серверного компонента src/app/about/page.tsx.
 *
 * Почему так. Раньше вся страница была клиентской и грузила блоки запросом
 * в useEffect. Значит, любая причина, по которой клиентский JS не выполнился
 * (CSP с одноразовым nonce на закешированной странице, ошибка в бандле,
 * медленная сеть, блокировщик), давала ровно тот симптом, что наблюдался:
 * страница открывается, скроллится, но текста нет — в HTML его и не было.
 * Теперь разметка со всем текстом приезжает с сервера готовой.
 */

import { useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import CosmicBackground from "@/components/about/CosmicBackground";
import DesktopDownload from "@/components/DesktopDownload";
import LegalFooter, { LegalContactLinks } from "@/components/about/LegalFooter";

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
  AppsData,
  AppItem,
  AppPlatform,
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
    <section className="relative min-h-[640px] flex flex-col items-center justify-center px-6 py-20 overflow-hidden"
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
    <section className="grid border-y border-indigo-500/10 bg-white/[0.018]"
      style={{ gridTemplateColumns: `repeat(${data.items.length},1fr)` }}
    >
      {data.items.map((item, i) => (
        <motion.div
          key={i}
          {...fadeUp(i * 0.05)}
          className="flex flex-col items-center py-7 px-4 border-r border-indigo-500/[0.08] last:border-0 text-center"
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

function GalleryBlock({ data }: { data: GalleryData }) {
  const items = data.items ?? [];
  if (!items.length) return null;
  const big = items[0];
  const rest = items.slice(1, 5);
  return (
    <section className="px-6 md:px-10 lg:px-16 py-16"
      style={{ background: "radial-gradient(ellipse at 90% 50%,rgba(6,182,212,.06) 0%,transparent 55%)" }}
    >
      <motion.div {...fadeUp()}>
        {data.title && <SectionLabel>Медиа-галерея</SectionLabel>}
        {data.title && <SectionTitle>{data.title}</SectionTitle>}
        {data.subtitle && <p className="mb-10 text-sm text-neutral-500">{data.subtitle}</p>}
      </motion.div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "1.6fr 1fr 1fr", gridTemplateRows: "200px 200px" }}>
        {big && (
          <motion.div {...fadeUp(0.05)} className="row-span-2 overflow-hidden rounded-2xl border border-white/[0.06] bg-neutral-900 relative group">
            <MediaItem item={big} fill />
          </motion.div>
        )}
        {rest.map((item, i) => (
          <motion.div key={item.id} {...fadeUp(0.1 + i * 0.05)} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-neutral-900 relative group">
            <MediaItem item={item} />
          </motion.div>
        ))}
      </div>
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
              className="group relative flex h-full min-h-[160px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
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
        <div className="pointer-events-none absolute left-[7px] top-4 bottom-4 w-px"
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
              <div className="mb-1 text-[15px] font-bold text-white" style={item.current ? { color: item.color ?? "#6366f1" } : undefined}>
                {item.title}
              </div>
              {item.description && <div className="text-sm leading-relaxed text-neutral-600">{item.description}</div>}
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
            className="flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.022] p-6 text-center"
          >
            {m.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.avatarUrl} alt={m.name} className="mb-4 h-16 w-16 rounded-full object-cover border-2" style={{ borderColor: `${m.color ?? "#6366f1"}55` }} />
            ) : (
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl border-2"
                style={{ background: `${m.color ?? "#6366f1"}14`, borderColor: `${m.color ?? "#6366f1"}40` }}
              >
                {m.emoji ?? "\u{1F464}"}
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
    <section className="mx-6 md:mx-10 lg:mx-16 mb-20 overflow-hidden rounded-3xl border border-indigo-500/22 p-14 text-center relative"
      style={{ background: "linear-gradient(135deg,rgba(99,102,241,.14),rgba(139,92,246,.09))" }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center,rgba(99,102,241,.1),transparent 70%)" }} />
      <motion.div {...fadeUp()}>
        <h2 className="relative mb-4 text-5xl font-black text-white">{data.title}</h2>
        {data.subtitle && <p className="relative mb-9 text-lg text-neutral-500">{data.subtitle}</p>}
        <div className="relative flex flex-wrap gap-4 justify-center">
          {data.primaryCta && (
            <Link href={data.primaryCta.href}
              className="flex items-center gap-2 rounded-xl px-8 py-3.5 text-[15px] font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 0 30px rgba(99,102,241,.4)" }}
            >
              {data.primaryCta.label}
            </Link>
          )}
          {data.secondaryCta && (
            <Link href={data.secondaryCta.href}
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


// ---------- Apps block ----------

const PLATFORM_CFG: Record<AppPlatform, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  android: {
    label: 'Android',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.08)',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M17.523 15.341A7.37 7.37 0 0 0 19.4 10.5a7.37 7.37 0 0 0-1.877-4.841L18.86 4.32a.5.5 0 0 0-.707-.707l-1.41 1.41A7.4 7.4 0 0 0 12 3.5a7.4 7.4 0 0 0-4.743 1.523L5.847 3.613a.5.5 0 0 0-.707.707l1.337 1.337A7.37 7.37 0 0 0 4.6 10.5a7.37 7.37 0 0 0 1.877 4.841L5.14 16.679a.5.5 0 0 0 .707.707l1.41-1.41A7.4 7.4 0 0 0 12 17.5a7.4 7.4 0 0 0 4.743-1.524l1.41 1.41a.5.5 0 0 0 .707-.707zM9 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
      </svg>
    ),
  },
  windows: {
    label: 'Windows',
    color: '#00f0ff',
    bg: 'rgba(0,240,255,0.08)',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M3 5.566L10.5 4.5v7H3V5.566zM11.5 4.357L21 3v8.5h-9.5V4.357zM3 12.5h7.5V19.5L3 18.434V12.5zM11.5 12.5H21V21l-9.5-1.357V12.5z"/>
      </svg>
    ),
  },
  macos: {
    label: 'macOS',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  linux: {
    label: 'Linux',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
        <path d="M12.504 0C12.22 0 12 .22 12 .504 12 4.63 9.965 6.57 8.49 7.986c-.79.754-1.476 1.408-1.74 2.177-.263.77-.163 1.71.417 2.994l-.002.003c.23.518.348 1.095.348 1.676 0 .756-.194 1.476-.583 2.073l-.002.003a4.76 4.76 0 0 1-.393.527c-.508.587-.933 1.078-.933 1.86 0 .457.175.892.468 1.21.293.317.702.51 1.145.51.302 0 .59-.087.836-.239a3.3 3.3 0 0 0 .698-.609l.001-.001.003-.004c.256-.305.46-.662.585-1.048.127-.386.17-.793.12-1.186a3.3 3.3 0 0 0-.214-.806 5.15 5.15 0 0 1-.22-.678 5.14 5.14 0 0 1-.07-.692c0-.487.13-.95.378-1.35.25-.4.607-.726 1.032-.934.426-.207.9-.307 1.383-.285.483.022.944.165 1.343.41.4.246.735.59.97 1.003.235.414.36.882.36 1.356 0 .243-.03.483-.088.716a5.15 5.15 0 0 1-.243.679 3.3 3.3 0 0 0-.238.808c-.06.394-.023.8.1 1.185.122.386.32.742.568 1.05l.004.004.002.002c.192.24.42.46.687.622.266.162.565.254.87.254.443 0 .852-.193 1.145-.51.293-.318.468-.753.468-1.21 0-.782-.425-1.273-.933-1.86a4.76 4.76 0 0 1-.393-.527l-.002-.003c-.389-.597-.583-1.317-.583-2.073 0-.581.119-1.158.348-1.676l-.002-.003c.58-1.283.68-2.225.417-2.994-.264-.77-.95-1.423-1.74-2.177C14.035 6.57 12 4.631 12 .504 12 .22 11.78 0 11.496 0z"/>
      </svg>
    ),
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AppCard({ app, index }: { app: AppItem; index: number }) {
  const cfg = PLATFORM_CFG[app.platform] ?? PLATFORM_CFG.android;
  return (
    <motion.div
      key={app.id}
      {...fadeUp(index * 0.08)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-white/[0.025] transition-all duration-300 hover:-translate-y-1"
      style={{
        borderColor: `${cfg.color}28`,
        boxShadow: `0 0 0 0 ${cfg.color}`,
      }}
      whileHover={{ boxShadow: `0 0 40px -8px ${cfg.color}55` }}
    >
      {/* Top accent line */}
      <span
        className="absolute inset-x-0 top-0 h-0.5 opacity-60"
        style={{ background: `linear-gradient(90deg,transparent,${cfg.color},transparent)` }}
      />
      {/* Glow background */}
      <span
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at 50% 0%,${cfg.bg} 0%,transparent 70%)` }}
      />
      <div className="relative p-6 flex flex-col flex-1">
        {/* Platform badge + icon */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl border"
            style={{ color: cfg.color, borderColor: `${cfg.color}40`, background: cfg.bg, boxShadow: `0 0 20px -4px ${cfg.color}60` }}
          >
            {cfg.icon}
          </div>
          <div>
            <span
              className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
              style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}35` }}
            >
              {cfg.label}
            </span>
          </div>
        </div>

        {/* Name + version */}
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-xl font-black text-white">{app.name}</h3>
          {app.version && (
            <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-mono text-white/50">v{app.version}</span>
          )}
        </div>

        {/* Description */}
        {app.description && (
          <p className="mb-4 text-sm leading-relaxed text-neutral-500 flex-1">{app.description}</p>
        )}

        {/* Download or coming soon */}
        <div className="mt-auto pt-4 flex items-center gap-3">
          {app.fileUrl ? (
            <a
              href={app.fileUrl}
              download={app.fileName ?? true}
              className="group/btn flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
              style={{ background: `linear-gradient(135deg,${cfg.color}cc,${cfg.color}88)`, boxShadow: `0 0 20px -4px ${cfg.color}80` }}
            >
              <svg className="h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Скачать
            </a>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-xl border px-5 py-2.5 text-sm font-medium"
              style={{ borderColor: `${cfg.color}25`, color: `${cfg.color}80` }}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Скоро
            </span>
          )}
          {app.fileUrl && app.fileSize && (
            <span className="text-xs text-neutral-600">{formatBytes(app.fileSize)}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AppsBlock({ data }: { data: AppsData }) {
  const items = (data.items ?? []).filter((a) => a.active);
  if (!items.length) return null;
  return (
    <section
      className="px-6 md:px-10 lg:px-16 py-16"
      style={{ background: 'radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.07) 0%,transparent 60%)' }}
    >
      <motion.div {...fadeUp()}>
        {data.title && (
          <>
            <SectionLabel>Приложения</SectionLabel>
            <SectionTitle>{data.title}</SectionTitle>
          </>
        )}
        {data.subtitle && (
          <p className="mb-10 max-w-xl text-sm leading-relaxed text-neutral-500">{data.subtitle}</p>
        )}
      </motion.div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((app, i) => (
          <AppCard key={app.id} app={app} index={i} />
        ))}
      </div>
    </section>
  );
}

// ---------- Page ----------

export type AboutPageClientProps = {
  /** Обычные блоки «О проекте» в порядке из админки (без правового). */
  bodyBlocks: AboutBlockRow[];
  /** Ключи из блока «Правовая информация», если он заведён. */
  legalOverrides: Record<string, string> | null;
  /** Ключи из «Контент сайта → Правовая информация», уже с сервера. */
  siteOverrides: Record<string, string> | null;
};

export default function AboutPageClient({
  bodyBlocks,
  legalOverrides,
  siteOverrides,
}: AboutPageClientProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const videoBlock = bodyBlocks.find((b) => b.type === "video");

  const renderBlock = (block: AboutBlockRow) => {
    const d = block.data as unknown;
    switch (block.type) {
      case "hero": {
        const hero = d as HeroData;
        const heroPatched: HeroData = {
          ...hero,
          secondaryCta:
            hero.secondaryCta?.action === "video"
              ? { ...hero.secondaryCta, href: videoBlock ? "#video" : "/about" }
              : hero.secondaryCta,
        };
        return <HeroBlock key={block.id} data={heroPatched} />;
      }
      case "video":
        return (
          <div key={block.id} id="video" ref={videoRef}>
            <VideoBlock data={d as VideoData} />
          </div>
        );
      case "stats":
        return <StatsBlock key={block.id} data={d as StatsData} />;
      case "gallery":
        return <GalleryBlock key={block.id} data={d as GalleryData} />;
      case "bento":
        return <BentoBlock key={block.id} data={d as BentoData} />;
      case "timeline":
        return <TimelineBlock key={block.id} data={d as TimelineData} />;
      case "team":
        return <TeamBlock key={block.id} data={d as TeamData} />;
      case "cta":
        return <CtaBlock key={block.id} data={d as CtaData} />;
      case 'apps':
        return <AppsBlock key={block.id} data={d as AppsData} />;
      case 'legal':
        // Намеренно ничего: документ рисуется только в подвале ниже,
        // чтобы он не появлялся на странице дважды.
        return null;
      default:
        return null;
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-neutral-900 dark:text-white bg-[#07090f]">
      <CosmicBackground />

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

      <>
          {bodyBlocks.map(renderBlock)}

          {/* ── Download section ───────────────────────────────────────── */}
          <div className="px-6 md:px-10 lg:px-16">
            <DesktopDownload />
          </div>

          <LegalFooter blockOverrides={legalOverrides} siteOverrides={siteOverrides} />

          <footer className="border-t border-indigo-500/10 px-6 py-8 text-xs text-neutral-700">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 100 100" aria-hidden>
                  <g transform="translate(50,52)" fill="#6366f1" opacity=".6">
                    <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(0)"/>
                    <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(120)"/>
                    <path d="M5,6 L5,-30 L22,-30 L26,-34 L26,-43 L22,-47 L-22,-47 L-26,-43 L-26,-34 L-22,-30 L-5,-30 L-5,6Z" transform="rotate(240)"/>
                  </g>
                </svg>
                <span className="font-semibold text-neutral-500">TRIOZ</span>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <LegalContactLinks blockOverrides={legalOverrides} siteOverrides={siteOverrides} />
              </div>
              <span>&#169; {new Date().getFullYear()} TRIOZ. Все права защищены.</span>
            </div>
          </footer>
      </>
    </div>
  );
}
