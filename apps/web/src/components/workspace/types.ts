import type { ArtScene } from "@/lib/tzart"; // TZartstation

// Types & constants for the personal "Рабочая среда" (Workspace) canvas.
// The board is a lightweight node editor (ComfyUI-style): cards are nodes with
// one or more input ports (left) and output ports (right); any output can fan
// out into several links. Nodes carry one of four pastel accent colors.

export type CardType = "task" | "note" | "link" | "image" | "document" | "table" | "drawing" | "art";
export type Status = "todo" | "doing" | "done";
export type Priority = "p1" | "p2" | "p3" | "p4";

/**
 * A document node holds either editable plain text (txt/markdown) or an
 * embedded PDF. Text documents can be created, read and edited in place; PDFs
 * are uploaded, previewed/read and can be replaced.
 */
export type DocKind = "text" | "pdf";

/** Pastel accent colors available for a node. */
export type NodeColor = "red" | "blue" | "gray" | "green";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A single connection point on a node (input on the left, output on right). */
export interface Port {
  id: string;
  label?: string;
}

/**
 * Back-reference to a channel task (from the chat "Задачи" Kanban) that was
 * transferred into the workspace. Present only on cards that were imported,
 * so the canvas can link back to the source and avoid importing twice.
 */
export interface TaskSource {
  taskId: string;
  number: number;
  channelId: string;
  channelName: string;
  groupId: string;
  groupName: string;
}

export interface BaseCard {
  id: string;
  type: CardType;
  /** Canvas position in world pixels (before pan/zoom transform). */
  x: number;
  y: number;
  /** Stacking order — the last focused card floats on top. */
  z: number;
  createdAt: number;
  title: string;
  tags: string[];
  /** Pastel accent color of the node. Defaults to gray when unset. */
  color?: NodeColor;
  /** Extra input ports. When unset the node has a single default input. */
  inputs?: Port[];
  /** Extra output ports. When unset the node has a single default output. */
  outputs?: Port[];
  /**
   * REMIND: когда напомнить об этой карточке, метка времени. Пусто —
   * напоминания нет.
   *
   * Поле общее для всех видов узлов, а не только для задачи: вернуться нужно и
   * к заметке «дозвониться, когда откроются», и к отложенной ссылке, и к
   * таблице, которую надо свести в конце месяца. Срок задачи (`deadline`) —
   * это про обещание, а напоминание — про «толкни меня в это время».
   */
  remindAt?: number | null;
  /**
   * Explicit node width in world pixels. When unset the node uses CARD_WIDTH,
   * so older boards keep their original size until the user drags the resize
   * handle in the bottom-right corner.
   */
  width?: number;
  /**
   * Explicit node height in world pixels. When unset the node grows to fit its
   * content (the original behaviour); once set, the body area scrolls so a
   * shrunk node never clips its own controls.
   */
  height?: number;
}

export interface TaskCard extends BaseCard {
  type: "task";
  status: Status;
  priority: Priority;
  /** 0..100. Derived from the checklist when it has items, otherwise manual. */
  progress: number;
  /** ISO date (yyyy-mm-dd) or empty string. */
  deadline: string;
  checklist: ChecklistItem[];
  note: string;
  /** Set when this card was transferred from a chat channel task. */
  source?: TaskSource;
}

export interface NoteCard extends BaseCard {
  type: "note";
  body: string;
}

export interface LinkCard extends BaseCard {
  type: "link";
  url: string;
  project: string;
}

export interface ImageCard extends BaseCard {
  type: "image";
  /** Data URL (base64) of the uploaded image. */
  src: string;
  caption: string;
}

/**
 * A single text annotation drawn on top of a PDF page. Annotations are stored
 * on the card (non-destructive: the original PDF bytes are never rewritten), so
 * they persist in localStorage and stay editable. When the user exports the
 * document they are flattened into a downloadable PDF.
 *
 * Coordinates are expressed in the PDF's own point units, measured from the
 * top-left corner of the page. Storing them this way (rather than in screen
 * pixels) makes the annotation independent of the on-screen zoom level: to draw
 * it we simply multiply by the current render scale.
 */
export interface PdfAnnotation {
  id: string;
  /** Zero-based page index the annotation belongs to. */
  page: number;
  /** X of the text box's left edge, in PDF points from the page's left. */
  x: number;
  /** Y of the text box's top edge, in PDF points from the page's top. */
  y: number;
  /** The annotation's text (may contain line breaks). */
  text: string;
  /** Font size in PDF points. */
  size: number;
  /**
   * Set only when this annotation edits an existing run of the PDF's own text
   * layer (as opposed to a free-floating note the user added). Holds the
   * original extracted text; on export the original run is painted over with a
   * cover rectangle before the edited text is drawn, so a text-based PDF can be
   * edited in place. A note leaves this undefined.
   */
  origin?: string;
  /** Width of the original text run in PDF points — the cover-rectangle width. */
  boxW?: number;
}

