"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";

/**
 * GAMES-CATALOG: витрина раздела /games.
 *
 * Раздел переписан целиком. Прежний вариант был массивом из одной игры внутри
 * страницы, и любое изменение требовало релиза; здесь всё приходит из каталога,
 * которым управляет админ-панель.
 *
 * Регистр оформления выбран по содержанию: игровая витрина — это тёмная сцена,
 * где главный герой — арт игры, а не текст вокруг него. Поэтому раздел
 * намеренно тёмный в обеих темах сайта: обложки на светлом фоне выглядят
 * вырезками из каталога, а не игрой.
 */

export interface GameCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover: string | null;
  players: string;
  tags: string[];
  kind: string;
  launchUrl: string;
  partnerName: string;
  onlinePlayers: number | null;
}

type Filter = "all" | "OWN" | "PARTNER";

const FILTER_LABEL: Record<Filter, string> = {
  all: "Все",
  OWN: "Наши",
  PARTNER: "Партнёрские",
};

function Cover({ src, title, className }: { src: string | null; title: string; className: string }) {
  if (!src) {
    return (
      <div className={`${className} grid place-items-center bg-[linear-gradient(135deg,#1a1420_0%,#2a1a1f_55%,#171a24_100%)]`}>
        <span className="px-6 text-center font-display text-2xl font-bold text-white/15">{title}</span>
      </div>
    );
  }
  /* Обложка партнёрской игры лежит на его домене. next/image потребовал бы
     вносить каждый такой домен в next.config, то есть новая игра появлялась бы
     без картинки до следующего релиза — ровно та связанность, от которой мы
     ушли, вынеся каталог в базу. */
  return <img src={src} alt={title} className={className} loading="lazy" />;
}

/** Партнёрская игра живёт на чужом домене — открываем в новой вкладке. */
function GameLink({ game, className, children }: { game: GameCard; className: string; children: React.ReactNode }) {
  const external = /^https?:\/\//.test(game.launchUrl);
  if (external) {
    return (
      <a href={game.launchUrl} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <Link href={game.launchUrl || `/games/${game.slug}`} className={className}>{children}</Link>;
}

function Badges({ game }: { game: GameCard }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {game.kind === "PARTNER" && (
        <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-300">
          {game.partnerName || "партнёр"}
        </span>
      )}
      {game.players && (
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white/70 backdrop-blur-sm">{game.players}</span>
      )}
      {game.onlinePlayers !== null && game.onlinePlayers > 0 && (
        <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {game.onlinePlayers} онлайн
        </span>
      )}
    </div>
  );
}

export default function GamesGallery({ games }: { games: GameCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const hasPartner = useMemo(() => games.some((g) => g.kind === "PARTNER"), [games]);
  const visible = useMemo(
    () => (filter === "all" ? games : games.filter((g) => g.kind === filter)),
    [games, filter],
  );

  const online = useMemo(
    () => games.reduce((sum, g) => sum + (g.onlinePlayers ?? 0), 0),
    [games],
  );

  const [spotlight, ...rest] = visible;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0d] text-white">
      {/* Сцена: мягкое свечение сверху, чтобы обложки не висели в пустоте */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px]">
        <div className="absolute left-1/2 top-[-220px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[160px]" />
        <div className="absolute right-[-120px] top-[60px] h-[420px] w-[420px] rounded-full bg-amber-500/10 blur-[140px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 py-14 max-md:px-4 max-md:py-8">
        {/* ── Шапка ── */}
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/35">T.Р.И.О.Z</p>
            <h1 className="mt-2 font-display text-5xl font-bold leading-none max-md:text-4xl">Игры</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/50">
              Наши проекты и игры студий-партнёров — в одном месте. Партнёрские карточки
              обновляются напрямую из API разработчика.
            </p>
          </div>
          <dl className="flex gap-8 text-right">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.2em] text-white/30">Игр</dt>
              <dd className="font-display text-3xl font-bold">{games.length}</dd>
            </div>
            {online > 0 && (
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-white/30">Онлайн</dt>
                <dd className="font-display text-3xl font-bold text-emerald-400">{online}</dd>
              </div>
            )}
          </dl>
        </header>

        {/* Фильтр появляется только когда есть что фильтровать: переключатель с
            одним осмысленным значением — это шум, а не управление. */}
        {hasPartner && (
          <div className="mt-8 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                  filter === key ? "bg-white text-neutral-950" : "text-white/55 hover:text-white"
                }`}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="mt-14 rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-20 text-center">
            <p className="font-display text-2xl font-semibold text-white/70">
              {games.length === 0 ? "Раздел готовится" : "В этой категории пока пусто"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/40">
              {games.length === 0
                ? "Игры появятся здесь, как только их откроют. Ничего настраивать не нужно — страница обновится сама."
                : "Попробуйте другую категорию."}
            </p>
          </div>
        ) : (
          <>
            {/* ── Витрина: первая игра занимает всю ширину ── */}
            <motion.section
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-10"
            >
              <GameLink
                game={spotlight}
                className="group relative block overflow-hidden rounded-3xl border border-white/10 transition-colors hover:border-white/25"
              >
                <Cover
                  src={spotlight.cover}
                  title={spotlight.title}
                  className="h-[420px] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] max-md:h-[300px]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0d] via-[#0a0a0d]/60 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-8 max-md:p-5">
                  <Badges game={spotlight} />
                  <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-tight max-md:text-2xl">
                    {spotlight.title}
                  </h2>
                  {spotlight.description && (
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60 max-md:line-clamp-3">
                      {spotlight.description}
                    </p>
                  )}
                  <span className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-neutral-950 transition-transform group-hover:translate-x-0.5">
                    Играть
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h13M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </GameLink>
            </motion.section>

            {/* ── Остальные ── */}
            {rest.length > 0 && (
              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((game, i) => (
                  <motion.div
                    key={game.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 * i, duration: 0.5 }}
                  >
                    <GameLink
                      game={game}
                      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition-colors hover:border-white/25"
                    >
                      <div className="relative overflow-hidden">
                        <Cover
                          src={game.cover}
                          title={game.title}
                          className="h-44 w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0d0d11] to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 p-3">
                          <Badges game={game} />
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col p-4">
                        <h3 className="font-display text-lg font-semibold leading-snug">{game.title}</h3>
                        {game.description && (
                          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-white/50">{game.description}</p>
                        )}
                        {game.tags.length > 0 && (
                          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                            {game.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/45">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </GameLink>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Метки витринной игры вынесены под неё: в самой карточке им тесно
                рядом с описанием и кнопкой. */}
            {spotlight.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {spotlight.tags.map((tag) => (
                  <span key={tag} className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/45">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        <p className="mt-16 border-t border-white/[0.07] pt-6 text-xs text-white/25">
          Партнёрские игры открываются на сайте разработчика. Данные их карточек — название,
          обложка, число игроков онлайн — приходят от него по API.
        </p>
      </div>
    </div>
  );
}
