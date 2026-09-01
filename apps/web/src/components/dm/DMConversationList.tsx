"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { VaultIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS: SVG вместо favorite.png
import { confirmDialog, alertDialog } from "@/components/ui/ConfirmDialog";
import {
  ARCHIVE_EVENT,
  addToArchive,
  archiveFileName,
  downloadJson,
  lastActivityAt,
  readArchive,
  removeFromArchive,
  type ArchiveKind,
} from "@/lib/localArchive";
import type { Conversation } from "./dmTypes";

interface DMConversationListProps {
  conversations: Conversation[];
  selectedConv: string | null;
  currentUserId: string;
  onSelect: (convId: string) => void;
  /** FIX-VAULT: открыть/создать «Сейф» — переписку с самим собой */
  onOpenVault?: () => void;
  onClose?: () => void;
  /**
   * Название раздела. Панель одна на личные сообщения и на деловые обращения,
   * а называться «Личные сообщения» в разделе «Бизнес» она не должна: это не
   * переписка с приятелем, а разговор с администрацией по заявке.
   */
  title?: string;
  /** Что написать, когда разговоров нет: в разных разделах это разное. */
  emptyText?: string;
  /**
   * ARCHIVE: раздел, к которому относится список. Архивы личных и деловых
   * разговоров хранятся раздельно — иначе убранная из «Сообщений» переписка
   * пропала бы и из «Бизнес чата», где это совсем другая история.
   */
  archiveKind?: ArchiveKind;
  /**
   * ARCHIVE: разговор уничтожен безвозвратно. Панель должна выбросить его из
   * своего состояния и закрыть, если он был открыт, — иначе на экране останется
   * переписка, которой на сервере уже нет.
   */
  onPurged?: (convId: string) => void;
}

// FIX-DM-FAV: избранные диалоги (ПКМ → «В избранное»). Храним на клиенте —
// список id переписок, закреплённых вверху выдачи. Максимум пять.
const FAVORITES_KEY = "tz-dm-favorites";
const MAX_FAVORITES = 5;

/* DM-FOLDERS: папки для личных сообщений.

   Сортировка по папкам — личное дело владельца списка и собеседника никак не
   касается, поэтому раскладка живёт рядом с избранным и архивом — на устройстве,
   без обращений к серверу. Разделы (личные / деловые) хранятся порознь: папка
   «Работа» из одного раздела в другом не имеет смысла. */
const FOLDERS_KEY = "tz-dm-folders";
const MAX_FOLDERS = 12;
const FOLDER_NAME_MAX = 24;

interface DmFolder {
  id: string;
  name: string;
  /** Какие разговоры сложены в папку. Один разговор — не больше одной папки. */
  convIds: string[];
}

function foldersKey(kind: ArchiveKind): string {
  return `${FOLDERS_KEY}:${kind}`;
}

function readFolders(kind: ArchiveKind): DmFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(foldersKey(kind));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is DmFolder =>
        !!item && typeof item === "object" &&
        typeof (item as DmFolder).id === "string" &&
        typeof (item as DmFolder).name === "string")
      .map((item) => ({
        id: item.id,
        name: item.name.slice(0, FOLDER_NAME_MAX),
        convIds: Array.isArray(item.convIds)
          ? item.convIds.filter((x): x is string => typeof x === "string")
          : [],
      }))
      .slice(0, MAX_FOLDERS);
  } catch {
    return [];
  }
}

function writeFolders(kind: ArchiveKind, list: DmFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(foldersKey(kind), JSON.stringify(list));
  } catch {
    /* хранилище недоступно — раскладка просто не доживёт до следующего запуска */
  }
}

// FIX-DM-SORT: направление ранжирования (см. convTime).
//
// Порядок перевёрнут по сравнению с прежней правкой: наверху теперь то, где
// разговор шёл последним. Предыдущее правило («кто написал раньше, тот выше»)
// на практике оказалось нечитаемым: активная переписка уезжала в конец списка,
// а сверху годами висели заброшенные диалоги, и найти вчерашний разговор можно
// было только прокруткой до самого низа.
const NEWEST_FIRST = true;

function readFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_FAVORITES)
      : [];
  } catch {
    return [];
  }
}

