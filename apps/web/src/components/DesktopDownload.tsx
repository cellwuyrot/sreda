"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import EditableText from "@/components/EditableText";

type Os = "windows" | "mac" | "linux" | "android";

interface DownloadMeta {
  available: boolean;
  version?: string;
  platforms?: Record<Os, boolean>;
}

const OS_LABEL: Record<Os, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  android: "Android",
};

const DESKTOP_COLOR = "#00f0ff"; // TZ.Connect brand cyan

// Best-effort OS sniffing for the primary button. The server does its own
// detection too, so an occasional miss here is harmless.
function detectClientOs(): Os {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  // ANDROID-APK: android раньше остальных — его UA содержит и "linux"
  if (ua.includes("android")) return "android";
  if (ua.includes("windows") || platform.includes("win")) return "windows";
  if (ua.includes("mac") || platform.includes("mac")) return "mac";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "windows";
}

function OsIcon({ os, className }: { os: Os; className?: string }) {
  if (os === "windows") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M3 5.1 10.4 4v7.5H3V5.1Zm0 13.8L10.4 20v-7.4H3v6.3Zm8.3 1.3L21 21.5V12.6h-9.7v7.6Zm0-16.7v7.6H21V2.5l-9.7 1Z" />
      </svg>
    );
  }
  if (os === "mac") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M16.4 12.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8-.7 0-1.6-.7-2.6-.7-1.4 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-1 2.3-2c.7-1.1 1-2.2 1-2.3-.1 0-2-.8-2-3.2ZM14.5 5.9c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9 0 1.8-.4 2.3-1.1Z" />
      </svg>
    );
  }
  if (os === "android") {
    // ANDROID-APK: контур андроид-робота (голова с антеннами + корпус)
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M7.2 7.8a5.6 5.6 0 0 1 9.6 0l1.2-2.1a.5.5 0 0 0-.86-.5l-1.24 2.14A5.9 5.9 0 0 0 12 6.6c-1.4 0-2.72.27-3.9.74L6.86 5.2a.5.5 0 1 0-.86.5l1.2 2.1Zm-.7 1.5c-.28.66-.5 1.4-.5 2.2v6.3c0 .66.54 1.2 1.2 1.2h.6v2.25a1.2 1.2 0 1 0 2.4 0V19h3.6v2.25a1.2 1.2 0 1 0 2.4 0V19h.6c.66 0 1.2-.54 1.2-1.2v-6.3c0-.8-.22-1.54-.5-2.2H6.5Zm2.75 1.9a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Zm5.5 0a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Z" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2c-1.7 0-3 1.6-3 3.6 0 1 .1 1.9-.4 2.9-.5 1-1.6 1.8-2.2 3.3-.5 1.3-.2 2.5.1 3.6-.4.3-.7.7-.6 1.2.1.5.6.7 1.2.9.5.2 1 .4 1.6.9.5.5 1 1 1.9 1.1.4 0 .9 0 1.3-.2.4.2.9.2 1.3.2.9-.1 1.4-.6 1.9-1.1.6-.5 1.1-.7 1.6-.9.6-.2 1.1-.4 1.2-.9.1-.5-.2-.9-.6-1.2.3-1.1.6-2.3.1-3.6-.6-1.5-1.7-2.3-2.2-3.3-.5-1-.4-1.9-.4-2.9C15 3.6 13.7 2 12 2Z" />
    </svg>
  );
}

