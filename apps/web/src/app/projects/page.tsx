"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import EditableText from "@/components/EditableText";

const projects = [
  {
    title: "T.Р.И.О.Z — Основной проект",
    description: "Глобальная Российская MMORPG с элементами стратегии и полной внутренней социальной сферой. Именно с этого проекта зародилось наше сообщество.",
    status: "В разработке",
    tags: ["MMORPG", "Стратегия", "Онлайн", "Социальная сеть"],
    accent: "from-fantasy-red/20 to-fantasy-red/5",
    accentColor: "#ff4444",
    borderColor: "border-fantasy-red/20 hover:border-fantasy-red/40",
    dot: "bg-fantasy-red",
    statusColor: "bg-fantasy-red/10 text-fantasy-red border-fantasy-red/20",
  },
  {
    title: "Осколок Измерений",
    description: "Сборник проектов по созданию компьютерных и телефонных игр и дополнений к ним, напрямую связанных с вселенными T.Р.И.О.Z.",
    status: "Планирование",
    tags: ["PC", "Mobile", "Инди", "Вселенная T.Р.И.О.Z"],
    accent: "from-orange-500/20 to-orange-500/5",
    accentColor: "#f97316",
    borderColor: "border-orange-400/20 hover:border-orange-400/40",
    dot: "bg-orange-400",
    statusColor: "bg-orange-400/10 text-orange-400 border-orange-400/20",
  },
];

export default function ProjectsPage() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-20 max-md:py-6 px-4 max-md:px-3">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-fantasy-red/[0.04] dark:bg-fantasy-red/[0.06] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-orange-500/[0.03] dark:bg-orange-500/[0.05] rounded-full blur-[100px]" />
      </div>

      <div className="max-w-5xl mx-auto relative">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-fantasy-red/40" />
            <span className="text-xs font-medium tracking-widest uppercase text-fantasy-red/80">Вселенная</span>
            <span className="h-px w-8 bg-fantasy-red/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-5 text-neutral-900 dark:text-white">
            Проекты{" "}
            <em className="not-italic bg-gradient-to-r from-fantasy-red via-orange-400 to-fantasy-gold bg-clip-text text-transparent">
              Т.Р.И.О.Z
            </em>
          </h1>
          <EditableText
            contentKey="projects.subtitle"
            defaultValue="Игры, карты, онлайн — масштабные проекты во вселенной T.Р.И.О.Z"
            tag="p"
            className="text-neutral-500 dark:text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed"
          />
        </motion.div>

        {/* Cards */}
        <div className="space-y-6">
          {projects.map((project, i) => (
            <motion.div
              key={project.title}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
              className={`relative rounded-2xl border ${project.borderColor}
                bg-white dark:bg-white/[0.03] backdrop-blur-sm
                transition-all duration-500 overflow-hidden group
                hover:shadow-xl dark:hover:shadow-none`}
            >
              {/* Accent top line */}
              <div
                className="absolute top-0 left-0 right-0 h-[1.5px] opacity-60 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `linear-gradient(90deg, transparent, ${project.accentColor}, transparent)` }}
              />
              {/* Left accent bar */}
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px] opacity-40 group-hover:opacity-80 transition-opacity duration-500"
                style={{ backgroundColor: project.accentColor }}
              />

              <div className={`absolute inset-0 bg-gradient-to-r ${project.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} />

              <div className="relative p-7 md:p-9 pl-10 md:pl-12">
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${project.dot} flex-shrink-0`} />
                        <h2 className="text-xl md:text-2xl font-display font-bold text-neutral-900 dark:text-white group-hover:translate-x-0.5 transition-transform duration-300">
                          {project.title}
                        </h2>
                      </div>
                      <span className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full border ${project.statusColor}`}>
                        {project.status}
                      </span>
                    </div>
                    <EditableText
                      contentKey={`projects.${i}.desc`}
                      defaultValue={project.description}
                      tag="p"
                      className="text-neutral-500 dark:text-gray-400 leading-relaxed mb-5"
                      multiline
                    />
                    <div className="flex flex-wrap gap-2">
                      {project.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-3 py-1 rounded-full text-xs font-medium
                            bg-neutral-100 dark:bg-white/5 text-neutral-500 dark:text-gray-400
                            border border-neutral-200/80 dark:border-white/[0.07]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-14 text-center"
        >
          <div className="inline-block rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-8 backdrop-blur-sm">
            <EditableText contentKey="projects.cta.title" defaultValue="Хотите присоединиться?" tag="h3" className="text-xl font-display font-bold text-neutral-900 dark:text-white mb-3" />
            <EditableText contentKey="projects.cta.text" defaultValue="Следите за развитием проектов в TZ.Connect" tag="p" className="text-neutral-500 dark:text-gray-400 mb-5" />
            <Link href="/connect" className="btn-primary inline-block">
              Перейти в TZ.Connect
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
