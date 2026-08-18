"use client";

import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP
import { io } from "socket.io-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnyCard,
  CardType,
  CARD_WIDTH,
  CARD_MIN_WIDTH,
  CARD_MAX_WIDTH,
  CARD_MIN_HEIGHT,
  CARD_MAX_HEIGHT,
  cardWidth,
  cardInputs,
  cardOutputs,
  ChannelTaskDTO,
  channelTaskToCard,
  DocumentCard,
  DrawingCard,
  Edge,
  edgeFromPort,
  edgeToPort,
  ImageCard,
  LinkCard,
  NodeColor,
  NODE_COLORS,
  NODE_COLOR_ORDER,
  nodeAccent,
  NoteCard,
  portOffsetY,
  PriorityFilter,
  PRIORITY_META,
  PRIORITY_ORDER,
  SortKey,
  StatusFilter,
  STATUS_META,
  STATUS_ORDER,
  TableCard,
  TaskCard,
  taskProgress,
  emptyGrid,
  newId,
} from "./types";
import { CardBody } from "./cards";
import { Picker, ToolGroup, ToolMenu } from "./ui";
import { fileToDataUrl } from "./image";
import { baseName, fileToDocumentFields, docKindFromFile, DOCUMENT_ACCEPT } from "./document";
import { isSpreadsheetFile, readSpreadsheetFile, SPREADSHEET_ACCEPT } from "./table";
/* TZartstation: полотно по умолчанию для новой карточки-изображения. */
import { DEFAULT_SCENE, defaultLayers } from "@/lib/tzart";
/* WS-MERGE: слияние правок при живой синхронизации — чистая часть в lib. */
import { diffDirtyIds, mergeBoards, type MergeableBoard } from "@/lib/workspaceMerge";
/* WS-ASSETS: разбор вложений и подстановка адреса — чистая часть в lib. */
import { cardsToLift, parseDataUrl, withAssetUrl, type AssetCardLike } from "@/lib/workspaceAssets";
import Minimap from "./Minimap";
import ShortcutsHelp from "./ShortcutsHelp";
import ImportTasksPanel from "./ImportTasksPanel";
import DocumentReader from "./DocumentReader";
import TableEditor from "./TableEditor";
import DrawingEditor from "@/components/ui/DrawingEditor";
import TZartstationEditor from "./TZartstationEditor";
/* REMIND: колокольчик в шапке карточки. TPL: заготовки досок. */
import ReminderButton from "./ReminderButton";
import TemplatesPanel from "./TemplatesPanel";
import { instantiateTemplate, isBoardEmpty, type BoardTemplate } from "@/lib/boardTemplates";
import { reminderTitle } from "@/lib/reminders";
import BoardSwitcher from "./BoardSwitcher";
import BoardInboxListener, { boardItemToNoteText } from "./BoardInboxListener";
import ImageLightbox from "@/components/ui/ImageLightbox";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  DocumentIcon,
  FilterIcon,
  FrameIcon,
  GridIcon,
  ImageIcon,
  InboxIcon,
  LinkIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ResetIcon,
  SearchIcon,
  SortIcon,
  TableIcon,
  TaskIcon,
  TrashIcon,
  UndoIcon,
  UploadIcon,
} from "./icons";

type CSS = React.CSSProperties;

/* Persistence */

interface TimerState {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

/**
 * One named working canvas ("рабочий холст"). The user can keep up to
 * MAX_BOARDS of these; each has its own nodes, links and camera position.
 */
interface Board {
  id: string;
  name: string;
  cards: AnyCard[];
  edges: Edge[];
  view: View;
}

/**
 * v2 was a single board stored flat ({cards, edges, view, timer}); v3 wraps one
 * or more named boards. The loader migrates v2 payloads transparently. The work
 * timer stays global (one clock across all boards).
 */
interface StoredState {
  v: 3;
  boards: Board[];
  activeId: string;
  timer: TimerState;
}

/** Legacy (v2) single-board payload, kept only for migration on load. */
interface LegacyStoredState {
  cards?: AnyCard[];
  edges?: Edge[];
  timer?: TimerState;
  view?: View;
}

const DEFAULT_VIEW: View = { x: 0, y: 0, scale: 1 };
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const PORT_SIZE = 12;
const SNAP_GRID = 22;

/** Maximum number of named working canvases per profile. */
const MAX_BOARDS = 5;

const storageKey = (uid: string) => `tz-workspace-v1:${uid}`;

/** Build a fresh board wrapping the given cards/edges (view reset). */
function makeBoard(name: string, cards: AnyCard[], edges: Edge[]): Board {
  return { id: newId(), name, cards, edges, view: DEFAULT_VIEW };
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function seedState(): { cards: AnyCard[]; edges: Edge[] } {
  const t = Date.now();
  const a: TaskCard = {
    id: newId(),
    type: "task",
    x: 60,
    y: 80,
    z: 1,
    createdAt: t,
    color: "green",
    title: "Настроить рабочую среду",
    tags: ["старт"],
    status: "doing",
    priority: "p2",
    progress: 0,
    deadline: "",
    note: "Перетаскивайте узлы за верхнюю полоску. Потяните от правого порта к другому узлу, чтобы соединить их линией.",
    checklist: [
      { id: newId(), text: "Добавить первую задачу", done: true },
      { id: newId(), text: "Соединить узлы линиями", done: false },
      { id: newId(), text: "Добавить порты и изображение", done: false },
    ],
  };
  const b: NoteCard = {
    id: newId(),
    type: "note",
    x: 470,
    y: 60,
    z: 2,
    createdAt: t + 1,
    color: "blue",
    title: "Заметки",
    tags: [],
    body: "Холст бесконечный: тяните пространство правой кнопкой мыши, масштабируйте колёсиком. Рамка ЛКМ — выделение нескольких узлов.",
  };
  const c: LinkCard = {
    id: newId(),
    type: "link",
    x: 880,
    y: 220,
    z: 3,
    createdAt: t + 2,
    color: "gray",
    title: "Открыть мессенджер",
    tags: [],
    url: "/connect",
    project: "TZ.Connect",
  };
  return {
    cards: [a, b, c],
    edges: [
      { id: newId(), from: a.id, to: b.id },
      { id: newId(), from: b.id, to: c.id },
    ],
  };
}

/* Time helpers */

function fmtClock(d: Date) {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
}
function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/* Geometry helpers */

function bezier(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

const outPortPos = (c: AnyCard, portId: string) => {
  const outs = cardOutputs(c);
  const i = Math.max(0, outs.findIndex((p) => p.id === portId));
  return { x: c.x + cardWidth(c), y: c.y + portOffsetY(i) };
};
const inPortPos = (c: AnyCard, portId: string) => {
  const ins = cardInputs(c);
  const i = Math.max(0, ins.findIndex((p) => p.id === portId));
  return { x: c.x, y: c.y + portOffsetY(i) };
};

/* Node (draggable + connectable, multi-port) */

function CanvasCard({
  card,
  patch,
  selected,
  onDelete,
  onFocus,
  onNodePointerDown,
  onConnectStart,
  onSetColor,
  onRemind,
  onAddPort,
  onRemovePort,
  onResizeStart,
  onResizeReset,
  onOpen,
  linking,
  scale,
}: {
  card: AnyCard;
  patch: (p: Partial<AnyCard>) => void;
  selected: boolean;
  onDelete: () => void;
  onFocus: () => void;
  onNodePointerDown: (id: string, e: React.PointerEvent) => void;
  onConnectStart: (id: string, portId: string, clientX: number, clientY: number) => void;
  onSetColor: (id: string, color: NodeColor) => void;
  /** REMIND: поставить или снять напоминание. null — снять. */
  onRemind: (id: string, remindAt: number | null) => void;
  onAddPort: (id: string, kind: "input" | "output") => void;
  onRemovePort: (id: string, kind: "input" | "output") => void;
  onResizeStart: (id: string, e: React.PointerEvent) => void;
  onResizeReset: (id: string) => void;
  onOpen?: () => void;
  linking: boolean;
  scale: number;
}) {
  const accent = nodeAccent(card);
  const soft = NODE_COLORS[card.color ?? "gray"].soft;
  const inputs = cardInputs(card);
  const outputs = cardOutputs(card);
  const TypeIcon =
    card.type === "task"
      ? TaskIcon
      : card.type === "note"
        ? NoteIcon
        : card.type === "image"
          ? ImageIcon
          : card.type === "document"
            ? DocumentIcon
            : card.type === "table"
              ? TableIcon
              : card.type === "drawing" || card.type === "art"
                ? ImageIcon
                : LinkIcon;
  const typeLabel =
    card.type === "task"
      ? "Задача"
      : card.type === "note"
        ? "Заметка"
        : card.type === "image"
          ? "Изображение"
          : card.type === "document"
            ? "Документ"
            : card.type === "table"
              ? "Таблица"
              : card.type === "drawing"
                ? "Рисунок"
                : card.type === "art"
                  ? "TZartstation"
                  : "Ссылка";

  const sized = card.height != null;
  const containerStyle: CSS = {
    left: card.x,
    top: card.y,
    width: cardWidth(card),
    height: sized ? card.height : undefined,
    zIndex: card.z,
  };
  const cardBoxStyle: CSS = {
    borderLeft: `4px solid ${accent}`,
    boxShadow: selected ? `0 0 0 2px ${accent}` : undefined,
    height: sized ? "100%" : undefined,
  };
  const headerStyle: CSS = { background: soft };

  return (
    <div
      data-node-id={card.id}
      className="absolute select-none"
      style={containerStyle}
      onPointerDownCapture={onFocus}
    >
      {inputs.map((p, i) => {
        const st: CSS = {
          left: -PORT_SIZE / 2,
          top: portOffsetY(i) - PORT_SIZE / 2,
          width: PORT_SIZE,
          height: PORT_SIZE,
          borderColor: accent,
          transform: linking ? "scale(1.3)" : "scale(1)",
        };
        return (
          <div
            key={p.id}
            data-node-id={card.id}
            data-port-id={p.id}
            data-port-kind="input"
            title={p.label ?? "Вход"}
            className="absolute z-10 rounded-full border-2 bg-white transition-transform dark:bg-neutral-900"
            style={st}
          />
        );
      })}

      {outputs.map((p, i) => {
        const st: CSS = {
          right: -PORT_SIZE / 2,
          top: portOffsetY(i) - PORT_SIZE / 2,
          width: PORT_SIZE,
          height: PORT_SIZE,
          background: accent,
        };
        return (
          <div
            key={p.id}
            data-node-id={card.id}
            data-port-id={p.id}
            data-port-kind="output"
            title={p.label ?? "Выход · потяните к другому узлу"}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              onConnectStart(card.id, p.id, e.clientX, e.clientY);
            }}
            className="absolute z-10 cursor-crosshair rounded-full border-2 border-white transition-transform hover:scale-125 dark:border-neutral-900"
            style={st}
          />
        );
      })}

      <div
        className={`flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm shadow-black/[0.04] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20 ${
          sized ? "h-full" : ""
        }`}
        style={cardBoxStyle}
      >
        <div
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onNodePointerDown(card.id, e);
          }}
          className="flex cursor-grab items-center gap-2 border-b border-neutral-100 px-3 py-1.5 active:cursor-grabbing dark:border-neutral-800"
          style={headerStyle}
        >
          <TypeIcon size={14} className="text-neutral-400 dark:text-neutral-500" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            {typeLabel}
          </span>