export default function DesktopDownload() {
  const [os, setOs] = useState<Os>("windows");
  const [meta, setMeta] = useState<DownloadMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const clientOs = detectClientOs();
    fetch("/api/download/desktop")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DownloadMeta | null) => {
        if (!active) return;
        setOs(clientOs);
        setMeta(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const available = Boolean(meta?.available);
  const otherOses = (Object.keys(OS_LABEL) as Os[]).filter((o) => o !== os);
  // A platform is "ready" only when the server reports an installer for it. When
  // the metadata omits `platforms` (older API) we optimistically treat it as
  // ready so we never over-hide a working build.
  const platformReady = (o: Os) => meta?.platforms?.[o] !== false;
  // Whether the visitor's own OS has a build. The primary button keys off this
  // so a Windows visitor on a Linux-only server isn't handed an active button
  // that resolves to a 404 (see the download route's `not_available`).
  const primaryReady = platformReady(os);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="mt-20"
    >
      {/* Divider */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-300 dark:via-white/10 to-transparent" />
        <span className="text-xs font-medium tracking-widest uppercase text-neutral-400 dark:text-gray-600">
          Приложения
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-300 dark:via-white/10 to-transparent" />
      </div>

      <div
        className="relative rounded-2xl overflow-hidden border border-neutral-200/80 dark:border-white/[0.07] bg-white dark:bg-white/[0.025]"
      >
        {/* Top accent line */}
        <div
          className="absolute top-0 left-0 right-0 h-[1.5px]"
          style={{ background: `linear-gradient(90deg, transparent, ${DESKTOP_COLOR}80, transparent)` }}
        />
        {/* Left bar */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] opacity-60" style={{ backgroundColor: DESKTOP_COLOR }} />
        {/* Radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 0% 50%, ${DESKTOP_COLOR}08 0%, transparent 60%)` }}
        />

        <div className="relative p-6 md:p-10 pl-8 md:pl-12">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: DESKTOP_COLOR, boxShadow: `0 0 8px ${DESKTOP_COLOR}60` }}
            />
            <h2 className="text-lg md:text-2xl font-display font-bold text-neutral-900 dark:text-white">
              <EditableText
                contentKey="about.download.title"
                defaultValue="Скачать приложение"
                tag="span"
              />
            </h2>
          </div>

          <EditableText
            contentKey="about.download.subtitle"
            defaultValue="Установите нативное приложение TZ.Connect — быстрый запуск, системные уведомления, демонстрация экрана и звонки. Доступно для Windows, macOS, Linux и Android (connect.apk)."
            tag="p"
            className="text-neutral-500 dark:text-gray-400 leading-relaxed text-sm md:text-base ml-[22px] mb-6"
            multiline
          />

          {available ? (
            <div className="ml-[22px]">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {/* Primary button — detected OS. Active only when that platform's
                    installer actually exists; otherwise the link would 404, so we
                    render a disabled control instead of a live download link. */}
                {primaryReady ? (
                  <motion.a
                    href={`/api/download/desktop?os=${os}`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-sm text-black transition-shadow"
                    style={{ backgroundColor: DESKTOP_COLOR, boxShadow: `0 0 24px ${DESKTOP_COLOR}40` }}
                  >
                    <OsIcon os={os} className="w-5 h-5" />
                    Скачать для {OS_LABEL[os]}
                  </motion.a>
                ) : (
                  <div
                    className="inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-sm cursor-not-allowed select-none border border-neutral-300 dark:border-white/10 text-neutral-400 dark:text-gray-500"
                    title={`Сборка для ${OS_LABEL[os]} пока недоступна на этом сервере`}
                    aria-disabled="true"
                  >
                    <OsIcon os={os} className="w-5 h-5" />
                    Скачать для {OS_LABEL[os]}
                  </div>
                )}

                {/* Secondary buttons — other platforms */}
                <div className="flex flex-wrap items-center gap-2">
                  {otherOses.map((o) => (
                    <a
                      key={o}
                      href={`/api/download/desktop?os=${o}`}
                      aria-disabled={platformReady(o) ? undefined : "true"}
                      className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border transition-colors
                        border-neutral-300 dark:border-white/10 text-neutral-600 dark:text-gray-300
                        hover:border-cyan-400/50 hover:text-cyan-500 dark:hover:text-cyan-400
                        ${platformReady(o) ? "" : "opacity-40 pointer-events-none cursor-not-allowed"}`}
                      title={platformReady(o) ? undefined : "Сборка недоступна"}
                    >
                      <OsIcon os={o} className="w-4 h-4" />
                      {OS_LABEL[o]}
                    </a>
                  ))}
                </div>
              </div>

              {/* When the visitor's own OS has no build, say so plainly and point
                  them at the platforms that do (the non-dimmed buttons above). */}
              {!primaryReady && (
                <p className="mt-3 text-xs text-neutral-500 dark:text-gray-400">
                  Для вашей ОС ({OS_LABEL[os]}) сборка пока недоступна — выберите
                  одну из доступных платформ.
                </p>
              )}
            </div>
          ) : (
            <div className="ml-[22px]">
              <div className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-medium border border-neutral-300 dark:border-white/10 text-neutral-500 dark:text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {loaded ? "Скоро — сборка готовится к выпуску" : "Проверяем наличие сборки…"}
              </div>
            </div>
          )}

          {available && meta?.version && (
            <div className="ml-[22px] mt-4 text-xs text-neutral-400 dark:text-gray-600">
              Актуальная версия: {meta.version}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
