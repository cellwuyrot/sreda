"use client";

/**
 * NEWS: лента канала-новостей.
 *
 * ── Чем она не похожа на канал сообщений ────────────────────────────────────
 *
 * Переписка читается снизу вверх и держится у нижнего края: пришло новое —
 * прокрутились к нему. Новости читаются сверху вниз, и новое приходит редко.
 * Отсюда всё остальное: никаких «пузырей» и колонки аватаров слева, карточка во
 * всю ширину, прокрутка сверху вниз, следующая страница подгружается по мере
 * приближения к концу, а не разом.
 *
 * Порядок задаёт сервер: закреплённое первым, дальше по убыванию даты. Клиент
 * его не пересортировывает — правила закрепления живут в одном месте, иначе
 * лента после обновления страницы перестраивалась бы у человека на глазах.
 *
 * ── Экран поста поверх, а не вместо ─────────────────────────────────────────
 *
 * Открытая новость рисуется слоем над лентой, а лента остаётся смонтированной.
 * Если её размонтировать, возврат «назад» приводил бы к самому верху — на
 * телефоне, где до тридцатой карточки листать полминуты, это худшее, что может
 * случиться после чтения одной новости.
 *
 * Но собственного слоя мало. Оболочка под Android — это WebView с системной
 * кнопкой «назад», и она ничего не знает про наше состояние: пока экран поста
 * не отмечен записью в history, нажатие уводило человека сразу из канала в
 * список сообществ — через голову открытой новости и через голову самой ленты.
 * Поэтому слой регистрируется через useHistoryLayer, ровно как открытая беседа
 * в личных сообщениях и выдвижная панель каналов: одно нажатие «назад» —
 * один слой.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMobile } from "@/hooks/useMobile";
import { useHistoryLayer } from "@/components/connect/hooks/useMobileHistoryStack";
import { NewsIcon } from "@/components/ui/ConnectIcons";
import NewsPostCard from "./NewsPostCard";
import NewsPostScreen from "./NewsPostScreen";
import type { NewsPage, NewsPost } from "./types";

const PAGE_SIZE = 20;

/**
 * За сколько до конца ленты просить следующую страницу. Экран телефона — около
 * 700 пикселей: страница успевает приехать, пока человек долистывает видимое,
 * и «Загружаем…» он не встречает вовсе.
 */
const PREFETCH_MARGIN = "700px";

/** Насколько надо оттянуть ленту (после сопротивления), чтобы она обновилась. */
const PULL_THRESHOLD = 56;
const PULL_MAX = 96;
/** Во сколько раз палец уходит дальше, чем едет лента: жест ощущается упругим. */
const PULL_RESISTANCE = 0.5;

/** Высота полосы с указателем обновления. */
const PULL_BAR = 40;

/**
 * Просвет под последней карточкой, когда человек может публиковать.
 *
 * Кнопку «Написать» рисует не лента, а MessageArea — поверх, у нижнего правого
 * края. Своего места в потоке она не занимает, и без этого просвета накрывала
 * собой низ последней карточки: автора, дату, число комментариев и реакции. На
 * широком экране это видно как «кнопка лежит на карточке», на телефоне хуже —
 * там карточка во всю ширину, и накрытая строка последняя в ленте, дочитать её
 * нечем: прокрутка уже кончилась.
 *
 * Слагаемые те же, что у самой кнопки (MessageArea): её высота 2.75rem, отступ
 * от низа 1rem и безопасная зона снизу — на телефоне с полосой жестов кнопка
 * поднимается на её высоту, и просвет обязан вырасти ровно на столько же.
 * Сверху ещё 0.75rem, чтобы карточка не подходила к кнопке впритык.
 */
const POST_BUTTON_CLEARANCE = "calc(4.5rem + env(safe-area-inset-bottom, 0px))";

