"use client";

/**
 * Экосистемные секции страницы /about — разметка из прежней версии проекта,
 * которая гарантированно отображалась: заглавие, подзаголовок, четыре карточки
 * направлений и подпись внизу.
 *
 * Отличие от прежнего кода одно: текст больше не запрашивается из браузера —
 * он приходит пропом с сервера и уже есть в HTML.
 */

import { useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import ProjectGlyph from "@/components/about/ProjectGlyph";
import type { AboutContent, AboutSection } from "@/lib/about";

function ProjectCard({ section, index }: { section: AboutSection; index: number }) {
  const cardRef = useRef<HTMLAnchorElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay: index * 0.1, ease: [0.25, 0.1, 0.25, 1] }}
      className="h-full"
    >
      <Link
        ref={cardRef}
        href={section.href}
        onMouseMove={handleMouseMove}
        className="group relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-3xl border border-neutral-200/70 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] backdrop-blur-xl p-7 lg:p-8 transition-all duration-500 hover:-translate-y-1 hover:border-neutral-300 dark:hover:border-white/20"
        style={{ ["--glow" as string]: `${section.color}55` }}
      >
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-40 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: `linear-gradient(90deg, transparent, ${section.color}, transparent)` }}
        />
        <div className="mb-5">
          <ProjectGlyph name={section.key} className="h-8 w-8 tz-float-y" />
        </div>
        <h2 className="mb-3 text-2xl font-display font-semibold text-neutral-900 dark:text-white">
          {section.title}
        </h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-600 dark:text-gray-400">
          {section.description}
        </p>
        <span className="mt-auto pt-6 text-xs font-medium uppercase tracking-widest" style={{ color: section.color }}>
          Перейти
        </span>
      </Link>
    </motion.div>
  );
}

export default function LegacyAboutSections({ content }: { content: AboutContent }) {
  return (
    <section id="about-ecosystem" className="px-6 pt-24 md:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <div className="mb-6 inline-flex items-center gap-3">
            <span className="h-px w-10 bg-violet-400/50 dark:bg-cyan-400/40" />
            <span className="text-xs font-medium uppercase tracking-[0.3em] text-violet-500 dark:text-cyan-400/90">
              {content.eyebrow}
            </span>
            <span className="h-px w-10 bg-violet-400/50 dark:bg-cyan-400/40" />
          </div>

          <h1 className="mb-6 text-6xl md:text-8xl font-display font-bold leading-[1.05]">
            <span className="glow-text bg-gradient-to-r from-violet-600 via-fuchsia-500 to-indigo-600 dark:from-cyan-300 dark:via-white dark:to-fantasy-purple bg-clip-text text-transparent">
              {content.title}
            </span>
          </h1>

          <p className="mx-auto max-w-2xl whitespace-pre-line text-lg leading-relaxed text-neutral-600 dark:text-gray-300/90">
            {content.subtitle}
          </p>
        </div>

        <div className="mt-16 lg:mt-20 grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6">
          {content.sections.map((section, i) => (
            <ProjectCard key={section.key} section={section} index={i} />
          ))}
        </div>

        <p className="mt-16 text-center text-sm text-neutral-400 dark:text-gray-600">{content.footer}</p>
      </div>
    </section>
  );
}
