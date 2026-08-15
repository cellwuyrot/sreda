"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import WallPager from "@/components/profile/WallPager";
import {
  BookOpenIcon,
  ClockIcon,
  CrownIcon,
  FriendsIcon,
  InfoIcon,
  MessagesIcon,
  NewsIcon,
  PinIcon,
  ShieldIcon,
  StarIcon,
  UserPlusIcon,
  UsersIcon,
} from "@/components/ui/ConnectIcons";
import { TrashIcon } from "@/components/ui/ConnectIconsExtra";

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

interface WallPost {
  id: string;
  title: string;
  content: string;
  cover: string | null;
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

type Tab = "wall" | "followers" | "following";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Администратор",
  EDITOR: "Редактор",
  CONSULTANT: "Партнёр",
};

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

export default function ProfilePage({ username }: { username?: string }) {
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

  /* Шапка тянется из уже существующего публичного профиля, а не из нового адреса:
     там уже учтены настройки приватности, бейджи и статус активности. Второй
     источник тех же данных рано или поздно разошёлся бы с первым. */
  useEffect(() => {
    if (!target) return;
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

  async function submitPost() {
    if (!head || sending) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      const res = await fetch(`/api/wall/${head.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title: draftTitle.trim() || undefined }),
      });
      if (!res.ok) return;
      setDraft("");
      setDraftTitle("");
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

  const roleLabel = ROLE_LABEL[head.role];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* Шапка */}
      <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/60">
        <div
          className="h-32 bg-gradient-to-r from-indigo-500/30 to-fuchsia-500/30"
          style={
            head.profileBanner
              ? { backgroundImage: `url(${head.profileBanner})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
        <div className="p-4 pt-0">
          <div className="flex items-end gap-4 -mt-10">
            <GlowAvatar user={head} size={80} />
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-white truncate">{head.name}</h1>
                {head.role === "ADMIN" && <CrownIcon size={18} />}
                {head.role === "EDITOR" && <ShieldIcon size={18} />}
                {roleLabel && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300">
                    {roleLabel}
                  </span>
                )}
              </div>
              <div className="text-sm text-neutral-500 dark:text-gray-400">@{head.username}</div>
            </div>

            {!head.isSelf && (
              <button
                type="button"
                onClick={toggleFollow}
                disabled={followBusy}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                  isFollowing
                    ? "border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
              >
                <UserPlusIcon size={16} style={{ color: "inherit" }} />
                {isFollowing ? "Вы подписаны" : "Подписаться"}
              </button>
            )}
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
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={sending || !draft.trim()}
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
