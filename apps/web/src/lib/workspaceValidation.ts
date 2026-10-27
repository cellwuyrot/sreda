type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const kinds = new Set(["task", "note", "link", "image", "document", "table", "drawing", "art"]);

const text = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown) => Array.isArray(v) && v.every(text);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const positive = (v: unknown) => finite(v) && Number(v) > 0;
function validCard(card: RecordValue): boolean {
  if (!optional(card.color, v => ["red", "blue", "gray", "green"].includes(String(v)))) return false;
  if (!finite(card.z) || !finite(card.createdAt) || !text(card.title) || !strings(card.tags)) return false;
  if (!optional(card.width, positive) || !optional(card.height, positive)) return false;
  for (const ports of [card.inputs, card.outputs]) {
    if (ports !== undefined && (!Array.isArray(ports) || !ports.every(p => object(p) && id(p.id) && optional(p.label, text)))) return false;
  }
  switch (card.type) {
    case "task": return ["todo", "doing", "done"].includes(String(card.status)) && ["p1", "p2", "p3", "p4"].includes(String(card.priority)) && finite(card.progress) && Number(card.progress) >= 0 && Number(card.progress) <= 100 && text(card.deadline) && text(card.note) && Array.isArray(card.checklist) && card.checklist.every(c => object(c) && id(c.id) && text(c.text) && typeof c.done === "boolean");
    case "note": return text(card.body);
    case "link": return text(card.url) && text(card.project);
    case "image": case "drawing": return text(card.src) && text(card.caption);
    case "document": return ["text", "pdf"].includes(String(card.docKind)) && [card.fileName, card.text, card.src, card.caption].every(text) && optional(card.annotations, a => Array.isArray(a) && a.every(n => object(n) && id(n.id) && finite(n.page) && finite(n.x) && finite(n.y) && text(n.text) && positive(n.size)));
    case "table": return Array.isArray(card.cells) && card.cells.every(strings) && typeof card.hasHeader === "boolean" && optional(card.colWidths, v => Array.isArray(v) && v.every(positive)) && optional(card.rowHeights, v => Array.isArray(v) && v.every(positive));
    case "art": return text(card.caption) && object(card.scene) && positive(card.scene.w) && positive(card.scene.h) && Array.isArray(card.scene.layers) && card.scene.layers.every(l => object(l) && id(l.id) && text(l.name) && typeof l.visible === "boolean" && typeof l.locked === "boolean" && finite(l.opacity)) && Array.isArray(card.scene.shapes) && card.scene.shapes.every(s => object(s) && id(s.id) && ["rect", "ellipse", "line", "arrow", "text", "path", "image"].includes(String(s.kind)) && [s.x, s.y, s.w, s.h].every(finite) && optional(s.points, v => Array.isArray(v) && v.every(finite)));
    default: return false;
  }
}

/** Reject malformed snapshots before touching the last working state. */
export function validateWorkspace(value: unknown, maxBoards = 5): boolean {
  if (!object(value) || value.v !== 3 || !Array.isArray(value.boards) || value.boards.length < 1 || value.boards.length > maxBoards) return false;
  const boards = new Set<string>();
  for (const board of value.boards) {
    if (!object(board) || !id(board.id) || boards.has(board.id) || typeof board.name !== "string" || board.name.length > 500) return false;
    boards.add(board.id);
    if (!Array.isArray(board.cards) || board.cards.length > 10_000 || !Array.isArray(board.edges) || board.edges.length > 20_000) return false;
    if (!object(board.view) || !finite(board.view.x) || !finite(board.view.y) || !finite(board.view.scale) || Number(board.view.scale) <= 0) return false;
    const cards = new Set<string>();
    for (const card of board.cards) {
      if (!object(card) || !id(card.id) || cards.has(card.id) || !kinds.has(String(card.type)) || !finite(card.x) || !finite(card.y) || !validCard(card)) return false;
      cards.add(card.id);
    }
    const edges = new Set<string>();
    for (const edge of board.edges) {
      if (!object(edge) || !id(edge.id) || edges.has(edge.id) || !id(edge.from) || !id(edge.to) || !cards.has(edge.from) || !cards.has(edge.to)) return false;
      edges.add(edge.id);
    }
  }
  if (!id(value.activeId) || !boards.has(value.activeId)) return false;
  if (value.timer !== undefined && (!object(value.timer) || typeof value.timer.running !== "boolean" || !finite(value.timer.accumulatedMs) || (value.timer.startedAt !== null && !finite(value.timer.startedAt)))) return false;
  return true;
}

export function parseWorkspaceRevision(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value);
}

/** Ignore a delayed read older than an already acknowledged server version. */
export function isStaleWorkspaceRevision(current: string | null | undefined, incoming: string | null): boolean {
  return typeof current === "string" && (incoming === null || Date.parse(incoming) < Date.parse(current));
}
