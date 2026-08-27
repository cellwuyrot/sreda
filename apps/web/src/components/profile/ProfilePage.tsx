"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import WallPager from "@/components/profile/WallPager";
import {
  BookOpenIcon,
  ClockIcon,
  FilmIcon,
  FriendsIcon,
  InfoIcon,
  MessagesIcon,
  MicIcon,
  NewsIcon,
  PinIcon,
  StarIcon,
  UserPlusIcon,
  UsersIcon,
  GearIcon,
} from "@/components/ui/ConnectIcons";
import { TrashIcon } from "@/components/ui/ConnectIconsExtra";
import { downscaleForChat } from "@/lib/clientImageResize"; // FIX-NOSHARP
import { useCall } from "@/components/call/CallProvider"; // CALL
import ProfileBanner from "@/components/ui/ProfileBanner"; // FIX-BANNERONE

/**
 * PROFILE-WALL: личная страница — шапка, стена, подписчики, подписки.
 *
 * Один компонент на свою и чужую страницу. Разводить их на два было бы хуже:
 * различий всего два (композер и кнопка подписки), а расхождение вёрстки двух
 * копий со временем неизбежно.
 *
 * Все три списка листаются страницами по 15, без бесконечной прокрутки: номер
 * страницы можно запомнить и вернуться, позицию прокрутки — нет.
 */

interface WallAuthor {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  avatarGlowEnabled: boolean;
  avatarGlowColors: string | null;
}

/**
 * FIX-WALLMEDIA: материал записи на стене.
 *
 * Сервер умел хранить вложения записи и до этого (поле attachments в базе и
 * sanitizeWallAttachments на входе), но в интерфейсе их негде было приложить —
 * стена оставалась чисто текстовой. Форма совпадает с WallAttachment на сервере.
 */
export interface WallMedia {
  url: string;
  name: string;
  size?: number;
  type?: string;
}

interface WallPost {
  id: string;
  title: string;
  content: string;
  cover: string | null;
  /** FIX-WALLMEDIA: фото, видео и документы записи. */
  attachments?: WallMedia[];
  pinned: boolean;
  views: number;
  commentsClosed: boolean;
  createdAt: string;
  editedAt: string | null;
  commentCount: number;
  author: WallAuthor;
  canEdit: boolean;
  canDelete: boolean;
}

interface ProfileHead {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  bio: string | null;
  customStatus: string | null;
  statusEmoji: string | null;
  avatarGlowEnabled: boolean;
  avatarGlowColors: string | null;
  profileBanner: string | null;
  createdAt: string;
  stats: { messages: number; friends: number; games: number };
  badges: Array<{ id: string; name: string; icon: string | null; rarity: string }>;
  isSelf: boolean;
}

interface FollowUser extends WallAuthor {
  isFollowing: boolean;
  isSelf: boolean;
}

/**
 * PROFILE-BACK: шаг назад из профиля — своего или чужого.
 *
 * Профиль — отдельная страница, а не слой поверх мессенджера, и его шапка не
 * относится к навигации самого TZ Connect. Зайти сюда можно из переписки, из
 * списка участников, из ленты, из подписчиков другого человека — перечислить все
 * входы ссылкой «куда вернуться» невозможно, поэтому шаг делается по истории.
 *
 * Запасной вариант обязателен: страницу открывают и прямой ссылкой — из почты, из
 * соседнего чата, из закладки. В этом случае в истории ничего нет, и `back()` либо
 * ничего не сделает, либо выбросит из приложения совсем — тогда ведём в мессенджер.
 */
function BackButton() {
  const router = useRouter();

  const goBack = () => {
    /* FIX-BACKEXIT: всегда выход в мессенджер, без истории браузера.
       history.back() возвращал на запись, а не в место: и /connect, и настройки
       меняют содержимое без смены адреса, поэтому шаг назад часто попадал на
       ту же самую страницу и кружил человека между двумя экранами. В мессенджере
       восстанавливается последний открытый раздел, так что потери контекста нет. */
    router.push("/connect");
  };

  return (
    <button
      type="button"
      onClick={goBack}
      /* max-md:min-h-[44px] — на телефоне цель под палец, а не под курсор. */
      className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 max-md:min-h-[44px] text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
      aria-label="Вернуться назад"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Назад
    </button>
  );
}

