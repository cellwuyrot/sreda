"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import EditableText from "@/components/EditableText";
import DesktopDownload from "@/components/DesktopDownload";
import CosmicBackground from "@/components/about/CosmicBackground";
import ProjectGlyph from "@/components/about/ProjectGlyph";
import { ABOUT_SECTIONS, ABOUT_DEFAULTS, aboutKeys, type AboutSection } from "@/lib/about";

/* ─────────────────────────── Project card ─────────────────────────── */

function ProjectCard({ section, index }: { section: AboutSection; index: number }) {
  const cardRef = useRef<HTMLAnchorElement>(null);

  // Move a soft "spotlight" toward the cursor for a premium, tactile feel.
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
        className="group relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-3xl
          border border-neutral-200/70 dark:border-white/10
          bg-white/70 dark:bg-white/[0.03] backdrop-blur-xl
          p-7 lg:p-8 transition-all duration-500
          hover:-translate-y-1 hover:border-neutral-300 dark:hover:border-white/20
          hover:shadow-[0_20px_60px_-20px_var(--glow)]"
        style={{ ["--glow" as string]: `${section.color}55` }}
      >
        {/* Cursor spotlight */}
        <span
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(420px circle at var(--mx,50%) var(--my,50%), ${section.color}1f, transparent 60%)`,
          }}
        />
        {/* Top accent line */}
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-40 group-hover:opacity-100 transition-opacity duration-500"
          style={{ background: `linear-gradient(90deg, transparent, ${section.color}, transparent)` }}
        />
        {/* Corner constellation flourish */}
        <svg
          className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 opacity-[0.12] transition-transform duration-700 group-hover:rotate-45"
          viewBox="0 0 100 100"
          fill="none"
          stroke={section.color}
          strokeWidth={1}
          aria-hidden
        >
          <circle cx="50" cy="50" r="30" />
          <circle cx="50" cy="50" r="46" strokeDasharray="2 8" />
          <circle cx="50" cy="20" r="2.5" fill={section.color} stroke="none" />
          <circle cx="80" cy="50" r="1.8" fill={section.color} stroke="none" />
        </svg>

        {/* Icon badge */}
        <div
          className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl
            border transition-all duration-500 group-hover:scale-110"
          style={{
            color: section.color,
            borderColor: `${section.color}40`,
            backgroundColor: `${section.color}14`,
            boxShadow: `0 0 24px -6px ${section.color}66`,
          }}
        >
          <ProjectGlyph name={section.key} className="h-8 w-8 tz-float-y" />
        </div>

        <EditableText
          contentKey={aboutKeys.sectionTitle(section.key)}
          defaultValue={section.title}
          tag="h2"
          className="text-xl lg:text-2xl font-display font-bold text-neutral-900 dark:text-white"
        />

        <EditableText
          contentKey={aboutKeys.sectionDesc(section.key)}
          defaultValue={section.description}
          tag="p"
          className="mt-3 flex-1 text-sm lg:text-[15px] leading-relaxed text-neutral-500 dark:text-gray-400"
          multiline
        />

        <div
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold transition-all duration-300
            group-hover:gap-3"
          style={{ color: section.color }}
        >
          Перейти в раздел
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </div>
      </Link>
    </motion.div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden text-neutral-900 dark:text-white">
      <CosmicBackground />

      {/* Back button */}
      <div className="fixed top-4 left-4 z-50">
        <Link href="/">
          <motion.button
            className="flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-white/10
              bg-white/80 dark:bg-black/40 px-4 py-2 text-sm font-medium text-neutral-600 dark:text-gray-300
              backdrop-blur-xl transition-all duration-300
              hover:border-violet-300 dark:hover:border-cyan-400/40 hover:text-violet-600 dark:hover:text-cyan-400"
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

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-24 lg:py-28">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6 inline-flex items-center gap-3"
          >
            <span className="h-px w-10 bg-violet-400/50 dark:bg-cyan-400/40" />
            <EditableText
              contentKey={aboutKeys.eyebrow}
              defaultValue={ABOUT_DEFAULTS.eyebrow}
              tag="span"
              className="text-xs font-medium uppercase tracking-[0.3em] text-violet-500 dark:text-cyan-400/90"
            />
            <span className="h-px w-10 bg-violet-400/50 dark:bg-cyan-400/40" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mb-6 text-6xl md:text-8xl font-display font-bold leading-[1.05]"
          >
            <EditableText
              contentKey={aboutKeys.title}
              defaultValue={ABOUT_DEFAULTS.title}
              tag="span"
              className="glow-text bg-gradient-to-r from-violet-600 via-fuchsia-500 to-indigo-600
                dark:from-cyan-300 dark:via-white dark:to-fantasy-purple bg-clip-text text-transparent"
            />
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <EditableText
              contentKey={aboutKeys.subtitle}
              defaultValue={ABOUT_DEFAULTS.subtitle}
              tag="p"
              className="mx-auto max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-gray-300/90"
              multiline
            />
          </motion.div>
        </motion.div>

        {/* Ecosystem bento grid — spans the full width on desktop */}
        <div className="mt-16 lg:mt-20 grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
          {ABOUT_SECTIONS.map((section, i) => (
            <ProjectCard key={section.key} section={section} index={i} />
          ))}
        </div>

        {/* Desktop download */}
        <DesktopDownload />

        {/* Legal section */}
        <LegalSection />

        {/* Footer info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="mt-16 text-center text-sm text-neutral-400 dark:text-gray-600"
        >
          <EditableText contentKey={aboutKeys.footer} defaultValue={ABOUT_DEFAULTS.footer} tag="p" />
        </motion.div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Legal (unchanged behaviour) ─────────────────────────── */

const legalSections = [
  {
    title: "1. Термины и определения",
    content: `Платформа (Сайт) — совокупность программно-аппаратных средств, интегрированных с веб-сайтом, размещенным в сети Интернет в домене connect.trioz.ru, включая все его поддомены, страницы, элементы интерфейса, графику и программный код.

Администрация Платформы — правообладатель Платформы TRIOZ, осуществляющий управление Сайтом, обеспечение его функционирования и техническую поддержку.

Пользователь (Клиент) — любое дееспособное физическое лицо, индивидуальный предприниматель или уполномоченный представитель юридического лица, осуществивший доступ к Платформе и/или использующий ее функциональные возможности для направления обращений, получения информационных или консультационных услуг.

Обработка сообщений (Сервис) — функционал Платформы, позволяющий Пользователю отправлять текстовые сообщения, запросы, технические задания, файлы и иные материалы Администрации, а Администрации — принимать, регистрировать, анализировать и отвечать на указанные запросы в рамках обслуживания Клиентов.`,
  },
  {
    title: "2. Предмет соглашения",
    content: `2.1. Предметом настоящего Соглашения является предоставление Пользователю доступа к функциональным возможностям Платформы connect.trioz.ru для получения информационных, консультационных, сервисных или технологических услуг, а также для направления официальных обращений и обработки сообщений Пользователя.

2.2. Использование любых функций Платформы означает безоговорочное согласие Пользователя со всеми пунктами настоящего Соглашения, а также с Политикой конфиденциальности, являющейся неотъемлемой частью данного документа. В случае несогласия с какими-либо условиями Пользователь обязан незамедлительно прекратить использование Сайта.`,
  },
  {
    title: "3. Порядок использования Платформы",
    content: `3.1. Платформа connect.trioz.ru предоставляет интерфейс для взаимодействия Клиентов с проектом TRIOZ. В рамках этого взаимодействия Пользователь имеет право направлять сообщения через электронные формы обратной связи, онлайн-чаты или специализированные тикет-системы, развернутые на Сайте.

3.2. При отправке сообщений Пользователь обязуется предоставлять достоверную, актуальную и полную информацию (включая имя, контактный адрес электронной почты и иные реквизиты, необходимые для обратной связи).

3.3. Администрация осуществляет модерацию, учет и обработку входящих сообщений. Время рассмотрения обращений и предоставления ответа регламентируется внутренними стандартами обслуживания проекта TRIOZ, но не может превышать 30 (тридцати) календарных дней с момента получения, если иное не согласовано Сторонами в отдельных договорах.

3.4. Направляя сообщение или файлы через Платформу, Пользователь гарантирует, что обладает всеми необходимыми правами на передаваемую информацию и её содержание не нарушает законодательство РФ, права третьих лиц и общепринятые этические нормы.`,
  },
  {
    title: "4. Политика ведения деятельности",
    content: `4.1. Проект TRIOZ строит свою деятельность на принципах законности, прозрачности, конфиденциальности и профессиональной этики. Администрация обязуется прилагать максимальные усилия для обеспечения бесперебойного функционирования Платформы, оперативного устранения технических сбоев и качественного обслуживания Клиентов.

4.2. При использовании Платформы Пользователю строго запрещается:
• Использовать Сервис для отправки спама, массовых рассылок, вредоносного программного обеспечения, фишинговых ссылок или иных материалов, способных нарушить стабильность работы компьютерного оборудования или сетей.
• Размещать или передавать информацию, носящую оскорбительный, дискриминационный, заведомо ложный, клеветнический характер, а также материалы, нарушающие авторские, смежные или патентные права третьих лиц.
• Осуществлять попытки несанкционированного доступа к административной панели Сайта, учетным записям других пользователей или серверам, на которых развернута инфраструктура TRIOZ.
• Использовать автоматизированные скрипты (парсеры, боты, краулеры) для сбора информации с Платформы без предварительного письменного разрешения Администрации.

4.3. В случае выявления нарушений правил допустимого использования, Администрация оставляет за собой право в одностороннем порядке заблокировать доступ Пользователя к Сервису, проигнорировать направленные сообщения или передать соответствующие данные в правоохранительные органы.`,
  },
  {
    title: "5. Интеллектуальная собственность",
    content: `5.1. Все объекты, размещенные на Платформе connect.trioz.ru, включая элементы дизайна, текст, графические изображения, иллюстрации, скрипты, программы для ЭВМ, базы данных, товарные знаки и логотипы, являются объектами исключительных прав Администрации Платформы или её партнеров.

5.2. Никакие элементы контента Платформы не могут быть скопированы, воспроизведены, переработаны, распространены или использованы иным образом для коммерческих или некоммерческих целей без предварительного согласия правообладателя.`,
  },
  {
    title: "6. Ограничение ответственности",
    content: `6.1. Платформа и её сервисы предоставляются на условиях «как есть» (as is). Администрация не гарантирует, что Платформа будет соответствовать всем субъективным ожиданиям Пользователя, функционировать непрерывно, быстро и абсолютно без ошибок.

6.2. Администрация не несет ответственности за убытки (включая упущенную выгоду, прерывание деловой активности или потерю данных), возникшие у Пользователя в связи с использованием или невозможностью использования Платформы, а также в результате задержек в обработке сообщений, вызванных сбоями в сетях электросвязи или действиями третьих лиц.`,
  },
  {
    title: "7. Политика обработки персональных данных",
    content: `7.1. Сбор, хранение и обработка персональных данных Пользователей, направляемых через Сайт connect.trioz.ru, осуществляются в строгом соответствии с Федеральным законом РФ № 152-ФЗ «О персональных данных».

7.2. Категории обрабатываемых данных:
• Имя, Фамилия, Отчество, адрес электронной почты, номер телефона — для идентификации Пользователя, обработки входящих сообщений, консультирования и предоставления ответов. Хранятся до достижения целей обработки или до момента отзыва согласия.
• Технические данные (IP-адрес, файлы cookie, данные о браузере, время доступа) — для аналитики работы Сайта, оптимизации интерфейса, обеспечения информационной безопасности. Автоматическое удаление в соответствии с настройками веб-сервера (до 12 месяцев).

7.3. Администрация принимает необходимые организационные и технические меры для защиты персональной информации Пользователя от неправомерного или случайного доступа, уничтожения, изменения, блокирования, копирования, распространения.`,
  },
  {
    title: "8. Разрешение споров и заключительные положения",
    content: `8.1. Все споры и разногласия, возникающие из настоящего Соглашения или в связи с ним, подлежат разрешению путем переговоров с соблюдением обязательного досудебного претензионного порядка. Срок рассмотрения претензии составляет 15 (пятнадцать) рабочих дней с момента её получения Стороной.

8.2. В случае невозможности достижения согласия, спор передается на рассмотрение в суд по месту нахождения Администрации Платформы в соответствии с действующим законодательством Российской Федерации.

8.3. Администрация вправе в любой момент в одностороннем порядке изменять условия настоящего Соглашения. Новая редакция вступает в силу с момента ее публикации на странице https://connect.trioz.ru, если иное не предусмотрено новой редакцией Соглашения.

Контакты Администрации проекта TRIOZ:
URL-адрес: https://connect.trioz.ru
Назначение: Платформа обслуживания клиентов и обработки сообщений
Электронный адрес для юридических запросов и отзывов персональных данных: legal@trioz.ru`,
  },
];

function LegalSection() {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1 }}
      className="mt-20"
    >
      {/* Divider */}
      <div className="mb-8 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-neutral-300 dark:via-white/10 to-transparent" />
        <span className="text-xs font-medium uppercase tracking-widest text-neutral-400 dark:text-gray-600">Юридическая информация</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-neutral-300 dark:via-white/10 to-transparent" />
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="group relative w-full overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-white/[0.07] bg-white/70 dark:bg-white/[0.03] backdrop-blur-xl transition-all duration-300 hover:border-neutral-300 dark:hover:border-white/[0.13] hover:shadow-lg dark:hover:shadow-none"
      >
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-neutral-400 dark:bg-gray-500 opacity-30 transition-opacity group-hover:opacity-60" />
        <div className="flex items-center justify-between p-5 pl-7">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-neutral-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="text-left">
              <div className="text-sm font-semibold text-neutral-800 dark:text-white">Пользовательское соглашение</div>
              <div className="mt-0.5 text-xs text-neutral-400 dark:text-gray-500">Политика ведения деятельности платформы TRIOZ — редакция от 31 мая 2026 г.</div>
            </div>
          </div>
          <motion.svg
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="h-5 w-5 flex-shrink-0 text-neutral-400 dark:text-gray-500"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl border border-neutral-200/80 dark:border-white/[0.07] bg-white/70 dark:bg-white/[0.02] backdrop-blur-xl p-6 md:p-8">
              {/* Preamble */}
              <p className="mb-6 text-sm leading-relaxed text-neutral-600 dark:text-gray-400">
                Настоящий документ представляет собой официальное публичное предложение (публичную оферту) проекта TRIOZ, доступного в сети Интернет по адресу{" "}
                <a href="https://connect.trioz.ru" className="text-accent hover:underline">connect.trioz.ru</a>,
                адресованное любому физическому лицу, индивидуальному предпринимателю или юридическому лицу (далее — «Пользователь»).
                В соответствии с пунктом 2 статьи 437 ГК РФ, принятие условий и использование Платформы является акцептом данной оферты.
              </p>

              {/* Accordion sections */}
              <div className="space-y-2">
                {legalSections.map((s, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-neutral-100 dark:border-white/[0.05]">
                    <button
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/[0.02]"
                    >
                      <span className="text-sm font-medium text-neutral-700 dark:text-gray-300">{s.title}</span>
                      <motion.svg
                        animate={{ rotate: expandedIdx === i ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="h-4 w-4 flex-shrink-0 text-neutral-400 dark:text-gray-600"
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
                          <div className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-neutral-500 dark:text-gray-400">
                            {s.content}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {/* Contact footer */}
              <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-neutral-100 dark:border-white/[0.05] pt-5 sm:flex-row sm:items-center">
                <div className="text-xs text-neutral-400 dark:text-gray-600">
                  Для юридических запросов:{" "}
                  <a href="mailto:legal@trioz.ru" className="text-accent hover:underline">legal@trioz.ru</a>
                </div>
                <div className="text-xs text-neutral-400 dark:text-gray-600">
                  connect.trioz.ru — Юридическая документация
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