          <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            {/* REMIND: колокольчик стоит у всех видов карточек — вернуться
                нужно не только к задаче. */}
            <ReminderButton
              remindAt={card.remindAt}
              onChange={(remindAt) => onRemind(card.id, remindAt)}
            />
            <span className="mx-0.5 h-3 w-px bg-neutral-200 dark:bg-neutral-700" aria-hidden />
            {NODE_COLOR_ORDER.map((col) => {
              const active = (card.color ?? "gray") === col;
              const dotStyle: CSS = {
                background: NODE_COLORS[col].accent,
                outline: active ? "1.5px solid rgba(0,0,0,0.4)" : "none",
                outlineOffset: "1px",
              };
              return (
                <button
                  key={col}
                  type="button"
                  onClick={() => onSetColor(card.id, col)}
                  title={NODE_COLORS[col].label}
                  aria-label={`Цвет: ${NODE_COLORS[col].label}`}
                  className="h-3 w-3 rounded-full transition-transform hover:scale-110"
                  style={dotStyle}
                />
              );
            })}
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            className="ml-1 text-neutral-300 transition-colors hover:text-neutral-900 dark:text-neutral-600 dark:hover:text-white"
            aria-label="Удалить узел"
          >
            <TrashIcon size={14} />
          </button>
        </div>

        <div className={`px-3.5 pb-3.5 pt-2.5 ${sized ? "min-h-0 flex-1 overflow-auto" : ""}`}>
          <CardBody card={card} patch={patch} onOpen={onOpen} scale={scale} />
        </div>

        <div
          className="flex items-center justify-between border-t border-neutral-100 px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <span>Входы</span>
            <button
              type="button"
              onClick={() => onAddPort(card.id, "input")}
              className="flex h-4 w-4 items-center justify-center rounded border border-neutral-200 hover:border-neutral-500 dark:border-neutral-700"
              title="Добавить вход"
            >
              <PlusIcon size={9} />
            </button>
            <button
              type="button"
              onClick={() => onRemovePort(card.id, "input")}
              disabled={inputs.length <= 1}
              className="flex h-4 w-4 items-center justify-center rounded border border-neutral-200 hover:border-neutral-500 disabled:opacity-30 dark:border-neutral-700"
              title="Убрать вход"
            >
              −
            </button>
            <span className="tabular-nums">{inputs.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="tabular-nums">{outputs.length}</span>
            <button
              type="button"
              onClick={() => onRemovePort(card.id, "output")}
              disabled={outputs.length <= 1}
              className="flex h-4 w-4 items-center justify-center rounded border border-neutral-200 hover:border-neutral-500 disabled:opacity-30 dark:border-neutral-700"
              title="Убрать выход"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => onAddPort(card.id, "output")}
              className="flex h-4 w-4 items-center justify-center rounded border border-neutral-200 hover:border-neutral-500 dark:border-neutral-700"
              title="Добавить выход"
            >
              <PlusIcon size={9} />
            </button>
            <span>Выходы</span>
          </div>
        </div>
      </div>

      {/* Resize handle (bottom-right). Drag to size the node; double-click to
          reset it back to the automatic default size. */}
      <div
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          onResizeStart(card.id, e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onResizeReset(card.id);
        }}
        title="Потяните, чтобы изменить размер · двойной клик — сбросить"
        className="group/resize absolute -bottom-1 -right-1 z-20 flex h-5 w-5 cursor-nwse-resize items-end justify-end"
      >
        <span className="h-3 w-3 rounded-br-[7px] border-b-2 border-r-2 border-neutral-300 transition-colors group-hover/resize:border-neutral-500 dark:border-neutral-600 dark:group-hover/resize:border-neutral-400" />
      </div>
    </div>
  );
}

/* Toolbar button */