export interface DocumentCard extends BaseCard {
  type: "document";
  /** Whether the node carries editable text or an embedded PDF. */
  docKind: DocKind;
  /** File name shown on the card, e.g. "заметки.txt" or "договор.pdf". */
  fileName: string;
  /** Editable plain-text content (text documents only). Empty for PDFs. */
  text: string;
  /** Data URL (base64) of the uploaded file. Used to preview/read PDFs. */
  src: string;
  /** Optional free-form note kept next to the document. */
  caption: string;
  /** Text annotations layered over the PDF (PDF documents only). */
  annotations?: PdfAnnotation[];
}

/**
 * A lightweight spreadsheet node. The grid is a rectangular matrix of plain
 * string cells; the first row is treated as a header when `hasHeader` is set.
 * Rows and columns can be added, removed and edited in place. The data is small
 * enough to live in localStorage alongside the rest of the board.
 */
export interface TableCard extends BaseCard {
  type: "table";
  /** Row-major grid of cell text. `cells[r][c]` is the cell at row r, column c. */
  cells: string[][];
  /** When true, the first row is styled and treated as column headers. */
  hasHeader: boolean;
  /**
   * Per-column widths in pixels, index-aligned with the columns. Missing
   * entries fall back to the default width, so a freshly imported or older
   * table renders at the default size until a column divider is dragged.
   */
  colWidths?: number[];
  /**
   * Per-row heights in pixels, index-aligned with `cells`. Missing entries fall
   * back to the default row height.
   */
  rowHeights?: number[];
}

/**
 * FIX-DRAW: узел «Рисунок» — содержимое создаётся и редактируется во встроенном
 * редакторе рисунков (карандаш, ластик, геометрические фигуры).
 */
export interface DrawingCard extends BaseCard {
  type: "drawing";
  /** Data URL (PNG, base64) с содержимым рисунка. Пустая строка — рисунок ещё не создан. */
  src: string;
  /** Подпись под рисунком. */
  caption: string;
}

/**
 * TZartstation: векторный редактор фигур.
 *
 * Отличие от «Рисунка» принципиальное: тот сохраняет картинку, и передвинуть
 * прямоугольник или поправить надпись после этого уже нельзя. Здесь фигуры
 * остаются объектами — их правят когда угодно, а сцена весит килобайты вместо
 * мегабайтов.
 *
 * Прежние рисунки не трогаются: это отдельный тип карточки, он продолжает
 * работать как работал.
 */
export interface ArtCard extends BaseCard {
  type: "art";
  /** Сцена: полотно и фигуры. Разбор и проверка — в lib/tzart. */
  scene: ArtScene;
  /** Подпись под полотном. */
  caption: string;
}

export type AnyCard =
  | ArtCard
  | TaskCard
  | NoteCard
  | LinkCard
  | ImageCard
  | DocumentCard
  | TableCard
  | DrawingCard;

/**
 * A directed connection from a node's output port (right) to another node's
 * input port (left). Several edges may share the same source port (fan-out).
 * When a port id is omitted the node's single default port is assumed, which
 * keeps older stored graphs compatible.
 */
export interface Edge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Source output port id (defaults to the single "out" port). */
  fromPort?: string;
  /** Target input port id (defaults to the single "in" port). */
  toPort?: string;
}

export type StatusFilter = "all" | Status;
export type PriorityFilter = "all" | Priority;
export type SortKey = "priority" | "deadline" | "status" | "progress" | "created" | "title";

export const STATUS_META: Record<Status, { label: string; order: number }> = {
  todo: { label: "К выполнению", order: 0 },
  doing: { label: "В работе", order: 1 },
  done: { label: "Готово", order: 2 },
};

export const STATUS_ORDER: Status[] = ["todo", "doing", "done"];

export const PRIORITY_META: Record<
  Priority,
  { label: string; short: string; order: number }
> = {
  p1: { label: "Критический", short: "P1", order: 0 },
  p2: { label: "Высокий", short: "P2", order: 1 },
  p3: { label: "Средний", short: "P3", order: 2 },
  p4: { label: "Низкий", short: "P4", order: 3 },
};

export const PRIORITY_ORDER: Priority[] = ["p1", "p2", "p3", "p4"];

/** Pastel palette for node accents (ports, side stripe, links). */
export const NODE_COLORS: Record<
  NodeColor,
  { label: string; accent: string; soft: string }
> = {
  red: { label: "Красный", accent: "#f0a9a6", soft: "rgba(240,169,166,0.16)" },
  blue: { label: "Голубой", accent: "#a6cbe8", soft: "rgba(166,203,232,0.16)" },
  gray: { label: "Серый", accent: "#c2c8ce", soft: "rgba(194,200,206,0.14)" },
  green: { label: "Зелёный", accent: "#a8d8b9", soft: "rgba(168,216,185,0.16)" },
};

export const NODE_COLOR_ORDER: NodeColor[] = ["red", "blue", "gray", "green"];

export const DEFAULT_NODE_COLOR: NodeColor = "gray";