/**
 * CALL: «Позвонить» и «Видео» на странице другого человека.
 *
 * Кнопки появляются только в apk: только там второй человек увидит вызов на
 * закрытом телефоне. Показывать их в браузере было бы обманом: звонок ушёл бы
 * в пустоту, если вкладка адресата закрыта.
 *
 * Ошибка показывается отдельной строкой под кнопками: «Звонить можно только
 * друзьям» или «Абонент занят» — без этого нажатие выглядело бы как сломанное.
 */
function CallButtons({ head }: { head: ProfileHead }) {
  const { callSupported, startCall, state } = useCall();
  const [error, setError] = useState<string | null>(null);
  const busy = state.phase !== "idle";

  if (!callSupported) return null;

  const dial = async (video: boolean) => {
    setError(null);
    const result = await startCall(
      { userId: head.id, userName: head.name, avatar: head.avatar },
      video,
    );
    if (!result.ok) setError(result.error ?? "Звонок недоступен");
  };

  /* PROFILE-CALL-FIX: кнопки — прямые дети общей строки действий (flex-wrap в
     шапке), а не отдельный вложенный блок. Так они переносятся вместе с
     «Подписаться», а не сжимаются в одну тесную колонку. shrink-0 +
     whitespace-nowrap не дают кнопке ужаться настолько, чтобы иконка налезла на
     текст; min-h-[44px] держит цель под палец. Ошибка — во всю ширину строки
     (basis-full), отдельной строкой под кнопками. */
  return (
    <>
      <button
        type="button"
        onClick={() => void dial(false)}
        disabled={busy}
        className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 max-sm:flex-1"
        aria-label={`Позвонить ${head.name}`}
      >
        <MicIcon size={16} style={{ color: "inherit" }} />
        Позвонить
      </button>
      <button
        type="button"
        onClick={() => void dial(true)}
        disabled={busy}
        className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5 max-sm:flex-1"
        aria-label={`Видеовызов ${head.name}`}
      >
        <FilmIcon size={16} style={{ color: "inherit" }} />
        Видео
      </button>
      {error && (
        <div className="basis-full text-[11px] text-red-500 sm:text-right">{error}</div>
      )}
    </>
  );
}

type Tab = "wall" | "followers" | "following";

/* PROFILE-WALL2: на личной странице роли не показываются вообще.

   Личная страница — про человека, а не про его место в штатном расписании.
   Служебное положение (администратор, редактор, партнёр) видно там, где оно
   имеет силу: в сообществе и в рабочих разделах. Права при этом не меняются:
   скрыта только подпись, проверки остались на сервере. */

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/60 p-4">
      {children}
    </div>
  );
}

/** Фото по типу или по расширению: у старых записей типа может не быть. */
function isWallImage(m: WallMedia) {
  return (m.type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(m.url);
}

function isWallVideo(m: WallMedia) {
  return (m.type || "").startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(m.url);
}

function formatSize(bytes?: number) {
  if (typeof bytes !== "number" || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * FIX-WALLMEDIA: материал записи выглядит так же, как в новостях: фото сеткой,
 * видео штатным проигрывателем, документы — строкой с именем и размером.
 *
 * Видео без preload: на стене записей много, и автозагрузка каждого ролика
 * съела бы канал разом при открытии страницы.
 */
function WallMediaView({ items }: { items?: WallMedia[] }) {
  if (!items || items.length === 0) return null;
  const images = items.filter(isWallImage);
  const videos = items.filter(isWallVideo);
  const files = items.filter((m) => !isWallImage(m) && !isWallVideo(m));
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-2"}>
          {images.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.url}
              src={m.url}
              alt={m.name}
              className="w-full max-h-96 rounded-xl object-cover"
            />
          ))}
        </div>
      )}
      {videos.map((m) => (
        <video
          key={m.url}
          src={m.url}
          controls
          preload="metadata"
          className="w-full max-h-96 rounded-xl bg-black"
        />
      ))}
      {files.map((m) => (
        <a
          key={m.url}
          href={m.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-neutral-700 dark:text-gray-200 hover:border-indigo-400 transition-colors"
        >
          <BookOpenIcon size={14} />
          <span className="truncate">{m.name}</span>
          <span className="ml-auto shrink-0 text-xs text-neutral-400">{formatSize(m.size)}</span>
        </a>
      ))}
    </div>
  );
}