function FeedSkeleton() {
  /* Скелетоны, а не крутилка по центру: заранее видно, что приедет список
     карточек, и высота ленты не прыгает в момент подстановки данных. */
  return (
    <div className="space-y-3 px-3 py-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-white/10">
          <div className="aspect-[16/9] w-full animate-pulse bg-neutral-200 dark:bg-white/10" />
          <div className="space-y-2 p-4">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
            <div className="h-2.5 w-full animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
            <div className="h-2.5 w-5/6 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NewsFeed({
  channelId,
  onCanPostChange,
  onEditPost,
  refreshToken = 0,
}: {
  channelId: string;
  /**
   * Может ли этот человек публиковать. Кнопку «написать» рисует не лента —
   * редактор поста живёт отдельно, а признак приходит вместе со страницей.
   */
  onCanPostChange?: (canPost: boolean) => void;
  /**
   * «Править этот пост» с экрана поста. Лента только пробрасывает выбор туда
   * же, где живёт редактор — к ней самой правка отношения не имеет, а держать
   * редактор внутри значило бы грузить его вместе с первой же новостью.
   */
  onEditPost?: (post: NewsPost) => void;
  /** Смена значения перечитывает ленту — так редактор сообщает о публикации. */
  refreshToken?: number;
}) {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [canPost, setCanPost] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openPost, setOpenPost] = useState<NewsPost | null>(null);
  const [pull, setPull] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pullStartRef = useRef<number | null>(null);

  /* Экран поста — слой в истории, а не просто div поверх ленты.
     Без этого системная «назад» Android (кнопка или жест от края) шла мимо
     открытой новости прямо по стеку мессенджера: канал закрывался, и человек
     оказывался в списке сообществ, потеряв и пост, и место в ленте. Закрыть
     новость «своей» кнопкой он мог, но привычка на телефоне одна — смахнуть от
     края, и она работала как выход из раздела.

     Только на телефоне: на большом экране стрелка браузера — это переход по
     сайту, и присваивать её себе значило бы ломать десктопную навигацию. */
  const isMobileViewport = useMobile();
  const closeOpenPost = useCallback(() => setOpenPost(null), []);
  useHistoryLayer(isMobileViewport && !!openPost, closeOpenPost, "news-post");

  const fetchPage = useCallback(
    async (from: string | null): Promise<NewsPage> => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (from) query.set("cursor", from);
      const res = await fetch(`/api/channels/${channelId}/posts?${query.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as NewsPage;
    },
    [channelId],
  );

  /* Первая страница: и при открытии канала, и когда редактор сообщил о новом
     посте или о правке. Список чистится сразу — иначе при переключении каналов
     на экране секунду висят чужие новости.

     Заодно закрывается открытый пост. Его экран держит копию записи, снятую с
     прежней страницы, и после правки показывал бы старый заголовок и старый
     текст поверх уже перечитанной ленты — то есть ровно то, ради чего правку и
     затевали, человек бы не увидел. */
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setPosts([]);
    setCursor(null);
    setMoreFailed(false);
    setOpenPost(null);
    fetchPage(null)
      .then((page) => {
        if (!alive) return;
        setPosts(page.posts ?? []);
        setCursor(page.nextCursor ?? null);
        setCanPost(!!page.canPost);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [fetchPage, refreshToken]);

  /* Наверх сообщаем только о смене признака. Родитель нередко передаёт стрелку
     прямо в разметке — без этой проверки он получал бы вызов на каждую отрисовку
     ленты и, если он на нём что-то сохраняет, крутился бы по кругу. */
  const reportedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (reportedRef.current === canPost) return;
    reportedRef.current = canPost;
    onCanPostChange?.(canPost);
  }, [canPost, onCanPostChange]);

  const refresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    fetchPage(null)
      .then((page) => {
        setPosts(page.posts ?? []);
        setCursor(page.nextCursor ?? null);
        setCanPost(!!page.canPost);
        setStatus("ready");
        setMoreFailed(false);
      })
      .catch(() => {
        /* оставляем то, что уже прочитано: пустая лента вместо новостей из-за
           одного неудачного обновления — потеря, а не честность */
      })
      .finally(() => setRefreshing(false));
  }, [fetchPage, refreshing]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchPage(cursor)
      .then((page) => {
        setPosts((prev) => {
          /* Страницы режутся по времени создания: пока человек листал, наверх
             мог встать новый пост, и одна запись приезжает дважды. Без отсева
             React ругается на повторяющиеся ключи, а карточка двоится. */
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(page.posts ?? []).filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor ?? null);
      })
      .catch(() => setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, fetchPage]);

  /* Подгрузка по приближению к концу. Наблюдатель пересоздаётся при смене
     курсора: так в замыкании всегда свежий loadMore, и лента не застревает на
     одной и той же странице.

     root — сам контейнер прокрутки, а не окно: лента прокручивается внутри
     себя, и с окном в роли корня метка считалась бы видимой с самого начала,
     вытянув все страницы разом. Пока открыт пост, наблюдатель не нужен —
     дочитывать ленту под закрытым экраном незачем. */
  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollRef.current;
    if (!node || !cursor || moreFailed || openPost) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: `0px 0px ${PREFETCH_MARGIN} 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, moreFailed, openPost, loadMore]);

  /* Правки, пришедшие с экрана поста: просмотры, число комментариев, закрепление. */
  const handlePostChange = useCallback(
    (id: string, patch: Partial<NewsPost>) => {
      const before = posts.find((p) => p.id === id);
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      setOpenPost((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
      /* Закрепление меняет порядок ленты, а порядок — дело сервера. Перечитать
         первую страницу честнее, чем повторять его правила здесь и разойтись с
         ним при следующей правке. */
      if (before && patch.pinned !== undefined && before.pinned !== patch.pinned) refresh();
    },
    [posts, refresh],
  );

  /* Потягивание вниз. Событие не отменяется намеренно: React вешает touchmove
     пассивным, preventDefault в нём всё равно не сработает. Вместо этого лента
     тянется только от самого верха, а overscroll-contain не пускает жест в
     собственное обновление WebView — иначе Android перезагружал бы страницу
     целиком вместо перечитывания ленты. */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    pullStartRef.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStartRef.current === null) return;
    const delta = e.touches[0].clientY - pullStartRef.current;
    setPull(delta <= 0 ? 0 : Math.min(PULL_MAX, delta * PULL_RESISTANCE));
  }, []);

  const onTouchEnd = useCallback(() => {
    const reached = pull >= PULL_THRESHOLD;
    pullStartRef.current = null;
    setPull(0);
    if (reached) refresh();
  }, [pull, refresh]);

  const shift = refreshing ? PULL_BAR : pull;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--cn-main)]">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          style={{
            transform: shift ? `translateY(${shift}px)` : undefined,
            /* Плавно только на возврате: во время самого жеста лента должна
               идти за пальцем без запаздывания. */
            transition: pull ? "none" : "transform 180ms ease-out",
          }}
        >
          {/* Указатель обновления сидит выше первой карточки на свою высоту и
              выезжает вместе с лентой — своего места в потоке он не занимает. */}
          <div
            className="flex items-center justify-center"
            style={{ height: PULL_BAR, marginTop: -PULL_BAR, opacity: Math.min(1, shift / PULL_THRESHOLD) }}
            aria-hidden="true"
          >
            <span
              className={`h-6 w-6 rounded-full border-2 border-violet-500 dark:border-cyan-400 ${
                refreshing ? "animate-spin border-t-transparent" : "border-dashed"
              }`}
            />
          </div>

          {status === "loading" && <FeedSkeleton />}

          {status === "error" && (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <p className="text-[14px] text-neutral-500 dark:text-neutral-400">Лента не загрузилась</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 min-h-[44px] rounded-xl border border-neutral-200 px-5 text-[13px] font-medium text-neutral-600 transition-colors active:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:active:bg-white/5"
              >
                Повторить
              </button>
            </div>
          )}

          {status === "ready" && posts.length === 0 && (
            <div className="flex flex-col items-center px-8 py-20 text-center">
              <NewsIcon size={34} />
              <p className="mt-3 text-[15px] font-medium text-neutral-600 dark:text-neutral-300">Здесь пока тихо</p>
              <p className="mt-1 text-[13px] text-neutral-400">
                {canPost ? "Первая новость — за вами" : "Новости появятся, когда их опубликуют"}
              </p>
            </div>
          )}

          {posts.length > 0 && (
            <div className="space-y-3 px-3 py-3">
              {posts.map((post) => (
                <NewsPostCard key={post.id} post={post} onOpen={setOpenPost} />
              ))}
            </div>
          )}

          {/* Метка конца: наблюдатель следит именно за ней. */}
          <div ref={sentinelRef} className="h-px" />

          {loadingMore && (
            <p className="pb-6 text-center text-[13px] text-neutral-400">Загружаем…</p>
          )}

          {moreFailed && (
            <div className="flex justify-center pb-6">
              <button
                type="button"
                onClick={loadMore}
                className="min-h-[44px] rounded-xl border border-neutral-200 px-5 text-[13px] font-medium text-neutral-500 transition-colors active:bg-neutral-50 dark:border-white/10 dark:text-neutral-400 dark:active:bg-white/5"
              >
                Показать ещё
              </button>
            </div>
          )}

          {/* Просвет под кнопку «Написать» — она лежит поверх ленты и иначе
              накрывает низ последней карточки (см. POST_BUTTON_CLEARANCE).
              Только когда кнопка есть: читателю пустое место внизу ни к чему. */}
          {canPost && posts.length > 0 && (
            <div style={{ height: POST_BUTTON_CLEARANCE }} aria-hidden="true" />
          )}
        </div>
      </div>

      {openPost && (
        <div className="absolute inset-0 z-20">
          <NewsPostScreen
            post={openPost}
            onBack={() => setOpenPost(null)}
            onPostChange={handlePostChange}
            onEdit={onEditPost}
          />
        </div>
      )}
    </div>
  );
}