function ToolButton({
  onClick,
  children,
  title,
  active,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600"
      }`}
    >
      {children}
    </button>
  );
}

/* Filters block — collapses status/priority/sort/tidy into one popover */

function FiltersPopover({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  sortKey,
  setSortKey,
  onTidy,
  onReset,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  priorityFilter: PriorityFilter;
  setPriorityFilter: (v: PriorityFilter) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  onTidy: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = (statusFilter !== "all" ? 1 : 0) + (priorityFilter !== "all" ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5
          text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400
          dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600"
        title="Фильтры и сортировка"
      >
        <FilterIcon size={14} />
        <span>Фильтр</span>
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-semibold text-white dark:bg-white dark:text-neutral-950">
            {activeCount}
          </span>
        )}
        <ChevronDownIcon size={12} className="opacity-60" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-40 mt-1 w-64 space-y-3 rounded-xl border border-neutral-200 bg-white p-3
            shadow-xl shadow-black/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40"
        >
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Статус
            </span>
            <Picker<StatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "Все" },
                ...STATUS_ORDER.map((s) => ({ value: s as StatusFilter, label: STATUS_META[s].label })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Приоритет
            </span>
            <Picker<PriorityFilter>
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[
                { value: "all", label: "Любой" },
                ...PRIORITY_ORDER.map((p) => ({ value: p as PriorityFilter, label: PRIORITY_META[p].label })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Сортировка
            </span>
            <Picker<SortKey>
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: "priority", label: "Приоритет" },
                { value: "deadline", label: "Дедлайн" },
                { value: "status", label: "Статус" },
                { value: "progress", label: "Прогресс" },
                { value: "created", label: "Дата создания" },
                { value: "title", label: "Название" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <button
              type="button"
              onClick={onTidy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-2.5 py-1.5
                text-xs font-medium text-white transition-colors hover:bg-neutral-700
                dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              <SortIcon size={14} /> Упорядочить
            </button>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600
                  transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Main */

/**
 * GROUP-WORKSPACE: групповой режим общей рабочей среды.
 * Когда передан `remote`, холсты грузятся/сохраняются по указанным URL канала,
 * а синхронизация идёт по комнате канала (join-channel + channel-workspace-updated)
 * вместо личной комнаты пользователя. `embedded` встраивает среду в колонку
 * (без полноэкранной высоты и ссылки «в /connect»); read-only включается
 * автоматически, если сервер вернул canEdit=false.
 */
interface RemoteWorkspace {
  channelId: string;
  loadUrl: string;
  saveUrl: string;
}

export default function WorkspaceCanvas({
  userId,
  userName,
  remote,
  embedded = false,
  title,
  subtitle,
  onBack,
  headerActions,
}: {
  userId: string;
  userName: string;
  remote?: RemoteWorkspace;
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  headerActions?: React.ReactNode;
}) {
  const [cards, setCards] = useState<AnyCard[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [timer, setTimer] = useState<TimerState>({ running: false, startedAt: null, accumulatedMs: 0 });
  const [loaded, setLoaded] = useState(false);

  // GROUP-WORKSPACE: право на редактирование приходит с сервера (canEdit).
  // В личном режиме всегда true; в групповом — зависит от прав модуля.
  const [canEdit, setCanEdit] = useState(true);
  const readOnly = !!remote && !canEdit;
  /* WS-ASSETS: карточки, вложение которых загрузить не удалось. Вторая попытка
     на каждое движение мыши превратила бы сбой сети в поток запросов. */
  const liftFailedRef = useRef<Set<string>>(new Set());
  /* WS-HISTORY: список снимков для меню «История». Личная среда: у общего
     холста возврат появится следующим шагом, снимки для него уже пишутся. */
  const [snapshots, setSnapshots] = useState<{ id: string; createdAt: string; size: number }[]>([]);

  /* WS-MERGE: последнее состояние, о котором знают обе стороны, — то, что мы
     отправили или получили. По разнице с ним видно, что человек успел изменить
     и что нельзя затирать чужим снимком. */
  const lastSyncedRef = useRef<MergeableBoard[]>([]);
  /* Собрать текущее состояние из обработчика сокета. Через ссылку, а не через
     зависимость: иначе соединение пересоздавалось бы при каждой правке. */
  const commitRef = useRef<() => Board[]>(() => []);
  const loadUrl = remote?.loadUrl ?? "/api/workspace";
  const saveUrl = remote?.saveUrl ?? "/api/workspace";
  const lsKey = remote ? `tz-ws-channel:${remote.channelId}` : storageKey(userId);

  // Named working canvases. `cards`/`edges`/`view` above are the live state of
  // the board identified by `activeId`; the other boards are held in `boards`.
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  const [query, setQuery] = useState("");
  /* MOBILE-FIX: раскрывающаяся панель инструментов на телефоне (см. шапку). */
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [importOpen, setImportOpen] = useState(false);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  // FIX-DRAW: прежний узел «Рисунок» — открывается в старом редакторе рисунков.
  const [openDrawingId, setOpenDrawingId] = useState<string | null>(null);
  /* TZartstation: карточка, открытая в редакторе изображений. */
  const [openArtId, setOpenArtId] = useState<string | null>(null);
  /* TPL: панель заготовок доски. */
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [snap, setSnap] = useState(false);
  const [notice, setNotice] = useState("");

  const [now, setNow] = useState(() => Date.now());
  const topZ = useRef(1);
  const topCardId = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const tableInputRef = useRef<HTMLInputElement>(null);

  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });

  const viewRef = useRef(view);
  const cardsRef = useRef(cards);
  const edgesRef = useRef(edges);
  const boardsRef = useRef(boards);
  const activeIdRef = useRef(activeId);
  const snapRef = useRef(snap);
  const spaceRef = useRef(false);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; moving: Array<{ id: string; ox: number; oy: number }> } | null>(null);
  const resizeRef = useRef<{ id: string; sx: number; sy: number; ow: number; oh: number } | null>(null);
  const connectRef = useRef<{ from: string; port: string } | null>(null);
  const selRef = useRef<{ sx: number; sy: number; bl: number; bt: number; add: boolean; base: Set<string> } | null>(null);

  const [connectFrom, setConnectFrom] = useState<{ id: string; port: string } | null>(null);
  const [connectPos, setConnectPos] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRef = useRef(selected);
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Undo/redo history of { cards, edges } snapshots (immutable arrays).
  const pastRef = useRef<Array<{ cards: AnyCard[]; edges: Edge[] }>>([]);
  const futureRef = useRef<Array<{ cards: AnyCard[]; edges: Edge[] }>>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastEditRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });

  // /workspace синхронизируется через сервер (см. /api/workspace):
  // serverSaveTimer дебаунсит запись, clientIdRef отсеивает эхо своих же сохранений.
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientIdRef = useRef("ws-" + Math.random().toString(36).slice(2));
  // GROUP-WORKSPACE: не сохраняем состояние, только что применённое из загрузки
  // или чужой правки — иначе два открытых клиента зациклили бы взаимные записи.
  const skipNextSaveRef = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const beginHistory = useCallback(() => {
    pastRef.current.push({ cards: cardsRef.current, edges: edgesRef.current });
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    futureRef.current.push({ cards: cardsRef.current, edges: edgesRef.current });
    const prev = past.pop()!;
    setCards(prev.cards);
    setEdges(prev.edges);
    setCanUndo(past.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const fut = futureRef.current;
    if (!fut.length) return;
    pastRef.current.push({ cards: cardsRef.current, edges: edgesRef.current });
    const next = fut.pop()!;
    setCards(next.cards);
    setEdges(next.edges);
    setCanRedo(fut.length > 0);
    setCanUndo(true);
  }, []);

  const snapVal = useCallback((n: number) => (snapRef.current ? Math.round(n / SNAP_GRID) * SNAP_GRID : Math.round(n)), []);

  /** Load a board's data into the live working state and reset per-board session
   *  bits (history, selection, camera-independent refs, open editors). */
  const hydrateBoard = useCallback((b: Board) => {
    setCards(b.cards);
    setEdges(b.edges);
    setView(b.view ?? DEFAULT_VIEW);
    pastRef.current = [];
    futureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setSelected(new Set());
    connectRef.current = null;
    setConnectFrom(null);
    setConnectPos(null);
    topZ.current = Math.max(1, ...b.cards.map((c) => c.z || 1));
    topCardId.current = null;
    setOpenDocId(null);
    setOpenImageId(null);
    setOpenTableId(null);
  }, []);

  /** Snapshot the live working state back into the active board entry. */
  const commitActiveBoards = useCallback((): Board[] => {
    const aid = activeIdRef.current;
    return boardsRef.current.map((b) =>
      b.id === aid ? { ...b, cards: cardsRef.current, edges: edgesRef.current, view: viewRef.current } : b,
    );
  }, []);

  const switchBoard = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      const merged = commitActiveBoards();
      const target = merged.find((b) => b.id === id);
      if (!target) return;
      setBoards(merged);
      setActiveId(id);
      hydrateBoard(target);
    },
    [commitActiveBoards, hydrateBoard],
  );

  const createBoard = useCallback(() => {
    const merged = commitActiveBoards();
    if (merged.length >= MAX_BOARDS) {
      setNotice(`Достигнут лимит: до ${MAX_BOARDS} холстов.`);
      return;
    }
    const board = makeBoard(`Холст ${merged.length + 1}`, [], []);
    setBoards([...merged, board]);
    setActiveId(board.id);
    hydrateBoard(board);
  }, [commitActiveBoards, hydrateBoard]);

  const renameBoard = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    setBoards((bs) => bs.map((b) => (b.id === id ? { ...b, name: trimmed || b.name } : b)));
  }, []);

  const deleteBoard = useCallback(
    (id: string) => {
      const merged = commitActiveBoards();
      if (merged.length <= 1) {
        setNotice("Нельзя удалить последний холст.");
        return;
      }
      const remaining = merged.filter((b) => b.id !== id);
      setBoards(remaining);
      if (activeIdRef.current === id) {
        const next = remaining[0];
        setActiveId(next.id);
        hydrateBoard(next);
      }
    },
    [commitActiveBoards, hydrateBoard],
  );

  // Применение прочитанного состояния (из сервера или localStorage) к холстам.
  // Вынесено из load-эффекта, чтобы переиспользовать при живой синхронизации.
  const applyStored = useCallback((stored: StoredState | LegacyStoredState | null) => {
    let nextBoards: Board[];
    let nextActive: string;
    let nextTimer: TimerState = { running: false, startedAt: null, accumulatedMs: 0 };
    try {
      const parsed = stored;
      if (parsed && "v" in parsed && parsed.v === 3 && Array.isArray(parsed.boards) && parsed.boards.length) {
        nextBoards = parsed.boards.map((b) => ({
          id: b.id || newId(),
          name: b.name || "Холст",
          cards: b.cards ?? [],
          edges: b.edges ?? [],
          view: b.view ?? DEFAULT_VIEW,
        }));
        nextActive = nextBoards.some((b) => b.id === parsed.activeId) ? parsed.activeId : nextBoards[0].id;
        nextTimer = parsed.timer ?? nextTimer;
      } else if (parsed && "cards" in parsed && Array.isArray(parsed.cards)) {
        // Migrate a v2 single-board payload into the first named board.
        nextBoards = [{ id: newId(), name: "Холст 1", cards: parsed.cards, edges: parsed.edges ?? [], view: parsed.view ?? DEFAULT_VIEW }];
        nextActive = nextBoards[0].id;
        nextTimer = parsed.timer ?? nextTimer;
      } else {
        const seeded = seedState();
        nextBoards = [makeBoard("Холст 1", seeded.cards, seeded.edges)];
        nextActive = nextBoards[0].id;
      }
    } catch {
      const seeded = seedState();
      nextBoards = [makeBoard("Холст 1", seeded.cards, seeded.edges)];
      nextActive = nextBoards[0].id;
    }
    const active = nextBoards.find((b) => b.id === nextActive) ?? nextBoards[0];
    setBoards(nextBoards);
    setActiveId(active.id);
    setCards(active.cards);
    setEdges(active.edges);
    setView(active.view ?? DEFAULT_VIEW);
    setTimer(nextTimer);
    topZ.current = Math.max(1, ...active.cards.map((c) => c.z || 1));
    /* WS-MERGE: с этого снимка начинается отсчёт «что я изменил после». */
    lastSyncedRef.current = nextBoards as unknown as MergeableBoard[];
    setLoaded(true);
  }, []);

  // Загрузка: сначала сервер (общий для веба и десктопа), при недоступности — localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored: StoredState | LegacyStoredState | null = null;
      try {
        const res = await fetch(loadUrl, { cache: "no-store" });
        if (res.ok) {
          const payload = await res.json();
          if (remote && typeof payload?.canEdit === "boolean") setCanEdit(payload.canEdit);
          if (payload && typeof payload.data === "string") {
            stored = JSON.parse(payload.data) as StoredState;
          }
        }
      } catch {
        /* сервер недоступен — офлайн-фолбэк ниже */
      }
      if (!stored) {
        try {
          const raw = localStorage.getItem(lsKey);
          if (raw) stored = JSON.parse(raw) as StoredState;
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        skipNextSaveRef.current = true;
        applyStored(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUrl, lsKey, remote, applyStored]);

  // Сохранение: localStorage — быстрый локальный кэш, сервер — источник истины (дебаунс 1.2 с)
  useEffect(() => {
    if (!loaded) return;
    // Применённое из загрузки/синхронизации состояние не пишем обратно.
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const payload: StoredState = { v: 3, boards: commitActiveBoards(), activeId, timer };
    const json = JSON.stringify(payload);
    try {
      localStorage.setItem(lsKey, json);
    } catch {
      /* ignore (e.g. quota exceeded) */
    }
    // read-only участники не сохраняют на сервер (сервер тоже отклонит запись).
    if (readOnly) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(() => {
      fetch(saveUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: json, clientId: clientIdRef.current }),
      })
        .then((res) => {
          /* WS-MERGE: отправленное стало общим знанием — от него и считаем
             следующие правки. Только при успехе: после отказа сервер о наших
             изменениях не знает, и терять их при чужом снимке нельзя. */
          if (res.ok) lastSyncedRef.current = payload.boards as unknown as MergeableBoard[];
        })
        .catch(() => {});
    }, 1200);
  }, [cards, edges, view, timer, boards, activeId, loaded, lsKey, saveUrl, readOnly, commitActiveBoards]);

  /**
   * WS-ASSETS: вложения уезжают в файловое хранилище, а в карточке остаётся адрес.
   *
   * Картинки, PDF и рисунки приходят в карточку строкой `data:` — то есть
   * байтами внутри состояния среды. А состояние целиком лежит одной строкой в
   * базе, и на сервере у него предел 2 МБ: обычная фотография с телефона в
   * таком виде занимает около двух мегабайт и переполняет среду целиком. Дальше
   * не сохраняется НИЧЕГО — ни заметки, ни задачи, — и человеку об этом никто не
   * говорит. Плюс при каждой правке всё состояние с картинкой внутри улетает на
   * сервер заново.
   *
   * Поэтому: увидели байты — отправили в хранилище, подставили адрес. Отдельным
   * действием, а не внутри сохранения: сохранение должно оставаться быстрым и
   * не зависеть от сети, а переезд — вещь разовая для каждой карточки.
   *
   * Что при сбое: карточка остаётся со своей строкой и продолжает работать.
   * Повторно её не дёргаем — иначе неудачная загрузка превратилась бы в попытку
   * при каждом движении мыши.
   *
   * Карточки других холстов переедут, когда их откроют: здесь видны только
   * карточки текущего.
   */
  useEffect(() => {
    if (!loaded || readOnly) return;
    const pending = cardsToLift(cards as AssetCardLike[]).filter((card) => !liftFailedRef.current.has(card.id));
    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const card of pending) {
        const parsed = parseDataUrl(card.src);
        if (!parsed) {
          /* Не наш тип или слишком большой файл — оставляем как есть, но больше
             не пытаемся: ответ не изменится. */
          liftFailedRef.current.add(card.id);
          continue;
        }
        try {
          const binary = Uint8Array.from(atob(parsed.base64), (ch) => ch.charCodeAt(0));
          const form = new FormData();
          form.append("file", new Blob([binary], { type: parsed.mime }), `asset.${parsed.ext}`);
          if (remote?.channelId) form.append("channelId", remote.channelId);

          const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { url?: string };
          if (cancelled || !data.url) throw new Error("нет адреса");

          setCards((prev) => prev.map((c) => (c.id === card.id ? withAssetUrl(c, data.url as string) : c)));
        } catch {
          liftFailedRef.current.add(card.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cards, loaded, readOnly, remote]);

  /* WS-HISTORY: список снимков. Загружаем один раз при открытии среды и после
     возврата: он меняется раз в десять минут, опрашивать чаще незачем. */
  const loadSnapshots = useCallback(async () => {
    if (remote) return; // возврат у общего холста — следующим шагом
    try {
      const res = await fetch("/api/workspace/history", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body?.snapshots)) setSnapshots(body.snapshots);
    } catch {
      /* история недоступна — просто не показываем список */
    }
  }, [remote]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  /**
   * Вернуть состояние из снимка.
   *
   * Спрашиваем подтверждение: возврат меняет весь холст, а не одну карточку.
   * Само состояние перечитается по событию с сервера — там же, где приходят
   * правки с других устройств, поэтому отдельного применения тут нет.
   */
  const restoreSnapshot = useCallback(
    async (id: string, when: string) => {
      if (!window.confirm(`Вернуть рабочую среду к состоянию на ${when}? Текущее будет сохранено в истории.`)) return;
      try {
        const res = await fetch("/api/workspace/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) return;
        await loadSnapshots();
      } catch {
        /* сеть отвалилась — состояние не тронуто */
      }
    },
    [loadSnapshots],
  );

  /* WS-MERGE: держим ссылку на текущий сборщик состояния для обработчика
     сокета. Именно в эффекте: запись ссылки во время отрисовки — обращение к
     значению, которого в этот момент ещё может не быть. */
  useEffect(() => {
    commitRef.current = commitActiveBoards;
  }, [commitActiveBoards]);

  // Если состояние изменилось (на другом устройстве или у другого участника) —
  // подтягиваем его сразу. Личный режим слушает свою dm-комнату, групповой —
  // комнату канала.
  useEffect(() => {
    const socket = io({ path: "/api/socketio", withCredentials: true });
    const evt = remote ? "channel-workspace-updated" : "workspace-updated";
    socket.on("connect", () => {
      if (remote) socket.emit("join-channel", { channelId: remote.channelId });
      else socket.emit("join-dm", userId);
    });
    socket.on(evt, async (payload: { clientId?: string | null }) => {
      if (payload && payload.clientId === clientIdRef.current) return; // наше же сохранение
      try {
        const res = await fetch(loadUrl, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (remote && typeof body?.canEdit === "boolean") setCanEdit(body.canEdit);
        if (body && typeof body.data === "string") {
          const incoming = JSON.parse(body.data) as StoredState;
          // Не «перетаскиваем» соавтора на чужой холст: если его текущий холст
          // ещё существует в свежем состоянии — оставляем активным именно его.
          if (
            remote && incoming && incoming.v === 3 && Array.isArray(incoming.boards) &&
            incoming.boards.some((b) => b.id === activeIdRef.current)
          ) {
            incoming.activeId = activeIdRef.current;
          }
          /* WS-MERGE: пришедший снимок — основа, но мои свежие правки поверх
             него сохраняются. Раньше здесь стояла простая замена, и всё, что
             человек успел сделать за последние секунды, исчезало без следа:
             на общем холсте — при каждом сохранении соседа. */
          if (incoming && incoming.v === 3 && Array.isArray(incoming.boards)) {
            const local = commitRef.current() as unknown as MergeableBoard[];
            const dirty = diffDirtyIds(lastSyncedRef.current, local);
            if (dirty.size > 0) {
              incoming.boards = mergeBoards(
                incoming.boards as unknown as MergeableBoard[],
                local,
                dirty,
              ) as unknown as Board[];
            }
          }
          skipNextSaveRef.current = true;
          applyStored(incoming);
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [userId, remote, loadUrl, applyStored]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => setBoardSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const worldFromScreen = useCallback((cx: number, cy: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    const sx = cx - (rect?.left ?? 0);
    const sy = cy - (rect?.top ?? 0);
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  }, []);

  const viewportCenter = useCallback(() => {
    const rect = boardRef.current?.getBoundingClientRect();
    return worldFromScreen(
      (rect?.left ?? 0) + (rect?.width ?? 900) / 2,
      (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    );
  }, [worldFromScreen]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = board.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = clampScale(v.scale * factor);
      const wx = (sx - v.x) / v.scale;
      const wy = (sy - v.y) / v.scale;
      setView({ x: sx - wx * scale, y: sy - wy * scale, scale });
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [loaded]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (panRef.current) {
        const p = panRef.current;
        setView((v) => ({ ...v, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
      } else if (dragRef.current) {
        const d = dragRef.current;
        const scale = viewRef.current.scale;
        const dx = (e.clientX - d.sx) / scale;
        const dy = (e.clientY - d.sy) / scale;
        setCards((cs) =>
          cs.map((c) => {
            const m = d.moving.find((mm) => mm.id === c.id);
            return m ? ({ ...c, x: snapVal(m.ox + dx), y: snapVal(m.oy + dy) } as AnyCard) : c;
          }),
        );
      } else if (resizeRef.current) {
        const r = resizeRef.current;
        const scale = viewRef.current.scale;
        const w = clamp(Math.round(r.ow + (e.clientX - r.sx) / scale), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
        const h = clamp(Math.round(r.oh + (e.clientY - r.sy) / scale), CARD_MIN_HEIGHT, CARD_MAX_HEIGHT);
        setCards((cs) => cs.map((c) => (c.id === r.id ? ({ ...c, width: w, height: h } as AnyCard) : c)));
      } else if (connectRef.current) {
        setConnectPos(worldFromScreen(e.clientX, e.clientY));
      } else if (selRef.current) {
        const s = selRef.current;
        const x1 = Math.min(s.sx, e.clientX);
        const y1 = Math.min(s.sy, e.clientY);
        const x2 = Math.max(s.sx, e.clientX);
        const y2 = Math.max(s.sy, e.clientY);
        setSelRect({ x: x1 - s.bl, y: y1 - s.bt, w: x2 - x1, h: y2 - y1 });
        const found = new Set<string>(s.add ? Array.from(s.base) : []);
        boardRef.current?.querySelectorAll("[data-node-id]:not([data-port-id])").forEach((el) => {
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) {
            const id = el.getAttribute("data-node-id");
            if (id) found.add(id);
          }
        });
        setSelected(found);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (connectRef.current) {
        const { from, port } = connectRef.current;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const portEl = el?.closest('[data-port-kind="input"]') as HTMLElement | null;
        let to: string | null = null;
        let toPort: string | undefined;
        if (portEl) {
          to = portEl.getAttribute("data-node-id");
          toPort = portEl.getAttribute("data-port-id") ?? undefined;
        } else {
          const nodeEl = el?.closest("[data-node-id]") as HTMLElement | null;
          if (nodeEl) {
            to = nodeEl.getAttribute("data-node-id");
            const tc = cardsRef.current.find((c) => c.id === to);
            toPort = tc ? cardInputs(tc)[0].id : undefined;
          }
        }
        if (to && to !== from) {
          const tp = toPort ?? "in";
          const dup = edgesRef.current.some(
            (x) => x.from === from && edgeFromPort(x) === port && x.to === to && edgeToPort(x) === tp,
          );
          if (!dup) {
            beginHistory();
            setEdges((es) => [...es, { id: newId(), from, fromPort: port, to: to!, toPort: tp }]);
          }
        }
        connectRef.current = null;
        setConnectFrom(null);
        setConnectPos(null);
      }
      if (selRef.current) {
        selRef.current = null;
        setSelRect(null);
      }
      panRef.current = null;
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [worldFromScreen, beginHistory, snapVal]);

  const onBoardPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const onNode = !!target.closest("[data-node-id]");
    if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceRef.current)) {
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
      return;
    }
    if (e.button === 0 && !onNode) {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!e.shiftKey) setSelected(new Set());
      selRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        bl: rect?.left ?? 0,
        bt: rect?.top ?? 0,
        add: e.shiftKey,
        base: new Set(e.shiftKey ? selectedRef.current : []),
      };
      setSelRect({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), w: 0, h: 0 });
    }
  }, []);

  const patchCard = useCallback(
    (id: string, p: Partial<AnyCard>) => {
      const t = Date.now();
      const le = lastEditRef.current;
      if (!(le.id === id && t - le.t < 600)) beginHistory();
      lastEditRef.current = { id, t };
      setCards((cs) => cs.map((c) => (c.id === id ? ({ ...c, ...p } as AnyCard) : c)));
    },
    [beginHistory],
  );

  const deleteCard = useCallback(
    (id: string) => {
      beginHistory();
      setCards((cs) => cs.filter((c) => c.id !== id));
      setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    },
    [beginHistory],
  );

  const deleteSelected = useCallback(() => {
    const sel = selectedRef.current;
    if (!sel.size) return;
    beginHistory();
    setCards((cs) => cs.filter((c) => !sel.has(c.id)));
    setEdges((es) => es.filter((e) => !sel.has(e.from) && !sel.has(e.to)));
    setSelected(new Set());
  }, [beginHistory]);

  const deleteEdge = useCallback(
    (id: string) => {
      beginHistory();
      setEdges((es) => es.filter((e) => e.id !== id));
    },
    [beginHistory],
  );

  const setColor = useCallback(
    (id: string, color: NodeColor) => {
      beginHistory();
      const sel = selectedRef.current;
      const ids = sel.has(id) && sel.size > 1 ? sel : new Set([id]);
      setCards((cs) => cs.map((c) => (ids.has(c.id) ? ({ ...c, color } as AnyCard) : c)));
    },
    [beginHistory],
  );

  const applyColorToSelection = useCallback(
    (color: NodeColor) => {
      const sel = selectedRef.current;
      if (!sel.size) return;
      beginHistory();
      setCards((cs) => cs.map((c) => (sel.has(c.id) ? ({ ...c, color } as AnyCard) : c)));
    },
    [beginHistory],
  );

  const addPort = useCallback(
    (id: string, kind: "input" | "output") => {
      beginHistory();
      setCards((cs) =>
        cs.map((c) => {
          if (c.id !== id) return c;
          if (kind === "input") return { ...c, inputs: [...cardInputs(c), { id: newId() }] } as AnyCard;
          return { ...c, outputs: [...cardOutputs(c), { id: newId() }] } as AnyCard;
        }),
      );
    },
    [beginHistory],
  );

  const removePort = useCallback(
    (id: string, kind: "input" | "output") => {
      const c = cardsRef.current.find((x) => x.id === id);
      if (!c) return;
      const list = kind === "input" ? cardInputs(c) : cardOutputs(c);
      if (list.length <= 1) return;
      const removed = list[list.length - 1].id;
      beginHistory();
      setCards((cs) =>
        cs.map((x) => {
          if (x.id !== id) return x;
          const nl = list.slice(0, -1);
          return kind === "input" ? ({ ...x, inputs: nl } as AnyCard) : ({ ...x, outputs: nl } as AnyCard);
        }),
      );
      setEdges((es) =>
        es.filter((e) =>
          kind === "input"
            ? !(e.to === id && edgeToPort(e) === removed)
            : !(e.from === id && edgeFromPort(e) === removed),
        ),
      );
    },
    [beginHistory],
  );

  const focusCard = useCallback((id: string) => {
    if (topCardId.current === id) return;
    topCardId.current = id;
    topZ.current += 1;
    const z = topZ.current;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, z } : c)));
  }, []);

  /** Begin dragging the bottom-right resize handle of a node. Seeds the drag
   *  with the node's current width/height (measured from the DOM when the
   *  height is still automatic) so the handle tracks the cursor exactly. */
  const startResize = useCallback(
    (id: string, e: React.PointerEvent) => {
      const card = cardsRef.current.find((c) => c.id === id);
      if (!card) return;
      const nodeEl = (e.currentTarget as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
      const ow = cardWidth(card);
      const oh = card.height ?? nodeEl?.offsetHeight ?? CARD_MIN_HEIGHT;
      beginHistory();
      resizeRef.current = { id, sx: e.clientX, sy: e.clientY, ow, oh };
    },
    [beginHistory],
  );

  /** Reset a node back to its automatic default size (clears width & height). */
  const resetSize = useCallback(
    (id: string) => {
      beginHistory();
      setCards((cs) => cs.map((c) => (c.id === id ? ({ ...c, width: undefined, height: undefined } as AnyCard) : c)));
    },
    [beginHistory],
  );

  const onNodePointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      const prevSel = selectedRef.current;
      if (e.shiftKey) {
        const n = new Set(prevSel);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        setSelected(n);
        return;
      }
      const group = prevSel.has(id) && prevSel.size > 1 ? [...prevSel] : [id];
      if (!prevSel.has(id)) setSelected(new Set([id]));
      beginHistory();
      const moving = group
        .map((gid) => {
          const c = cardsRef.current.find((cc) => cc.id === gid);
          return c ? { id: gid, ox: c.x, oy: c.y } : null;
        })
        .filter(Boolean) as Array<{ id: string; ox: number; oy: number }>;
      dragRef.current = { sx: e.clientX, sy: e.clientY, moving };
    },
    [beginHistory],
  );

  const startConnect = useCallback(
    (id: string, portId: string, cx: number, cy: number) => {
      connectRef.current = { from: id, port: portId };
      setConnectFrom({ id, port: portId });
      setConnectPos(worldFromScreen(cx, cy));
    },
    [worldFromScreen],
  );

  const addCard = useCallback(
    (type: CardType) => {
      const center = viewportCenter();
      const x = Math.round(center.x - CARD_WIDTH / 2);
      const y = Math.round(center.y - 40);
      topZ.current += 1;
      beginHistory();
      const common = {
        id: newId(),
        x,
        y,
        z: topZ.current,
        createdAt: Date.now(),
        tags: [] as string[],
        color: "gray" as NodeColor,
      };
      let card: AnyCard;
      if (type === "task") {
        card = { ...common, type: "task", title: "", status: "todo", priority: "p3", progress: 0, deadline: "", checklist: [], note: "" };
      } else if (type === "note") {
        card = { ...common, type: "note", title: "", body: "" };
      } else if (type === "image") {
        card = { ...common, type: "image", title: "", src: "", caption: "" };
      } else if (type === "document") {
        card = { ...common, type: "document", title: "", docKind: "text", fileName: "", text: "", src: "", caption: "" };
      } else if (type === "table") {
        card = { ...common, type: "table", title: "", cells: emptyGrid(3, 3), hasHeader: true };
      } else if (type === "drawing") {
        // FIX-DRAW: узел «Рисунок» — содержимое создаётся во встроенном редакторе.
        card = { ...common, type: "drawing", title: "", src: "", caption: "" };
      } else if (type === "art") {
        /* TZartstation: в карточке лежит сцена, а не картинка, — поэтому всё
           нарисованное остаётся объектом и правится потом. Свой список слоёв у
           каждой карточки: общий массив связал бы соседние доски. */
        card = { ...common, type: "art", title: "", scene: { ...DEFAULT_SCENE, layers: defaultLayers(), shapes: [] }, caption: "" };
      } else {
        card = { ...common, type: "link", title: "", url: "", project: "" };
      }
      setCards((cs) => [...cs, card]);
      return card.id;
    },
    [viewportCenter, beginHistory],
  );

  // Receive messages sent to the board from chat ("Отправить на доску") and drop
  // them onto the canvas as notes, reusing the same placement/history flow.
  const addNoteFromInbox = useCallback(
    (body: string) => {
      const center = viewportCenter();
      const x = Math.round(center.x - CARD_WIDTH / 2);
      const y = Math.round(center.y - 40);
      topZ.current += 1;
      beginHistory();
      const card = {
        id: newId(),
        x,
        y,
        z: topZ.current,
        createdAt: Date.now(),
        tags: [] as string[],
        color: "gray" as NodeColor,
        type: "note",
        title: "",
        body,
      } as AnyCard;
      setCards((cs) => [...cs, card]);
    },
    [viewportCenter, beginHistory],
  );

  const addImageFromFile = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      const src = await fileToDataUrl(file);
      const center = at ?? viewportCenter();
      topZ.current += 1;
      beginHistory();
      const card: ImageCard = {
        id: newId(),
        type: "image",
        x: Math.round(center.x - CARD_WIDTH / 2),
        y: Math.round(center.y - 40),
        z: topZ.current,
        createdAt: Date.now(),
        tags: [],
        color: "gray",
        title: "",
        caption: "",
        src,
      };
      setCards((cs) => [...cs, card]);
    },
    [viewportCenter, beginHistory],
  );

  /**
   * WS-PASTE: вставка из буфера обмена.
   *
   * Самое обычное действие на доске — скопировал картинку и вставил, — до сих
   * пор не работало вовсе: было только «дублировать» внутри холста. Приходилось
   * сохранять картинку в файл и загружать её через выбор файла.
   *
   * Картинка кладётся карточкой. Байты в состоянии не задерживаются: их
   * подхватит перенос вложений в хранилище (см. WS-ASSETS выше) — тем же путём,
   * что и загруженные файлом.
   *
   * Текст кладётся заметкой, ссылка — карточкой ссылки: различаем по виду
   * строки, потому что вставленный адрес в заметке пришлось бы переносить в
   * ссылку руками.
   *
   * Вставку внутри полей ввода не перехватываем: человек, который пишет текст в
   * заметке и вставляет туда строку, не ждёт появления второй карточки.
   */
  useEffect(() => {
    if (!loaded || readOnly) return;

    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const data = e.clipboardData;
      if (!data) return;

      const file = Array.from(data.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .find((f): f is File => !!f);

      if (file) {
        e.preventDefault();
        void addImageFromFile(file);
        return;
      }

      const text = data.getData("text/plain").trim();
      if (!text) return;
      e.preventDefault();

      const isUrl = /^https?:\/\/\S+$/i.test(text) && text.length <= 2000;
      const center = viewportCenter();
      topZ.current += 1;
      beginHistory();
      const common = {
        id: newId(),
        x: Math.round(center.x - CARD_WIDTH / 2),
        y: Math.round(center.y - 40),
        z: topZ.current,
        createdAt: Date.now(),
        tags: [] as string[],
        color: "gray" as NodeColor,
        title: "",
      };
      const card: AnyCard = isUrl
        ? { ...common, type: "link", url: text, project: "" }
        : { ...common, type: "note", body: text.slice(0, 5000) };
      setCards((cs) => [...cs, card]);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loaded, readOnly, addImageFromFile, viewportCenter, beginHistory]);

  const addTableFromFile = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      let grid: string[][];
      try {
        grid = await readSpreadsheetFile(file);
      } catch {
        setNotice("Не удалось прочитать таблицу. Поддерживаются CSV и XLSX.");
        return;
      }
      if (!grid.length) {
        setNotice("Файл таблицы пуст или не распознан.");
        return;
      }
      const center = at ?? viewportCenter();
      topZ.current += 1;
      beginHistory();
      const card: TableCard = {
        id: newId(),
        type: "table",
        x: Math.round(center.x - CARD_WIDTH / 2),
        y: Math.round(center.y - 40),
        z: topZ.current,
        createdAt: Date.now(),
        tags: [],
        color: "gray",
        title: baseName(file.name),
        cells: grid,
        hasHeader: true,
      };
      setCards((cs) => [...cs, card]);
    },
    [viewportCenter, beginHistory],
  );

  const addDocumentFromFile = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      // A spreadsheet dropped/picked as a "document" should still become a
      // table node, not collapse into a plain-text document.
      if (isSpreadsheetFile(file)) {
        await addTableFromFile(file, at);
        return;
      }
      let fields: Pick<DocumentCard, "docKind" | "fileName" | "text" | "src"> | null;
      try {
        fields = await fileToDocumentFields(file);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Не удалось прочитать файл.");
        return;
      }
      if (!fields) {
        setNotice("Неподдерживаемый файл. Выберите PDF, Word (.docx) или текстовый документ.");
        return;
      }
      const center = at ?? viewportCenter();
      topZ.current += 1;
      beginHistory();
      const card: DocumentCard = {
        id: newId(),
        type: "document",
        x: Math.round(center.x - CARD_WIDTH / 2),
        y: Math.round(center.y - 40),
        z: topZ.current,
        createdAt: Date.now(),
        tags: [],
        color: "gray",
        title: baseName(fields.fileName),
        caption: "",
        ...fields,
      };
      setCards((cs) => [...cs, card]);
    },
    [viewportCenter, beginHistory, addTableFromFile],
  );

  /** Create a blank text document and open it in the reader/editor. */
  const addTextDocument = useCallback(() => {
    const id = addCard("document");
    if (id) setOpenDocId(id);
  }, [addCard]);

  /**
   * TZartstation: создать узел с изображением и сразу открыть редактор.
   *
   * Прежний «Рисунок» отсюда больше не создаётся: он писал пиксели и отдавал
   * PNG, в котором ничего нельзя поправить. Уже созданные карточки продолжают
   * открываться в старом редакторе, и на каждой есть перенос сюда.
   */
  const addArt = useCallback(() => {
    const id = addCard("art");
    if (id) setOpenArtId(id);
  }, [addCard]);

  /**
   * REMIND: поставить или снять напоминание на карточке.
   *
   * Время попадает в два места. В карточку — чтобы колокольчик показывал
   * состояние сразу, без запроса, и чтобы оно уехало вместе с доской на другое
   * устройство. На сервер — потому что сработать карточка не может: пока холст
   * закрыт, её JSON никто не читает (см. lib/reminders и обход в server.ts).
   *
   * Сбой сети не отменяет правку на холсте: колокольчик остаётся, а без записи
   * на сервере напоминание просто не прозвонит. Молча уронить всю правку из-за
   * недоступной сети было бы хуже.
   */
  const setReminder = useCallback(
    (id: string, remindAt: number | null) => {
      patchCard(id, { remindAt });
      if (readOnly) return;
      const card = cards.find((c) => c.id === id);
      /* Куда открыть по нажатию на уведомление: личная среда — своя страница,
         общий холст живёт внутри переписки. */
      const link = remote ? "/connect" : "/workspace";
      const request = remindAt
        ? fetch("/api/workspace/reminders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId: id, title: reminderTitle(card?.title), link, remindAt }),
          })
        : fetch("/api/workspace/reminders", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId: id }),
          });
      void request.catch(() => setNotice("Напоминание не сохранилось на сервере"));
    },
    [cards, patchCard, readOnly, remote],
  );

  /**
   * TPL: развернуть заготовку.
   *
   * Только на пустую доску: полтора десятка чужих карточек поверх начатой
   * работы — месиво, разобрать которое нечем. Проверка стоит и здесь, а не
   * только в панели: панель можно открыть на пустом холсте и переключиться.
   */
  const applyTemplate = useCallback(
    (template: BoardTemplate) => {
      if (readOnly) return;
      if (!isBoardEmpty(cards, edges)) {
        setNotice("Заготовка разворачивается только на пустой холст");
        setTemplatesOpen(false);
        return;
      }
      const center = viewportCenter();
      const built = instantiateTemplate(template, newId, { x: center.x - 520, y: center.y - 300 });
      beginHistory();
      setCards(built.cards as unknown as AnyCard[]);
      setEdges(built.edges as Edge[]);
      setTemplatesOpen(false);
      setNotice(`Заготовка «${template.name}» развёрнута`);
    },
    [beginHistory, cards, edges, readOnly, viewportCenter],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const all = Array.from(e.dataTransfer?.files ?? []);
      const images = all.filter((f) => f.type.startsWith("image/"));
      const sheets = all.filter((f) => !f.type.startsWith("image/") && isSpreadsheetFile(f));
      const docs = all.filter(
        (f) => !f.type.startsWith("image/") && !isSpreadsheetFile(f) && docKindFromFile(f) !== null,
      );
      if (!images.length && !sheets.length && !docs.length) return;
      e.preventDefault();
      const at = worldFromScreen(e.clientX, e.clientY);
      // Cascade the drop point so several files don't land exactly on top of
      // one another.
      let k = 0;
      const nextPos = () => {
        const p = { x: at.x + k * 24, y: at.y + k * 24 };
        k += 1;
        return p;
      };
      images.forEach((f) => addImageFromFile(f, nextPos()));
      sheets.forEach((f) => addTableFromFile(f, nextPos()));
      docs.forEach((f) => addDocumentFromFile(f, nextPos()));
    },
    [worldFromScreen, addImageFromFile, addTableFromFile, addDocumentFromFile],
  );

  const duplicateSelected = useCallback(() => {
    const sel = selectedRef.current;
    if (!sel.size) return;
    beginHistory();
    const idMap = new Map<string, string>();
    const clones: AnyCard[] = [];
    for (const c of cardsRef.current) {
      if (!sel.has(c.id)) continue;
      const nid = newId();
      idMap.set(c.id, nid);
      topZ.current += 1;
      clones.push({ ...c, id: nid, x: c.x + 28, y: c.y + 28, z: topZ.current } as AnyCard);
    }
    const addEdges: Edge[] = [];
    for (const e of edgesRef.current) {
      if (idMap.has(e.from) && idMap.has(e.to)) {
        addEdges.push({ id: newId(), from: idMap.get(e.from)!, to: idMap.get(e.to)!, fromPort: e.fromPort, toPort: e.toPort });
      }
    }
    setCards((cs) => [...cs, ...clones]);
    setEdges((es) => [...es, ...addEdges]);
    const newSel = new Set<string>();
    idMap.forEach((v) => newSel.add(v));
    setSelected(newSel);
  }, [beginHistory]);

  const fitView = useCallback((ids?: Set<string>) => {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const v = viewRef.current;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    board.querySelectorAll("[data-node-id]:not([data-port-id])").forEach((el) => {
      const id = el.getAttribute("data-node-id");
      if (ids && id && !ids.has(id)) return;
      const b = (el as HTMLElement).getBoundingClientRect();
      const wx = (b.left - rect.left - v.x) / v.scale;
      const wy = (b.top - rect.top - v.y) / v.scale;
      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx + b.width / v.scale);
      maxY = Math.max(maxY, wy + b.height / v.scale);
    });
    if (!isFinite(minX)) return;
    const pad = 80;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const ns = clampScale(Math.min(rect.width / bw, rect.height / bh));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ x: rect.width / 2 - cx * ns, y: rect.height / 2 - cy * ns, scale: ns });
  }, []);

  const jumpTo = useCallback((world: { x: number; y: number }) => {
    setView((v) => ({ ...v, x: boardSize.w / 2 - world.x * v.scale, y: boardSize.h / 2 - world.y * v.scale }));
  }, [boardSize.w, boardSize.h]);

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) spaceRef.current = true;
      if (isTyping(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && k === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && k === "a") {
        e.preventDefault();
        setSelected(new Set(cardsRef.current.map((c) => c.id)));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        fitView(selectedRef.current.size ? selectedRef.current : undefined);
        return;
      }
      if (e.key === "Escape") {
        setSelected(new Set());
        connectRef.current = null;
        setConnectFrom(null);
        setConnectPos(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, duplicateSelected, deleteSelected, fitView]);

  const importedSourceIds = useMemo(
    () =>
      new Set(
        cards
          .filter((c): c is TaskCard => c.type === "task" && !!c.source)
          .map((c) => c.source!.taskId),
      ),
    [cards],
  );

  const importTasks = useCallback(
    (dtos: ChannelTaskDTO[]) => {
      const center = viewportCenter();
      beginHistory();
      setCards((cs) => {
        const already = new Set(
          cs
            .filter((c): c is TaskCard => c.type === "task" && !!c.source)
            .map((c) => c.source!.taskId),
        );
        const fresh = dtos.filter((dto) => !already.has(dto.id));
        if (fresh.length === 0) return cs;
        const created = fresh.map((dto, i) => {
          topZ.current += 1;
          const step = already.size + i;
          return channelTaskToCard(dto, {
            x: Math.round(center.x - CARD_WIDTH / 2 + step * 28),
            y: Math.round(center.y - 40 + step * 28),
            z: topZ.current,
          });
        });
        return [...cs, ...created];
      });
    },
    [viewportCenter, beginHistory],
  );

  const query_ = query.trim().toLowerCase();
  const matches = useCallback(
    (c: AnyCard): boolean => {
      if (query_) {
        const hay = [
          c.title,
          c.tags.join(" "),
          c.type === "task" ? `${c.note} ${c.checklist.map((i) => i.text).join(" ")}` : "",
          c.type === "note" ? c.body : "",
          c.type === "image" ? c.caption : "",
          c.type === "drawing" ? c.caption : "",
          c.type === "art" ? c.caption : "",
          c.type === "document" ? `${c.fileName} ${c.text} ${c.caption}` : "",
          c.type === "table" ? c.cells.map((r) => r.join(" ")).join(" ") : "",
          c.type === "link" ? `${c.url} ${c.project}` : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(query_)) return false;
      }
      if (c.type === "task") {
        if (statusFilter !== "all" && c.status !== statusFilter) return false;
        if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
      }
      return true;
    },
    [query_, statusFilter, priorityFilter],
  );

  const visibleCards = useMemo(() => cards.filter(matches), [cards, matches]);
  const visibleSet = useMemo(() => new Set(visibleCards.map((c) => c.id)), [visibleCards]);
  const cardById = useMemo(() => {
    const m = new Map<string, AnyCard>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleSet.has(e.from) && visibleSet.has(e.to)),
    [edges, visibleSet],
  );
  const hiddenCount = cards.length - visibleCards.length;

  const openDoc = useMemo<DocumentCard | null>(() => {
    if (!openDocId) return null;
    const c = cards.find((cc) => cc.id === openDocId);
    return c && c.type === "document" ? c : null;
  }, [openDocId, cards]);

  const openImage = useMemo<ImageCard | null>(() => {
    if (!openImageId) return null;
    const c = cards.find((cc) => cc.id === openImageId);
    return c && c.type === "image" && c.src ? c : null;
  }, [openImageId, cards]);

  const openTable = useMemo<TableCard | null>(() => {
    if (!openTableId) return null;
    const c = cards.find((cc) => cc.id === openTableId);
    return c && c.type === "table" ? c : null;
  }, [openTableId, cards]);

  const openDrawing = useMemo<DrawingCard | null>(() => {
    if (!openDrawingId) return null;
    const c = cards.find((cc) => cc.id === openDrawingId);
    return c && c.type === "drawing" ? c : null;
  }, [openDrawingId, cards]);

  /* TZartstation: карточка, открытая в редакторе изображений. */
  const openArt = useMemo(() => {
    if (!openArtId) return null;
    const c = cards.find((cc) => cc.id === openArtId);
    return c && c.type === "art" ? c : null;
  }, [openArtId, cards]);

  const compare = useCallback(
    (a: AnyCard, b: AnyCard): number => {
      const rank = (c: AnyCard) => {
        switch (sortKey) {
          case "priority":
            return c.type === "task" ? PRIORITY_META[c.priority].order : 99;
          case "status":
            return c.type === "task" ? STATUS_META[c.status].order : 99;
          case "progress":
            return c.type === "task" ? -taskProgress(c) : 999;
          case "deadline": {
            if (c.type !== "task" || !c.deadline) return Number.MAX_SAFE_INTEGER;
            return new Date(c.deadline).getTime();
          }
          case "created":
            return c.createdAt;
          case "title":
            return 0;
          default:
            return 0;
        }
      };
      if (sortKey === "title") return a.title.localeCompare(b.title, "ru");
      return rank(a) - rank(b);
    },
    [sortKey],
  );

  const tidyUp = useCallback(() => {
    const gap = 44;
    const startX = 60;
    const startY = 60;
    const cols = 3;
    const colH = new Array(cols).fill(startY);
    const ordered = [...visibleCards].sort(compare);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const c of ordered) {
      let col = 0;
      for (let i = 1; i < cols; i++) if (colH[i] < colH[col]) col = i;
      const x = startX + col * (CARD_WIDTH + gap);
      const y = colH[col];
      positions[c.id] = { x, y };
      const el = boardRef.current?.querySelector(`[data-node-id="${c.id}"]`) as HTMLElement | null;
      const h = el?.offsetHeight ?? 260;
      colH[col] += h + gap;
    }
    beginHistory();
    setCards((cs) => cs.map((c) => (positions[c.id] ? { ...c, x: positions[c.id].x, y: positions[c.id].y } : c)));
    setView(DEFAULT_VIEW);
  }, [visibleCards, compare, beginHistory]);

  const zoomBy = useCallback((factor: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    const sx = (rect?.width ?? 900) / 2;
    const sy = (rect?.height ?? 600) / 2;
    const v = viewRef.current;
    const scale = clampScale(v.scale * factor);
    const wx = (sx - v.x) / v.scale;
    const wy = (sy - v.y) / v.scale;
    setView({ x: sx - wx * scale, y: sy - wy * scale, scale });
  }, []);
  const resetView = useCallback(() => setView(DEFAULT_VIEW), []);

  const elapsedMs = timer.accumulatedMs + (timer.running && timer.startedAt ? now - timer.startedAt : 0);
  const toggleTimer = () =>
    setTimer((t) =>
      t.running
        ? { running: false, startedAt: null, accumulatedMs: t.accumulatedMs + (t.startedAt ? Date.now() - t.startedAt : 0) }
        : { running: true, startedAt: Date.now(), accumulatedMs: t.accumulatedMs },
    );
  const resetTimer = () => setTimer({ running: false, startedAt: null, accumulatedMs: 0 });

  const tasks = cards.filter((c): c is TaskCard => c.type === "task");
  const overall = tasks.length ? Math.round(tasks.reduce((s, t) => s + taskProgress(t), 0) / tasks.length) : 0;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const clock = new Date(now);
  const anyFilter = query_ !== "" || statusFilter !== "all" || priorityFilter !== "all";
  const connectSource = connectFrom ? cardById.get(connectFrom.id) ?? null : null;

  const overallStyle: CSS = { width: `${overall}%` };
  const boardStyle: CSS = { touchAction: "none", cursor: connectFrom ? "crosshair" : "grab" };

  const gridStyle: CSS = {
    backgroundImage: "radial-gradient(circle, rgba(120,120,120,0.18) 1px, transparent 1px)",
    backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
  const worldStyle: CSS = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: "0 0",
    width: 0,
    height: 0,
  };
  const svgStyle: CSS = { width: 1, height: 1, pointerEvents: "none", overflow: "visible" };
  const edgeHitStyle: CSS = { pointerEvents: "stroke", cursor: "pointer" };
  const selRectStyle: CSS = selRect ? { left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h } : {};

  if (!loaded) {
    return <div className={embedded ? "h-full bg-neutral-100 dark:bg-neutral-950" : "min-h-screen bg-neutral-100 dark:bg-neutral-950"} />;
  }

  return (
    <div
      className={`flex flex-col overflow-hidden bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 ${embedded ? "h-full" : "md:h-[calc(100dvh-4rem-var(--tz-desktop-inset-bottom))]"}`}
      /* MOBILE-FIX: вне встроенного режима высота берётся из --tz-app-h
         (innerHeight): в Android WebView 100dvh не пересчитывается при
         клавиатуре и каркас среды разъезжался. */
      style={embedded ? undefined : { height: "var(--tz-app-h, 100dvh)" }}
    >
      {/* MOBILE-FIX: раньше вся шапка была одним flex-wrap рядом из 6+ групп
          инструментов (поиск, фильтры, холст, время, добавить…). На телефоне она
          переносилась в 4–5 строк и съедала весь экран — «сдвинутый интерфейс».
          Теперь на мобильном в шапке только назад/название/поиск/добавить, а
          остальные инструменты — в раскрывающейся панели (кнопка «Инструменты»). */}
      <header className="z-40 shrink-0 border-b border-neutral-200 bg-white/80 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5 md:px-6 max-md:gap-x-2 max-md:px-2 max-md:py-1.5">
          <div className="flex items-center gap-3 max-md:min-w-0 max-md:flex-1 max-md:gap-1.5">
            {onBack ? (
              <button
                onClick={onBack}
                className="text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white max-md:-ml-1 max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center"
                title="Назад"
                aria-label="Назад"
              >
                <ArrowLeftIcon size={20} />
              </button>
            ) : !embedded ? (
              <BackButton
                fallback="/connect"
                className="text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
                title="Назад в TZ.Connect"
              >
                <ArrowLeftIcon size={20} />
              </BackButton>
            ) : null}
            <div className="leading-tight max-md:min-w-0 max-md:flex-1">
              <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight max-md:truncate max-md:text-sm">
                {title ?? "Рабочая среда"}
                {readOnly && (
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
                    Только чтение
                  </span>
                )}
              </h1>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 max-md:hidden">{subtitle ?? userName}</p>
            </div>
            {headerActions}
          </div>

          <div className={mobileToolsOpen ? "max-md:order-3 max-md:w-full" : "max-md:hidden"}>
          <BoardSwitcher
            boards={boards.map((b) => ({ id: b.id, name: b.name }))}
            activeId={activeId}
            max={MAX_BOARDS}
            onSwitch={switchBoard}
            onCreate={createBoard}
            onRename={renameBoard}
            onDelete={deleteBoard}
          />
          </div>

          {/* MOBILE-FIX: кнопка раскрытия панели инструментов (только телефон) */}
          <button
            type="button"
            onClick={() => setMobileToolsOpen((v) => !v)}
            className={`md:hidden inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border transition-colors ${
              mobileToolsOpen
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
                : "border-neutral-200 bg-white text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
            }`}
            aria-label="Инструменты"
            aria-expanded={mobileToolsOpen}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="hidden items-center gap-2 lg:flex">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-neutral-900 dark:bg-white" style={overallStyle} />
            </div>
            <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {doneCount}/{tasks.length} · {overall}%
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 max-md:gap-1.5">
            {/* Block · Поиск */}
            <div className={`flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-900 ${mobileToolsOpen ? "max-md:order-1 max-md:min-h-[44px] max-md:w-full" : "max-md:hidden"}`}>
              <SearchIcon size={14} className="text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск…"
                className="w-24 bg-transparent text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none dark:text-neutral-100 md:w-32 max-md:w-full max-md:text-base"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-neutral-300 transition-colors hover:text-neutral-700 dark:text-neutral-600 dark:hover:text-neutral-300"
                  aria-label="Очистить поиск"
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>

            {/* MOBILE-FIX: фильтры, инструменты холста и таймер — в сворачиваемой
                панели (на десктопе всё как было, в одном ряду). */}
            <div className={`flex flex-wrap items-center gap-2 ${mobileToolsOpen ? "max-md:order-2 max-md:w-full" : "max-md:hidden"}`}>
            {/* Block · Фильтр */}
            <FiltersPopover
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              sortKey={sortKey}
              setSortKey={setSortKey}
              onTidy={tidyUp}
              onReset={() => {
                setStatusFilter("all");
                setPriorityFilter("all");
              }}
            />

            {/* Block · Холст */}
            <ToolGroup label="Холст">
              <ToolButton onClick={undo} title="Отменить (Ctrl+Z)">
                <UndoIcon size={14} className={canUndo ? "" : "opacity-30"} />
              </ToolButton>
              <ToolButton onClick={redo} title="Вернуть (Ctrl+Shift+Z)">
                <RedoIcon size={14} className={canRedo ? "" : "opacity-30"} />
              </ToolButton>
              <ToolButton onClick={() => setSnap((s) => !s)} active={snap} title="Привязка к сетке">
                <GridIcon size={14} />
              </ToolButton>
              <ToolButton
                onClick={() => fitView(selectedRef.current.size ? selectedRef.current : undefined)}
                title="Показать всё (F)"
              >
                <FrameIcon size={14} />
              </ToolButton>
            </ToolGroup>

            {/* Block · Время */}
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 dark:border-neutral-800 dark:bg-neutral-900">
              <ClockIcon size={15} className="text-neutral-400 dark:text-neutral-500" />
              <div className="leading-none">
                <div className="text-xs font-semibold tabular-nums tracking-tight">{fmtClock(clock)}</div>
                <div className="text-[9px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{fmtDate(clock)}</div>
              </div>
              <span className="mx-0.5 h-6 w-px bg-neutral-200 dark:bg-neutral-800" />
              <span className="text-xs font-semibold tabular-nums tracking-tight" title="Время работы">
                {fmtDuration(elapsedMs)}
              </span>
              <button
                type="button"
                onClick={toggleTimer}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                aria-label={timer.running ? "Пауза" : "Старт"}
              >
                {timer.running ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
                aria-label="Сброс таймера"
              >
                <ResetIcon size={13} />
              </button>
            </div>
            </div>{/* /MOBILE-FIX сворачиваемая панель инструментов */}

            {/* WS-HISTORY: возврат к снимку. Отмена живёт только в этой вкладке и
                исчезает вместе с ней — а холст можно потерять целиком. */}
            {!remote && (
              <ToolMenu
                label="История"
                icon={<ClockIcon size={13} />}
                title="Вернуться к сохранённому состоянию"
                items={
                  snapshots.length === 0
                    ? [{ label: "Снимков пока нет", onClick: () => void loadSnapshots() }]
                    : snapshots.slice(0, 12).map((snap) => {
                        const when = new Date(snap.createdAt).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        return {
                          label: when,
                          hint: `${Math.max(1, Math.round(snap.size / 1024))} КБ`,
                          onClick: () => void restoreSnapshot(snap.id, when),
                        };
                      })
                }
              />
            )}

            {/* Block · Добавить */}
            <ToolMenu
              label="Добавить"
              primary
              icon={<PlusIcon size={13} />}
              title="Добавить узел на холст"
              items={[
                { label: "Задача", icon: <TaskIcon size={14} />, onClick: () => addCard("task") },
                { label: "Заметка", icon: <NoteIcon size={14} />, onClick: () => addCard("note") },
                { label: "Таблица", icon: <TableIcon size={14} />, onClick: () => addCard("table") },
                {
                  label: "Таблица из файла…",
                  icon: <UploadIcon size={14} />,
                  hint: "CSV, XLSX",
                  onClick: () => tableInputRef.current?.click(),
                },
                { label: "Текстовый документ", icon: <DocumentIcon size={14} />, onClick: addTextDocument },
                {
                  label: "Документ из файла…",
                  icon: <UploadIcon size={14} />,
                  hint: "PDF, Word, TXT",
                  onClick: () => documentInputRef.current?.click(),
                },
                { label: "Ссылка", icon: <LinkIcon size={14} />, onClick: () => addCard("link") },
                { label: "Изображение", icon: <ImageIcon size={14} />, onClick: () => imageInputRef.current?.click() },
                /* TZartstation заменил прежний «Рисунок»: слои, кисть, фигуры,
                   надписи и вставка картинок — и всё это правится потом. */
                { label: "TZartstation", icon: <ImageIcon size={14} />, hint: "рисунок", onClick: addArt },
                "separator",
                /* TPL: заготовка разворачивает готовую доску. Здесь же, в
                   «Добавить», — это тоже способ положить карточки на холст,
                   просто сразу пятнадцать и осмысленных. */
                {
                  label: "Шаблоны",
                  icon: <InboxIcon size={14} />,
                  hint: "готовая доска",
                  onClick: () => setTemplatesOpen(true),
                },
                {
                  label: "Мои задачи",
                  icon: <InboxIcon size={14} />,
                  hint: "из чата",
                  onClick: () => setImportOpen(true),
                },
              ]}
            />

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.forEach((f) => addImageFromFile(f));
                e.target.value = "";
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.forEach((f) => addDocumentFromFile(f));
                e.target.value = "";
              }}
            />
            <input
              ref={tableInputRef}
              type="file"
              accept={SPREADSHEET_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.forEach((f) => addTableFromFile(f));
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {notice && (
          <div className="mx-auto max-w-[1600px] px-4 pb-2 md:px-6">
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{notice}</span>
          </div>
        )}
        {anyFilter && (
          <div className="mx-auto max-w-[1600px] px-4 pb-2 md:px-6">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Показано {visibleCards.length} из {cards.length}
              {hiddenCount > 0 ? ` · скрыто ${hiddenCount}` : ""}
            </span>
          </div>
        )}
      </header>

      <div
        ref={boardRef}
        onPointerDown={onBoardPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="relative flex-1 overflow-hidden"
        style={boardStyle}
      >
        <div className="pointer-events-none absolute inset-0" style={gridStyle} />

        <div className="absolute left-0 top-0" style={worldStyle}>
          <svg className="absolute left-0 top-0 overflow-visible" style={svgStyle}>
            {visibleEdges.map((e) => {
              const src = cardById.get(e.from);
              const dst = cardById.get(e.to);
              if (!src || !dst) return null;
              const a = outPortPos(src, edgeFromPort(e));
              const b = inPortPos(dst, edgeToPort(e));
              const d = bezier(a, b);
              const strokeColor = nodeAccent(src);
              return (
                <g key={e.id}>
                  <path d={d} fill="none" stroke={strokeColor} strokeWidth={2.5} strokeLinecap="round" />
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={edgeHitStyle}
                    onClick={() => deleteEdge(e.id)}
                  >
                    <title>Нажмите, чтобы удалить связь</title>
                  </path>
                </g>
              );
            })}
            {connectSource && connectPos && (
              <path
                d={bezier(outPortPos(connectSource, connectFrom!.port), connectPos)}
                fill="none"
                stroke={nodeAccent(connectSource)}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray="6 5"
                opacity={0.85}
              />
            )}
          </svg>

          {visibleCards.map((card) => (
            <CanvasCard
              key={card.id}
              card={card}
              patch={(p) => patchCard(card.id, p)}
              selected={selected.has(card.id)}
              onDelete={() => deleteCard(card.id)}
              onFocus={() => focusCard(card.id)}
              onNodePointerDown={onNodePointerDown}
              onConnectStart={startConnect}
              onSetColor={setColor}
              onRemind={setReminder}
              onAddPort={addPort}
              onRemovePort={removePort}
              onResizeStart={startResize}
              onResizeReset={resetSize}
              scale={view.scale}
              onOpen={
                card.type === "document"
                  ? () => setOpenDocId(card.id)
                  : card.type === "image"
                    ? () => setOpenImageId(card.id)
                    : card.type === "table"
                      ? () => setOpenTableId(card.id)
                      : card.type === "drawing"
                        ? () => setOpenDrawingId(card.id)
                        : card.type === "art"
                          ? () => setOpenArtId(card.id)
                          : undefined
              }
              linking={connectFrom !== null && connectFrom.id !== card.id}
            />
          ))}
        </div>

        {selRect && (selRect.w > 1 || selRect.h > 1) && (
          <div
            className="pointer-events-none absolute rounded-sm border border-neutral-900/60 bg-neutral-900/10 dark:border-white/60 dark:bg-white/10"
            style={selRectStyle}
          />
        )}

        {cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-neutral-400 dark:text-neutral-500">Пусто. Добавьте первый узел —</p>
              <p className="text-sm text-neutral-400 dark:text-neutral-500">задачу, заметку, документ, ссылку или изображение.</p>
            </div>
          </div>
        )}

        <Minimap cards={visibleCards} view={view} viewportW={boardSize.w} viewportH={boardSize.h} onJump={jumpTo} />

        <div
          className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-label="Отдалить"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            title="Сбросить вид"
            className="min-w-[3rem] rounded-lg px-2 py-1 text-center text-xs font-medium tabular-nums text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-label="Приблизить"
          >
            +
          </button>
        </div>

        {selected.size > 0 && (
          <div
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-neutral-200 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="px-1 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
              Выбрано {selected.size}
            </span>
            <div className="flex items-center gap-1">
              {NODE_COLOR_ORDER.map((col) => {
                const st: CSS = { background: NODE_COLORS[col].accent };
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => applyColorToSelection(col)}
                    title={NODE_COLORS[col].label}
                    className="h-4 w-4 rounded-full transition-transform hover:scale-110"
                    style={st}
                  />
                );
              })}
            </div>
            <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
            <button
              type="button"
              onClick={duplicateSelected}
              title="Дублировать (Ctrl+D)"
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
            >
              <CopyIcon size={14} />
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              title="Удалить (Del)"
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        )}

        <ShortcutsHelp />
      </div>

      {/* FIX-BOARDSCOPE: личная среда берёт только ЛС, общая — только каналы. */}
      <BoardInboxListener
        scope={remote ? "group" : "personal"}
        onItem={(item) => addNoteFromInbox(boardItemToNoteText(item))}
      />

      {importOpen && (
        <ImportTasksPanel
          importedSourceIds={importedSourceIds}
          onImport={importTasks}
          onClose={() => setImportOpen(false)}
        />
      )}

      {openDoc && (
        <DocumentReader
          card={openDoc}
          patch={(p) => patchCard(openDoc.id, p)}
          onClose={() => setOpenDocId(null)}
        />
      )}

      {openTable && (
        <TableEditor
          card={openTable}
          patch={(p) => patchCard(openTable.id, p)}
          onClose={() => setOpenTableId(null)}
        />
      )}

      {openDrawing && (
        <DrawingEditor
          initialImage={openDrawing.src || undefined}
          title={openDrawing.title ? `Рисунок — ${openDrawing.title}` : "Редактор рисунка"}
          onSave={(src) => patchCard(openDrawing.id, { src })}
          onClose={() => setOpenDrawingId(null)}
        />
      )}

      {templatesOpen && (
        <TemplatesPanel
          canApply={!readOnly && isBoardEmpty(cards, edges)}
          onApply={applyTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {openArt && (
        <TZartstationEditor
          scene={openArt.scene}
          title={openArt.title ? `TZartstation — ${openArt.title}` : "TZartstation"}
          channelId={remote?.channelId ?? null}
          readOnly={readOnly}
          onChange={(scene) => patchCard(openArt.id, { scene })}
          onClose={() => setOpenArtId(null)}
        />
      )}

      <ImageLightbox
        src={openImage?.src ?? null}
        alt={openImage?.title || openImage?.caption || "Изображение"}
        onClose={() => setOpenImageId(null)}
      />
    </div>
  );
}