/**
 * Момент, по которому диалог занимает место в списке, — последнее взаимодействие.
 *
 * Прежняя правка брала здесь `createdAt` — начало переписки. При восходящем
 * порядке это держало место собеседника неподвижным, но ценой того, что самый
 * свежий разговор мог оказаться где угодно в списке: порядок никак не следовал
 * из того, что человек видит на экране.
 *
 * Теперь правило одно и для чатов, и для проектов: выше тот, где что-то
 * происходило позже всего. Отметка начала остаётся запасным вариантом для
 * переписок, где ещё не было ни одного сообщения: только что заведённый диалог
 * должен быть на виду, а не в хвосте. 0 — отметок нет вовсе.
 */
function convTime(conv: Conversation): number {
  return lastActivityAt(conv.lastMessageAt, conv.createdAt);
}

export default function DMConversationList({
  conversations,
  selectedConv,
  currentUserId,
  onSelect,
  onOpenVault,
  onClose,
  title = "Личные сообщения",
  emptyText = "Нет диалогов",
  archiveKind = "dm",
  onPurged,
}: DMConversationListProps) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ convId: string; x: number; y: number } | null>(null);
  /* ARCHIVE: список убранных с этого устройства разговоров и режим просмотра
     архива. Архив всегда можно открыть и вернуть запись обратно: скрытие без
     возврата воспринимается как потеря данных. */
  const [archived, setArchived] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  /* Идёт выгрузка или удаление — чтобы повторное нажатие не запускало вторую
     ту же работу: выгрузка годовой переписки заметно не мгновенна. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /* DM-FOLDERS: сами папки, свёрнутые из них, меню раздела и меню папки,
     а также строка ввода имени (создание или переименование). */
  const [folders, setFolders] = useState<DmFolder[]>([]);
  const [closedFolders, setClosedFolders] = useState<string[]>([]);
  /* DM-MOBILE-FOLDERS: active folder pill on mobile. null = show all. */
  const [mobileFolderFilter, setMobileFolderFilter] = useState<string | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<
    { mode: "create"; convId?: string; value: string } |
    { mode: "rename"; folderId: string; value: string } |
    null
  >(null);

  /* Папки читаются после появления списка и при смене раздела. */
  useEffect(() => {
    setFolders(readFolders(archiveKind));
    setDraft(null);
  }, [archiveKind]);

  const persistFolders = useCallback((next: DmFolder[]) => {
    setFolders(next);
    writeFolders(archiveKind, next);
  }, [archiveKind]);

  /** Создать папку; если задан convId — сразу положить в неё разговор. */
  const createFolder = useCallback((name: string, convId?: string) => {
    const clean = name.trim().slice(0, FOLDER_NAME_MAX);
    if (!clean || folders.length >= MAX_FOLDERS) return;
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const next = folders.map((f) => (
      convId ? { ...f, convIds: f.convIds.filter((x) => x !== convId) } : f
    ));
    persistFolders([...next, { id, name: clean, convIds: convId ? [convId] : [] }]);
  }, [folders, persistFolders]);

  const renameFolder = useCallback((folderId: string, name: string) => {
    const clean = name.trim().slice(0, FOLDER_NAME_MAX);
    if (!clean) return;
    persistFolders(folders.map((f) => (f.id === folderId ? { ...f, name: clean } : f)));
  }, [folders, persistFolders]);

  /** Удаление папки не трогает переписки: они возвращаются в общий список. */
  const deleteFolder = useCallback((folderId: string) => {
    persistFolders(folders.filter((f) => f.id !== folderId));
  }, [folders, persistFolders]);

  /** Перенос разговора: folderId === null — вернуть в общий список. */
  const moveToFolder = useCallback((convId: string, folderId: string | null) => {
    setMenu(null);
    persistFolders(folders.map((f) => {
      const without = f.convIds.filter((x) => x !== convId);
      return f.id === folderId ? { ...f, convIds: [...without, convId] } : { ...f, convIds: without };
    }));
  }, [folders, persistFolders]);

  const toggleFolder = useCallback((folderId: string) => {
    setClosedFolders((prev) => (
      prev.includes(folderId) ? prev.filter((x) => x !== folderId) : [...prev, folderId]
    ));
  }, []);

  // Load persisted favorites once on mount (client only).
  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  /* ARCHIVE: архив читается при появлении списка и обновляется по событию:
     тот же разговор может быть убран из другого места интерфейса. */
  useEffect(() => {
    const sync = () => setArchived(readArchive(archiveKind));
    sync();
    window.addEventListener(ARCHIVE_EVENT, sync);
    return () => window.removeEventListener(ARCHIVE_EVENT, sync);
  }, [archiveKind]);

  const persistFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — избранное просто не сохранится между сессиями */
    }
  }, []);

  const isFavorite = useCallback((convId: string) => favorites.includes(convId), [favorites]);

  const toggleFavorite = useCallback((convId: string) => {
    setMenu(null);
    if (favorites.includes(convId)) {
      persistFavorites(favorites.filter((id) => id !== convId));
    } else if (favorites.length < MAX_FAVORITES) {
      persistFavorites([...favorites, convId]);
    }
    // При достижении лимита добавление молча игнорируется (см. подпись в меню).
  }, [favorites, persistFavorites]);

  /**
   * ARCHIVE: «В архив» — скачать переписку файлом и убрать её из списка.
   *
   * Порядок именно такой и не другой: сначала копия на диске, потом скрытие.
   * Если выгрузка не удалась, разговор остаётся на месте — человек не должен
   * обнаружить, что чат из списка пропал, а файла так и не появилось.
   */
  const archiveConv = useCallback(async (conv: Conversation) => {
    setMenu(null);
    setBusyId(conv.id);
    try {
      const res = await fetch(`/api/dm/${conv.id}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alertDialog(data.error || "Не удалось выгрузить переписку");
        return;
      }
      const data = await res.json();
      downloadJson(archiveFileName("чат", conv.other.name), data);
      addToArchive(archiveKind, conv.id);
    } catch {
      await alertDialog("Сеть недоступна: переписка не выгружена и осталась в списке");
    } finally {
      setBusyId(null);
    }
  }, [archiveKind]);

  /** ARCHIVE: вернуть разговор в активный список. Скачанный файл никуда не девается. */
  const unarchiveConv = useCallback((convId: string) => {
    setMenu(null);
    removeFromArchive(archiveKind, convId);
  }, [archiveKind]);

  /**
   * ARCHIVE: безвозвратное удаление — у обоих участников, вместе с вложениями.
   *
   * Подтверждение обязательно называет последствия своими именами: пункт стоит
   * рядом с архивом, а последствия у них прямо противоположные, и ошибка здесь
   * необратима.
   */
  const purgeConv = useCallback(async (conv: Conversation) => {
    setMenu(null);
    const ok = await confirmDialog({
      message:
        `Удалить переписку с «${conv.other.name}» безвозвратно?\n\n` +
        "Сообщения и вложения исчезнут у обоих участников и восстановлению не подлежат. " +
        "Если переписка нужна вам самим — сначала сохраните её в архив.",
      confirmText: "Удалить навсегда",
      danger: true,
    });
    if (!ok) return;
    setBusyId(conv.id);
    try {
      const res = await fetch(`/api/dm/${conv.id}/purge`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alertDialog(data.error || "Не удалось удалить переписку");
        return;
      }
      /* Убираем из местного архива и избранного: иначе в хранилище накапливаются
         идентификаторы несуществующих разговоров. */
      removeFromArchive(archiveKind, conv.id);
      if (favorites.includes(conv.id)) {
        persistFavorites(favorites.filter((id) => id !== conv.id));
      }
      onPurged?.(conv.id);
    } catch {
      await alertDialog("Сеть недоступна: переписка не удалена");
    } finally {
      setBusyId(null);
    }
  }, [archiveKind, favorites, persistFavorites, onPurged]);

  // Close the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /* DM-FOLDERS: те же правила закрытия, что и у меню разговора. */
  useEffect(() => {
    if (!sectionMenu && !folderMenu) return;
    const close = () => { setSectionMenu(null); setFolderMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [sectionMenu, folderMenu]);

  // FIX-DM-SORT + FIX-DM-FAV + ARCHIVE: порядок выдачи.
  //   0) Архивированные в обычном режиме вообще не показываются, а в режиме
  //      архива — показываются только они. Смешивать их бессмысленно: архив затем
  //      и нужен, чтобы список стал короче.
  //   1) «Сейф» (переписка с собой) — всегда самый верх.
  //   2) Избранные диалоги — закреплены следующими.
  //   3) Остальные — по последнему взаимодействию, свежие сверху.
  //      Внутри избранных — тот же порядок.
  const ordered = useMemo(() => {
    const favSet = new Set(favorites);
    const archivedSet = new Set(archived);
    const rank = (conv: Conversation) => {
      if (conv.other.id === currentUserId) return 0; // Vault
      if (favSet.has(conv.id)) return 1;             // favorite
      return 2;                                       // regular
    };
    return conversations
      .filter((conv) => (showArchived ? archivedSet.has(conv.id) : !archivedSet.has(conv.id)))
      .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Внутри одного уровня — по началу переписки. Без сообщений — вниз
      // своего уровня независимо от направления сортировки.
      const ta = convTime(a);
      const tb = convTime(b);
      if (ta === 0 && tb === 0) return 0;
      if (ta === 0) return 1;
      if (tb === 0) return -1;
      return NEWEST_FIRST ? tb - ta : ta - tb;
    });
  }, [conversations, favorites, archived, showArchived, currentUserId]);

  const menuConv = menu ? conversations.find((c) => c.id === menu.convId) ?? null : null;
  const menuIsFav = menu ? isFavorite(menu.convId) : false;
  const menuArchived = menu ? archived.includes(menu.convId) : false;
  const favLimitReached = favorites.length >= MAX_FAVORITES;
  const folderMenuFolder = folderMenu ? folders.find((f) => f.id === folderMenu.folderId) ?? null : null;

  /* DM-FOLDERS: строка ввода имени папки. Отдельного окна здесь не надо:
     имя короткое, и ввод уместен там же, где появится сама папка. */
  const folderInput = draft ? (
    <input
      autoFocus
      value={draft.value}
      maxLength={FOLDER_NAME_MAX}
      placeholder="Название папки"
      onChange={(e) => setDraft({ ...draft, value: e.target.value })}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setDraft(null); return; }
        if (e.key !== "Enter") return;
        if (draft.mode === "create") createFolder(draft.value, draft.convId);
        else renameFolder(draft.folderId, draft.value);
        setDraft(null);
      }}
      className="w-full rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-white outline-none focus:border-[var(--cn-accent)]"
    />
  ) : null;

  /* Разговор → папка, в которой он лежит. */
  const folderOf = useMemo(() => {
    const map = new Map<string, string>();
    folders.forEach((f) => f.convIds.forEach((id) => map.set(id, f.id)));
    return map;
  }, [folders]);

  /* Всё, что ни в одной папке не лежит, остаётся в общем списке как раньше. */
  const looseConvs = useMemo(
    () => ordered.filter((conv) => !folderOf.has(conv.id)),
    [ordered, folderOf],
  );

  /* DM-MOBILE-FOLDERS: filter convs by active pill folder */
  const mobileFiltered = useMemo(() => {
    if (!mobileFolderFilter) return ordered;
    const folder = folders.find((f) => f.id === mobileFolderFilter);
    if (!folder) return ordered;
    return ordered.filter((conv) => folder.convIds.includes(conv.id));
  }, [ordered, mobileFolderFilter, folders]);

  /* DM-FOLDERS: одна строка списка. Вынесена из разметки, потому что теперь
     рисуется в двух местах: внутри папки и в общем списке. */
  /* В какой папке лежит разговор, по которому открыто контекстное меню. */
  const menuFolderId = menu ? folderOf.get(menu.convId) ?? null : null;

  const renderConv = (conv: Conversation) => {
            const hasUnread = (conv.unread ?? 0) > 0;
            const isVault = conv.other.id === currentUserId;
            const favorite = !isVault && isFavorite(conv.id);
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                onContextMenu={(e) => {
                  if (isVault) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ convId: conv.id, x: e.clientX, y: e.clientY });
                }}
                className={`w-full text-left p-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors ${
                  selectedConv === conv.id
                    ? "bg-[var(--cn-accent-dim)] border-l-2 border-[var(--cn-accent)]"
                    : ""
                }`}
              >
                <div className="relative flex-shrink-0">
                  {isVault ? (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-400/15 text-amber-500 dark:text-amber-400">
                      <VaultIcon size={22} style={{ color: "inherit" }} />
                    </div>
                  ) : (
                    <GlowAvatar
                      user={conv.other}
                      size={36}
                      onlineColor={isOnline(conv.other.lastSeen) ? "green" : undefined}
                    />
                  )}
                  {/* FIX-DM-FAV: звёздочка на закреплённом диалоге */}
                  {favorite && (
                    <span
                      className="absolute -bottom-1 -left-1 w-4 h-4 flex items-center justify-center rounded-full bg-amber-400 text-amber-950 ring-2 ring-[var(--cn-sidebar)]"
                      title="В избранном"
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
                      </svg>
                    </span>
                  )}
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-[var(--cn-sidebar)]">
                      {conv.unread! > 99 ? "99+" : conv.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate flex items-center gap-1.5 ${hasUnread ? "font-bold text-neutral-900 dark:text-white" : "font-medium text-neutral-900 dark:text-white"}`}>
                    <span className="truncate">{isVault ? "Сейф" : conv.other.name}</span>
                    {/* Связка для администрации: заявку ещё никто не взял. Это
                        единственное состояние очереди, требующее действия, —
                        только его и показываем прямо в списке. */}
                    {conv.business?.party === "handler" && !conv.business.handlerName && (
                      <span className="flex-shrink-0 rounded px-1.5 py-[1px] text-[10px] font-medium bg-amber-400/20 text-amber-600 dark:text-amber-300">
                        не взято
                      </span>
                    )}
                  </p>
                  {/* FIX-VAULTPW: Список диалогов лежит СНАРУЖИ Сейфа и виден всем, кто
                      смотрит на экран, включая тех, кто пароля не знает. Строка превью сводила
                      всю затею на нет: замок спрашивал пароль, а последнюю заметку было видно
                      без него. Поэтому текст здесь не показывается вовсе — и после разблокировки
                      тоже: разблокировка открывает Сейф, а не выкладывает его содержимое в сторонний
                      список. То же с защищённым чатом: там в базе лежит шифртекст, и показывать
                      «e2ee:…» как текст сообщения бессмысленно. */}
                  {isVault || conv.secure ? (
                    <p className="text-xs truncate text-neutral-400 italic">
                      {conv.lastMessage
                        ? isVault
                          ? "Скрыто — откройте по паролю"
                          : "Зашифрованное сообщение"
                        : "Нет сообщений"}
                    </p>
                  ) : conv.lastMessage ? (
                    <p className={`text-xs truncate ${hasUnread ? "text-neutral-700 dark:text-gray-200 font-medium" : "text-neutral-400"}`}>
                      {conv.lastMessage.userId === currentUserId ? "Вы: " : ""}
                      {conv.lastMessage.content}
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-400">Нет сообщений</p>
                  )}
                </div>
                {conv.lastMessageAt && (
                  <span className="text-[10px] text-neutral-400 flex-shrink-0">
                    {timeAgo(conv.lastMessageAt)}
                  </span>
                )}
              </button>
            );
  };


  return (
    <aside
      className={`w-60 max-md:w-full cn-sidebar flex-shrink-0 flex flex-col ${selectedConv ? "max-md:hidden" : ""}`}
    >
      {/* DM-FOLDERS: ПКМ по заголовку раздела — единственное место, где заводятся
          папки: класть постоянную кнопку в шапку ради редкого действия не стоит. */}
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu(null);
          setFolderMenu(null);
          setSectionMenu({ x: e.clientX, y: e.clientY });
        }}
        className="p-3 border-b border-neutral-200 dark:border-white/5 flex items-center justify-between"
      >
        <h2 className="font-bold text-neutral-900 dark:text-white text-sm">
          {showArchived ? `${title} · архив` : title}
        </h2>
        <div className="flex items-center gap-1">
        {/* ARCHIVE: переключатель архива. Появляется только когда архив не пуст:
            кнопка, открывающая гарантированно пустой список, — шум в заголовке. */}
        {(archived.length > 0 || showArchived) && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`p-1 transition-colors ${
              showArchived
                ? "text-[var(--cn-accent)]"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
            }`}
            title={showArchived ? "Вернуться к активным" : `Архив (${archived.length})`}
            aria-label={showArchived ? "Вернуться к активным разговорам" : "Открыть архив"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>
        )}
        {/* FIX-VAULT: кнопка создания/открытия Сейфа */}
        {onOpenVault && (
          <button
            onClick={onOpenVault}
            className="p-1 text-neutral-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
            title="Сейф — избранная переписка с самим собой"
            aria-label="Открыть Сейф"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-7a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2zm10-11V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
            aria-label="Закрыть"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        </div>
      </div>
      {/* DM-MOBILE-FOLDERS: horizontal pill bar, shown only when there are folders */}
      {folders.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 border-b border-neutral-100 dark:border-white/5 scrollbar-none">
          <button
            type="button"
            onClick={() => setMobileFolderFilter(null)}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mobileFolderFilter === null ? "bg-[var(--cn-accent)] text-white" : "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-200 dark:hover:bg-white/15"}`}
          >
            Все
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setMobileFolderFilter(mobileFolderFilter === folder.id ? null : folder.id)}
              className={`flex-shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mobileFolderFilter === folder.id ? "bg-[var(--cn-accent)] text-white" : "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-gray-300 hover:bg-neutral-200 dark:hover:bg-white/15"}`}
            >
              <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
              <span className="truncate max-w-[72px]">{folder.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {draft && draft.mode === "create" && (
          <div className="px-3 py-2">{folderInput}</div>
        )}
        {ordered.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8 px-4 leading-relaxed">
            {showArchived ? "В архиве пусто" : emptyText}
          </p>
        ) : (
          <>
          {mobileFolderFilter
            ? mobileFiltered.map(renderConv)
            : (
          <>
            {/* DM-FOLDERS: сначала папки с их содержимым, потом всё остальное.
                Пустая папка тоже видна: иначе только что созданная папка пропадала бы
                с экрана и положить в неё чат было бы некуда. */}
            {folders.map((folder) => {
              const inside = ordered.filter((conv) => folderOf.get(conv.id) === folder.id);
              const open = !closedFolders.includes(folder.id);
              return (
                <div key={folder.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFolder(folder.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleFolder(folder.id); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu(null);
                      setSectionMenu(null);
                      setFolderMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                    }}
                    className="w-full cursor-pointer select-none px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
                    title="Нажмите, чтобы свернуть. ПКМ — переименовать или удалить папку"
                  >
                    <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto tabular-nums">{inside.length}</span>
                  </div>
                  {draft && draft.mode === "rename" && draft.folderId === folder.id && (
                    <div className="px-3 pb-2">{folderInput}</div>
                  )}
                  {open && inside.length === 0 && (
                    <p className="px-3 pb-2 text-[11px] text-neutral-400">
                      Пусто. ПКМ по чату → «В папку».
                    </p>
                  )}
                  {open && inside.map(renderConv)}
                </div>
              );
            })}
            {looseConvs.map(renderConv)}
          </>
            )}
          </>
        )}
      </div>

      {/* FIX-DM-FAV: контекстное меню по правой кнопке мыши (ПКМ) */}
      {menu && menuConv && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] min-w-[210px] py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl text-sm"
          style={{
            left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 230),
            top: menu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          role="menu"
        >
          <div className="px-3 py-1.5 text-[11px] text-neutral-400 truncate border-b border-neutral-100 dark:border-white/5">
            {menuConv.other.name}
          </div>
          {menuIsFav ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => toggleFavorite(menu.convId)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            >
              <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
              Убрать из избранного
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={favLimitReached}
              onClick={() => toggleFavorite(menu.convId)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                favLimitReached
                  ? "text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
                  : "text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
              title={favLimitReached ? `Максимум ${MAX_FAVORITES} избранных диалогов` : undefined}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
              В избранное
            </button>
          )}
          {favLimitReached && !menuIsFav && (
            <div className="px-3 py-1.5 text-[11px] text-neutral-400">
              Достигнут лимит: {MAX_FAVORITES} диалога
            </div>
          )}

          {/* DM-FOLDERS: раскладка по папкам — перетаскивание мышью заменено выбором
              из меню: попасть по узкой строке папки с зажатой кнопкой сложнее,
              чем выбрать название из списка, а результат один и тот же. */}
          <div className="my-1 border-t border-neutral-100 dark:border-white/5" />
          <div className="px-3 py-1 text-[11px] text-neutral-400">Папки</div>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="menuitem"
              onClick={() => moveToFolder(menu.convId, folder.id)}
              disabled={menuFolderId === folder.id}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                menuFolderId === folder.id
                  ? "text-neutral-300 dark:text-neutral-600 cursor-default"
                  : "text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
              <span className="truncate">{folder.name}</span>
              {menuFolderId === folder.id && <span className="ml-auto text-[10px]">здесь</span>}
            </button>
          ))}
          {menuFolderId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => moveToFolder(menu.convId, null)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              Вынуть из папки
            </button>
          )}
          {folders.length < MAX_FOLDERS && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const convId = menu.convId;
                setMenu(null);
                setDraft({ mode: "create", convId, value: "" });
              }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" /></svg>
              Новая папка с этим чатом
            </button>
          )}

          {/* ARCHIVE: выгрузка на устройство и безвозвратное удаление. */}
          <div className="my-1 border-t border-neutral-100 dark:border-white/5" />
          {menuArchived ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => unarchiveConv(menu.convId)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.3 5.3M4 15a8 8 0 0013.7 3.7" /></svg>
              Вернуть из архива
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={busyId === menu.convId}
              onClick={() => archiveConv(menuConv)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                busyId === menu.convId
                  ? "text-neutral-300 dark:text-neutral-600 cursor-wait"
                  : "text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
              title="Скачать переписку файлом и убрать её из списка"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
              {busyId === menu.convId ? "Выгружаем…" : "В архив (скачать файл)"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={busyId === menu.convId}
            onClick={() => purgeConv(menuConv)}
            className="w-full text-left px-3 py-2 flex items-center gap-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
            title="Стереть переписку у обоих участников"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" /></svg>
            Удалить безвозвратно
          </button>
        </div>,
        document.body,
      )}
      {/* DM-FOLDERS: меню раздела — только создание папки. */}
      {sectionMenu && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] min-w-[200px] py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl text-sm"
          style={{
            left: Math.min(sectionMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220),
            top: sectionMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            disabled={folders.length >= MAX_FOLDERS}
            onClick={() => {
              setSectionMenu(null);
              setDraft({ mode: "create", value: "" });
            }}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
              folders.length >= MAX_FOLDERS
                ? "text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
                : "text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            }`}
            title={folders.length >= MAX_FOLDERS ? `Максимум ${MAX_FOLDERS} папок` : undefined}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm9 3v6m-3-3h6" /></svg>
            Создать папку
          </button>
          <div className="px-3 py-1.5 text-[11px] text-neutral-400">
            {folders.length > 0
              ? "Чтобы положить чат в папку — ПКМ по чату"
              : "Папки видны только вам и только на этом устройстве"}
          </div>
        </div>,
        document.body,
      )}

      {/* DM-FOLDERS: меню самой папки — переименование и удаление. */}
      {folderMenu && folderMenuFolder && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] min-w-[200px] py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl text-sm"
          style={{
            left: Math.min(folderMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220),
            top: folderMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          role="menu"
        >
          <div className="px-3 py-1.5 text-[11px] text-neutral-400 truncate border-b border-neutral-100 dark:border-white/5">
            {folderMenuFolder.name}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderId = folderMenuFolder.id;
              setFolderMenu(null);
              setDraft({ mode: "rename", folderId, value: folderMenuFolder.name });
            }}
            className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5h6M4 20h4l10-10-4-4L4 16v4z" /></svg>
            Переименовать
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderId = folderMenuFolder.id;
              setFolderMenu(null);
              deleteFolder(folderId);
            }}
            className="w-full text-left px-3 py-2 flex items-center gap-2 text-red-500 hover:bg-red-500/10"
            title="Переписки останутся на месте — вернутся в общий список"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" /></svg>
            Удалить папку
          </button>
        </div>,
        document.body,
      )}
    </aside>
  );
}