export function nodeAccent(card: { color?: NodeColor }): string {
  return NODE_COLORS[card.color ?? DEFAULT_NODE_COLOR].accent;
}

/** Related ecosystem destinations offered when adding a "project link" card. */
export const RELATED_PROJECTS: { label: string; href: string }[] = [
  { label: "T.R.I.O.Z.", href: "/projects" },
  { label: "TZ.Connect", href: "/connect" },
  { label: "Перо измерений", href: "/pero" },
  { label: "Игры", href: "/games" },
  { label: "TZ.Library", href: "/library" },
];

export const CARD_WIDTH = 300;

/** Sizing bounds for a resizable node (world pixels). */
export const CARD_MIN_WIDTH = 220;
export const CARD_MAX_WIDTH = 900;
export const CARD_MIN_HEIGHT = 140;
export const CARD_MAX_HEIGHT = 1000;

/** Effective on-canvas width of a node (falls back to the default width). */
export function cardWidth(c: { width?: number }): number {
  return c.width ?? CARD_WIDTH;
}

/** Vertical offset (from the node top) of the first port center. */
export const PORT_Y = 18;

/** Vertical spacing between stacked ports on the same side. */
export const PORT_GAP = 22;

/** Effective input ports of a node (falls back to a single default input). */
export function cardInputs(c: { inputs?: Port[] }): Port[] {
  return c.inputs && c.inputs.length ? c.inputs : [{ id: "in" }];
}

/** Effective output ports of a node (falls back to a single default output). */
export function cardOutputs(c: { outputs?: Port[] }): Port[] {
  return c.outputs && c.outputs.length ? c.outputs : [{ id: "out" }];
}

/** Y offset (from the node top) of the port at the given index. */
export function portOffsetY(index: number): number {
  return PORT_Y + index * PORT_GAP;
}

export function edgeFromPort(e: Edge): string {
  return e.fromPort ?? "out";
}

export function edgeToPort(e: Edge): string {
  return e.toPort ?? "in";
}

/** Compute the effective progress of a task (checklist-driven when present). */
export function taskProgress(t: TaskCard): number {
  if (t.checklist.length > 0) {
    const done = t.checklist.filter((i) => i.done).length;
    return Math.round((done / t.checklist.length) * 100);
  }
  return Math.max(0, Math.min(100, t.progress));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Build an empty `rows × cols` grid of blank cells for a new table node. */
export function emptyGrid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
}

/* ── Channel task → workspace card bridge ─────────────────────────
 * The chat "Задачи" board and the workspace use different vocabularies. These
 * maps translate a channel task (the source of truth for teamwork) into the
 * workspace's own task card model (the reference model here). The workspace is
 * intentionally the canonical shape, so translation only ever flows inward. */

/** Shape returned by GET /api/tasks/assigned. */
export interface ChannelTaskDTO {
  id: string;
  number: number;
  title: string;
  description: string | null;
  /** open | in_progress | done | failed | needs_clarification */
  status: string;
  /** low | normal | high */
  priority: string;
  /** ISO datetime string or null. */
  dueDate: string | null;
  /** Comma-separated labels. */
  tags: string;
  parentId: string | null;
  channelId: string;
  channelName: string;
  groupId: string;
  groupName: string;
  checklist: { id: string; text: string; done: boolean; order: number }[];
}

/** Channel status → workspace status. */
const STATUS_FROM_CHANNEL: Record<string, Status> = {
  open: "todo",
  in_progress: "doing",
  needs_clarification: "doing",
  done: "done",
  failed: "done",
};

/** Channel priority → workspace priority (labels line up: Высокий↔Высокий). */
const PRIORITY_FROM_CHANNEL: Record<string, Priority> = {
  high: "p2",
  normal: "p3",
  low: "p4",
};

export function statusFromChannel(status: string): Status {
  return STATUS_FROM_CHANNEL[status] ?? "todo";
}

export function priorityFromChannel(priority: string): Priority {
  return PRIORITY_FROM_CHANNEL[priority] ?? "p3";
}

/** Build a workspace task card from an assigned channel task. */
export function channelTaskToCard(
  dto: ChannelTaskDTO,
  pos: { x: number; y: number; z: number },
): TaskCard {
  return {
    id: newId(),
    type: "task",
    x: pos.x,
    y: pos.y,
    z: pos.z,
    createdAt: Date.now(),
    color: "blue",
    title: dto.title,
    tags: (dto.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    status: statusFromChannel(dto.status),
    priority: priorityFromChannel(dto.priority),
    progress: 0,
    deadline: dto.dueDate ? dto.dueDate.slice(0, 10) : "",
    checklist: [...dto.checklist]
      .sort((a, b) => a.order - b.order)
      .map((item) => ({ id: newId(), text: item.text, done: item.done })),
    note: dto.description ?? "",
    source: {
      taskId: dto.id,
      number: dto.number,
      channelId: dto.channelId,
      channelName: dto.channelName,
      groupId: dto.groupId,
      groupName: dto.groupName,
    },
  };
}