export default function ProfilePage({ username }: { username?: string }) {
  const router = useRouter(); // WRITE-BTN SETTINGS-BTN
  const { data: session } = useSession();
  const viewerName = session?.user?.username;
  const target = username || viewerName;

  const [head, setHead] = useState<ProfileHead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("wall");

  const [posts, setPosts] = useState<WallPost[]>([]);
  const [postPage, setPostPage] = useState(1);
  const [postPages, setPostPages] = useState(1);
  const [postTotal, setPostTotal] = useState(0);
  const [canPost, setCanPost] = useState(false);

  const [people, setPeople] = useState<FollowUser[]>([]);
  const [peoplePage, setPeoplePage] = useState(1);
  const [peoplePages, setPeoplePages] = useState(1);

  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  /* FIX-WALLMEDIA: материал грузится СРАЗУ при выборе, а в запись уходят уже
     готовые адреса — так же, как вложения в чате. Иначе большое видео
     уходило бы одним запросом вместе с текстом, и при обрыве терялся бы весь
     черновик. */
  const [media, setMedia] = useState<WallMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  /* Шапка тянется из уже существующего публичного профиля, а не из нового адреса:
     там уже учтены настройки приватности, бейджи и статус активности. Второй
     источник тех же данных рано или поздно разошёлся бы с первым. */
  useEffect(() => {
    if (!target) return;
    // FIX-PROFILESYNC: сбрасываем данные сразу при смене профиля,
    // иначе шапка (в т.ч. баннер) показывает предыдущего человека
    // пока идёт запрос — «теряется синхронизация» между профилями.
    setHead(null);
    setError(null);
    let alive = true;
    (async () => {
      const res = await fetch(`/api/profile/public?username=${encodeURIComponent(target)}`);
      if (!alive) return;
      if (!res.ok) {
        setError("Профиль не найден");
        return;
      }
      setHead((await res.json()) as ProfileHead);
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  const loadWall = useCallback(
    async (userId: string, page: number) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/wall/${userId}?page=${page}`);
        if (!res.ok) return;
        const data = await res.json();
        setPosts(data.posts ?? []);
        setPostPage(data.page ?? 1);
        setPostPages(data.pages ?? 1);
        setPostTotal(data.total ?? 0);
        setCanPost(!!data.canPost);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const loadPeople = useCallback(async (userId: string, kind: Tab, page: number) => {
    if (kind === "wall") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/${kind}?page=${page}`);
      if (!res.ok) return;
      const data = await res.json();
      setPeople(data.users ?? []);
      setPeoplePage(data.page ?? 1);
      setPeoplePages(data.pages ?? 1);
    } finally {
      setBusy(false);
    }
  }, []);

  /* Счётчики и собственный статус подписки приходят с сервера одним ответом и
     обновляются тем же ответом после нажатия: если считать подписчиков на клиенте
     («плюс один»), два открытых окна тут же покажут разные числа. */
  const loadCounters = useCallback(async (userId: string) => {
    const res = await fetch(`/api/users/${userId}/follow`);
    if (!res.ok) return;
    const data = await res.json();
    setFollowers(data.followers ?? 0);
    setFollowing(data.following ?? 0);
    setIsFollowing(!!data.isFollowing);
  }, []);

  useEffect(() => {
    if (!head) return;
    loadCounters(head.id);
    loadWall(head.id, 1);
  }, [head, loadCounters, loadWall]);

  function switchTab(next: Tab) {
    setTab(next);
    if (!head) return;
    if (next === "wall") loadWall(head.id, 1);
    else loadPeople(head.id, next, 1);
  }

  async function toggleFollow() {
    if (!head || followBusy) return;
    setFollowBusy(true);
    try {
      const res = await fetch(`/api/users/${head.id}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
      });
      if (!res.ok) return;
      const data = await res.json();
      setFollowers(data.followers ?? 0);
      setFollowing(data.following ?? 0);
      setIsFollowing(!!data.isFollowing);
    } finally {
      setFollowBusy(false);
    }
  }

  /**
   * FIX-WALLMEDIA: загрузка выбранных файлов на стену.
   *
   * По одному файлу за запрос: так одна неудача не убивает остальные и
   * видно, какой именно файл не прошёл.
   */
  const uploadWallFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files.slice(0, 10)) {
        const form = new FormData();
        // FIX-NOSHARP: фото для стены уменьшает браузер.
        form.append("file", await downscaleForChat(file));
        const res = await fetch("/api/wall/upload", {
          method: "POST",
          body: form,
          credentials: "include",
        }).catch(() => null);
        if (!res || !res.ok) {
          const message = res ? await res.json().catch(() => null) : null;
          setUploadError(
            (message && typeof message.error === "string" ? message.error : null) ||
              `Не удалось загрузить «${file.name}»`,
          );
          continue;
        }
        const data = (await res.json()) as WallMedia;
        setMedia((prev) => (prev.length >= 10 ? prev : [...prev, data]));
      }
    } finally {
      setUploading(false);
    }
  }, []);

  async function submitPost() {
    if (!head || sending) return;
    const content = draft.trim();
    /* FIX-WALLMEDIA: запись только из материала, без текста, тоже имеет смысл. */
    if (!content && media.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/wall/${head.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          title: draftTitle.trim() || undefined,
          /* cover намеренно не заполняем: иначе первое фото показывалось бы дважды. */
          attachments: media.length > 0 ? media : undefined,
        }),
      });
      if (!res.ok) return;
      setDraft("");
      setDraftTitle("");
      setMedia([]);
      setUploadError(null);
      /* Перечитываем первую страницу, а не вставляем запись в начало списка:
         на странице есть закреплённые, и порядок знает только сервер. */
      await loadWall(head.id, 1);
    } finally {
      setSending(false);
    }
  }

  async function removePost(id: string) {
    if (!head) return;
    const res = await fetch(`/api/wall/posts/${id}`, { method: "DELETE" });
    if (res.ok) await loadWall(head.id, postPage);
  }

  async function togglePin(post: WallPost) {
    if (!head) return;
    const res = await fetch(`/api/wall/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !post.pinned }),
    });
    if (res.ok) await loadWall(head.id, postPage);
  }

  if (error) {
    return <div className="max-w-3xl mx-auto p-6 text-neutral-500 dark:text-gray-400">{error}</div>;
  }
  if (!head) {
    return <div className="max-w-3xl mx-auto p-6 text-neutral-400">Загрузка…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* PROFILE-BACK: возврат туда, откуда открыли профиль. */}
      <BackButton />

      {/* Шапка */}
      <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/60">
        {/* FIX-BANNERONE: фон профиля рисует общий компонент — тегом <img>, а не
            свойством background-image. Так рамка из настроек совпадает с
            мини-профилем, и пустой блок больше не выдаёт себя за «фона нет». */}
        <ProfileBanner src={head.profileBanner} className="h-32" overlay={false} />
        <div className="p-4 pt-0">
          {/* PROFILE-HEAD-FIX: на телефоне (WebView Android) шапка встаёт в
              колонку, а кнопки действий переезжают на отдельную строку под
              именем. Раньше аватар, имя, «Позвонить», «Видео» и «Подписаться»
              стояли в одной строке без переноса: на узком экране они сжимались,
              иконки налезали на текст и вёрстка ломалась. */}
          {/* FIX-PROFHEAD: аватар стоит на своёй строке, имя и ник — под ним во всю
              ширину карточки. Раньше кружок 80×80 стоял в одной строке с именем,
              и на узком экране длинное имя обрезалось многоточием вместо переноса. */}
          <div className="-mt-10 flex flex-col gap-3">
            <GlowAvatar user={head} size={80} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold leading-snug text-neutral-900 dark:text-white break-words">
                  {head.name}
                </h1>
                <div className="text-sm text-neutral-500 dark:text-gray-400 break-all">@{head.username}</div>
              </div>

            {/* CALL: звонок другу — только на чужой странице и только в приложении для телефона.
                Кнопки действий в одной переносимой строке, чтобы ничего не наезжало. */}
            {head.isSelf && (
              <div className="flex flex-wrap items-center gap-2 max-sm:w-full sm:justify-end">
                <button
                  type="button"
                  onClick={() => router.push("/settings")}
                  className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5 max-sm:flex-1"
                >
                  <GearIcon size={16} style={{ color: "inherit" }} />
                  Настройки
                </button>
              </div>
            )}
            {!head.isSelf && (
              <div className="flex flex-wrap items-center gap-2 max-sm:w-full sm:justify-end">
                <CallButtons head={head} />
                {/* WRITE-BTN: кнопка написать — переход в личные сообщения */}
                <button
                  type="button"
                  onClick={() => router.push(`/connect?section=dm&dm=${head.id}`)}
                  className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 max-sm:flex-1"
                  aria-label={`Написать ${head.name}`}
                >
                  <MessagesIcon size={16} style={{ color: "inherit" }} />
                  Написать
                </button>
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 max-sm:flex-1 ${
                    isFollowing
                      ? "border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5"
                      : "bg-indigo-600 text-white hover:bg-indigo-500"
                  }`}
                >
                  <UserPlusIcon size={16} style={{ color: "inherit" }} />
                  {isFollowing ? "Вы подписаны" : "Подписаться"}
                </button>
              </div>
            )}
            </div>
          </div>

          {(head.customStatus || head.bio) && (
            <div className="mt-3 space-y-1">
              {head.customStatus && (
                <div className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-gray-300">
                  <InfoIcon size={15} style={{ color: "inherit" }} />
                  <span>
                    {head.statusEmoji ? `${head.statusEmoji} ` : ""}
                    {head.customStatus}
                  </span>
                </div>
              )}
              {head.bio && (
                <div className="flex items-start gap-1.5 text-sm text-neutral-600 dark:text-gray-300">
                  <BookOpenIcon size={15} style={{ color: "inherit" }} />
                  <span className="whitespace-pre-wrap">{head.bio}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 text-neutral-600 dark:text-gray-300">
              <NewsIcon size={16} style={{ color: "inherit" }} />
              {postTotal} записей
            </span>
            <button
              type="button"
              onClick={() => switchTab("followers")}
              className="flex items-center gap-1.5 text-neutral-600 dark:text-gray-300 hover:text-indigo-500"
            >
              <UsersIcon size={16} style={{ color: "inherit" }} />
              {followers} подписчиков
            </button>
            <button
              type="button"
              onClick={() => switchTab("following")}
              className="flex items-center gap-1.5 text-neutral-600 dark:text-gray-300 hover:text-indigo-500"
            >
              <FriendsIcon size={16} style={{ color: "inherit" }} />
              {following} подписок
            </button>
            <span className="flex items-center gap-1.5 text-neutral-500 dark:text-gray-400">
              <MessagesIcon size={16} style={{ color: "inherit" }} />
              {head.stats.messages} сообщений
            </span>
            <span className="flex items-center gap-1.5 text-neutral-500 dark:text-gray-400">
              <ClockIcon size={16} style={{ color: "inherit" }} />
              С {formatDate(head.createdAt)}
            </span>
          </div>

          {head.badges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {head.badges.slice(0, 12).map((badge) => (
                <span
                  key={badge.id}
                  title={badge.name}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300"
                >
                  <StarIcon size={12} style={{ color: "inherit" }} />
                  {badge.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-white/5">
        {([
          ["wall", "Стена"],
          ["followers", "Подписчики"],
          ["following", "Подписки"],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
              tab === key
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm"
                : "text-neutral-500 dark:text-gray-400 hover:text-neutral-800 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "wall" && (
        <div className="space-y-3">
          {canPost && (
            <Card>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value.slice(0, 200))}
                placeholder="Заголовок (необязательно)"
                className="w-full bg-transparent text-sm font-medium text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none mb-2"
              />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="Что у вас нового?"
                className="w-full bg-transparent text-sm text-neutral-800 dark:text-gray-200 placeholder:text-neutral-400 outline-none resize-y"
              />
              {/* FIX-WALLMEDIA: выбор материала — три отдельные кнопки, чтобы в окне
                  выбора сразу были нужные файлы, а не всё подряд. */}
              {media.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {media.map((m) => (
                    <span
                      key={m.url}
                      className="flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-white/10 px-2 py-1 text-xs text-neutral-600 dark:text-gray-300"
                    >
                      <span className="max-w-[160px] truncate">{m.name}</span>
                      <button
                        type="button"
                        onClick={() => setMedia((prev) => prev.filter((x) => x.url !== m.url))}
                        className="text-neutral-400 hover:text-red-500"
                        aria-label="Убрать из записи"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {uploadError && (
                <div className="mt-2 text-xs text-red-500">{uploadError}</div>
              )}

              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void uploadWallFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
                multiple
                hidden
                onChange={(e) => {
                  void uploadWallFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z"
                multiple
                hidden
                onChange={(e) => {
                  void uploadWallFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploading || media.length >= 10}
                    className="flex items-center gap-1 rounded-xl border border-neutral-200 dark:border-white/10 px-3 py-1.5 text-xs text-neutral-600 dark:text-gray-300 hover:border-indigo-400 disabled:opacity-40 transition-colors"
                  >
                    <NewsIcon size={13} style={{ color: "inherit" }} />
                    Фото
                  </button>
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={uploading || media.length >= 10}
                    className="flex items-center gap-1 rounded-xl border border-neutral-200 dark:border-white/10 px-3 py-1.5 text-xs text-neutral-600 dark:text-gray-300 hover:border-indigo-400 disabled:opacity-40 transition-colors"
                  >
                    <FilmIcon size={13} style={{ color: "inherit" }} />
                    Видео
                  </button>
                  <button
                    type="button"
                    onClick={() => docInputRef.current?.click()}
                    disabled={uploading || media.length >= 10}
                    className="flex items-center gap-1 rounded-xl border border-neutral-200 dark:border-white/10 px-3 py-1.5 text-xs text-neutral-600 dark:text-gray-300 hover:border-indigo-400 disabled:opacity-40 transition-colors"
                  >
                    <BookOpenIcon size={13} />
                    Документ
                  </button>
                  {uploading && <span className="text-xs text-neutral-400">Загрузка…</span>}
                </div>
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={sending || uploading || (!draft.trim() && media.length === 0)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                >
                  {sending ? "Публикация…" : "Опубликовать"}
                </button>
              </div>
            </Card>
          )}

          {posts.length === 0 && (
            <Card>
              <div className="text-sm text-neutral-500 dark:text-gray-400 text-center py-6">
                {canPost ? "Здесь пока пусто — напишите первую запись." : "Записей пока нет."}
              </div>
            </Card>
          )}

          {posts.map((post) => (
            <Card key={post.id}>
              <div className="flex items-start gap-3">
                <GlowAvatar user={post.author} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-neutral-900 dark:text-white">{post.author.name}</span>
                    <span className="text-xs text-neutral-400">{formatDate(post.createdAt)}</span>
                    {post.pinned && <PinIcon size={14} />}
                    {post.editedAt && <span className="text-xs text-neutral-400">изменено</span>}
                  </div>

                  {post.title && (
                    <div className="mt-1 font-semibold text-neutral-900 dark:text-white">{post.title}</div>
                  )}
                  <div className="mt-1 text-sm text-neutral-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                    {post.content}
                  </div>
                  {post.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.cover} alt="" className="mt-2 rounded-xl max-h-96 object-cover w-full" />
                  )}
                  {/* FIX-WALLMEDIA: фото, видео и документы записи. */}
                  <WallMediaView items={post.attachments} />

                  <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <MessagesIcon size={13} style={{ color: "inherit" }} />
                      {post.commentCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <InfoIcon size={13} style={{ color: "inherit" }} />
                      {post.views}
                    </span>
                    {post.canEdit && (
                      <button type="button" onClick={() => togglePin(post)} className="flex items-center gap-1 hover:text-indigo-500">
                        <PinIcon size={13} />
                        {post.pinned ? "Открепить" : "Закрепить"}
                      </button>
                    )}
                    {post.canDelete && (
                      <button type="button" onClick={() => removePost(post.id)} className="flex items-center gap-1 hover:text-red-500">
                        <TrashIcon size={13} />
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <WallPager
            page={postPage}
            pages={postPages}
            total={postTotal}
            unit="записей"
            busy={busy}
            onChange={(p) => loadWall(head.id, p)}
          />
        </div>
      )}

      {tab !== "wall" && (
        <div className="space-y-2">
          {people.length === 0 && (
            <Card>
              <div className="text-sm text-neutral-500 dark:text-gray-400 text-center py-6">
                {tab === "followers" ? "Подписчиков пока нет." : "Подписок пока нет."}
              </div>
            </Card>
          )}

          {people.map((person) => (
            <div
              key={person.id}
              className="flex items-center gap-3 rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/60 p-3"
            >
              <GlowAvatar user={person} size={40} />
              <Link href={`/profile/${person.username}`} className="flex-1 min-w-0">
                <div className="text-sm font-medium text-neutral-900 dark:text-white truncate">{person.name}</div>
                <div className="text-xs text-neutral-500 dark:text-gray-400">@{person.username}</div>
              </Link>
              {!person.isSelf && person.isFollowing && (
                <span className="text-xs text-neutral-400">Вы подписаны</span>
              )}
            </div>
          ))}

          <WallPager
            page={peoplePage}
            pages={peoplePages}
            total={tab === "followers" ? followers : following}
            unit="человек"
            busy={busy}
            onChange={(p) => loadPeople(head.id, tab, p)}
          />
        </div>
      )}
    </div>
  );
}
