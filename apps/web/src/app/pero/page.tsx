"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import EditableText from "@/components/EditableText";

const items = [
  {
    title: "Перо Измерений: Путь к Пустоте",
    type: "Книга",
    description: "Первая книга серии «Перо Измерений», погружающая читателя в глубины вселенной T.Р.И.О.Z. История о путешествии через измерения, где каждый мир хранит свои тайны и опасности.",
    status: "В процессе редактирования",
    icon: "📖",
    statusColor: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
    typeColor: "bg-fantasy-purple/10 text-fantasy-purple border-fantasy-purple/20",
    accentColor: "#8b5cf6",
  },
  {
    title: "Перо Измерений: Вельд\u2019Эран",
    type: "Настольная игра",
    description: "Стратегическая настольная игра во вселенной T.Р.И.О.Z. Развивает мышление, предлагает уникальную механику измерений. Для 2-6 игроков.",
    status: "В разработке",
    icon: "🎲",
    statusColor: "bg-violet-400/10 text-violet-400 border-violet-400/20",
    typeColor: "bg-fantasy-purple/10 text-fantasy-purple border-fantasy-purple/20",
    accentColor: "#8b5cf6",
  },
];

export default function PeroPage() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-20 max-md:py-6 px-4 max-md:px-3">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 right-0 w-[500px] h-[500px] bg-fantasy-purple/[0.05] dark:bg-fantasy-purple/[0.07] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 -left-32 w-[400px] h-[400px] bg-indigo-500/[0.03] dark:bg-indigo-500/[0.05] rounded-full blur-[100px]" />
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
            <span className="h-px w-8 bg-fantasy-purple/40" />
            <span className="text-xs font-medium tracking-widest uppercase text-fantasy-purple/80">Издательство</span>
            <span className="h-px w-8 bg-fantasy-purple/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-5 text-neutral-900 dark:text-white">
            Перо{" "}
            <em className="not-italic bg-gradient-to-r from-fantasy-purple via-indigo-400 to-purple-300 bg-clip-text text-transparent">
              Измерений
            </em>
          </h1>
          <EditableText
            contentKey="pero.subtitle"
            defaultValue="Настольные игры, книги и другие физические товары, направленные на развитие мышления"
            tag="p"
            className="text-neutral-500 dark:text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed"
          />
        </motion.div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {items.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
              className="relative rounded-2xl border border-fantasy-purple/15 hover:border-fantasy-purple/35
                bg-white dark:bg-white/[0.03] backdrop-blur-sm overflow-hidden group
                transition-all duration-500 hover:shadow-xl dark:hover:shadow-none"
            >
              {/* Accent top line */}
              <div
                className="absolute top-0 left-0 right-0 h-[1.5px] opacity-50 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `linear-gradient(90deg, transparent, ${item.accentColor}, transparent)` }}
              />

              <div className="absolute inset-0 bg-gradient-to-br from-fantasy-purple/0 to-fantasy-purple/0 group-hover:from-fantasy-purple/[0.04] group-hover:to-indigo-500/[0.02] transition-all duration-500 pointer-events-none" />

              <div className="relative p-7">
                <div className="text-4xl mb-5 inline-block group-hover:scale-110 transition-transform duration-500 origin-left">
                  {item.icon}
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full border ${item.typeColor}`}>
                    {item.type}
                  </span>
                  <span className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full border ${item.statusColor}`}>
                    {item.status}
                  </span>
                </div>
                <h3 className="text-lg font-display font-bold text-neutral-900 dark:text-white mb-3 group-hover:text-fantasy-purple dark:group-hover:text-fantasy-purple transition-colors duration-300">
                  {item.title}
                </h3>
                <EditableText
                  contentKey={`pero.${i}.desc`}
                  defaultValue={item.description}
                  tag="p"
                  className="text-neutral-500 dark:text-gray-400 leading-relaxed text-sm"
                  multiline
                />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Mission block */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-12 rounded-2xl border border-fantasy-purple/15 bg-white dark:bg-white/[0.03] p-8 text-center backdrop-blur-sm relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-fantasy-purple/[0.03] to-indigo-500/[0.02] pointer-events-none" />
          <div className="relative">
            <EditableText contentKey="pero.mission.title" defaultValue="Миссия" tag="h3" className="text-xl font-display font-bold text-neutral-900 dark:text-white mb-4" />
            <EditableText
              contentKey="pero.mission.text"
              defaultValue="Создание легкодоступных для людей развлекательных товаров, направленных на развитие мышления. Каждый продукт — это окно в мир T.Р.И.О.Z, где воображение встречается со стратегией."
              tag="p"
              className="text-neutral-500 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed"
              multiline
            />
            <div className="mt-6">
              <Link href="/library" className="btn-secondary inline-block">
                Узнать больше о лоре
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
