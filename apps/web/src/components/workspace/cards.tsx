"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  type ArtCard,
  AnyCard,
  DocumentCard,
  DrawingCard,
  ImageCard,
  LinkCard,
  NoteCard,
  Priority,
  PRIORITY_META,
  PRIORITY_ORDER,
  RELATED_PROJECTS,
  Status,
  STATUS_META,
  TableCard,
  TaskCard,
  taskProgress,
  ChecklistItem,
  newId,
} from "./types";
import TZartstation from "./TZartstation"; // TZartstation: редактор изображений
import { sceneFromImage } from "@/lib/tzart";
import { downloadImage, fileToDataUrl } from "./image";
import { baseName, downloadTextDocument, fileToDocumentFields, DOCUMENT_ACCEPT } from "./document";
import {
  colCount,
  insertCol,
  insertRow,
  insertSize,
  normalizeSizes,
  setCell,
  setSize,
  DEFAULT_COL_WIDTH,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
} from "./table";
import { GridResizeHandle } from "./GridResizeHandle";
import { useObjectUrl } from "./useObjectUrl";
import {
  StatusGlyph,
  CalendarIcon,
  DocumentIcon,
  DownloadIcon,
  ExpandIcon,
  ExternalIcon,
  ImageIcon,
  PlusIcon,
  CloseIcon,
  LinkIcon,
  UploadIcon,
} from "./icons";
import { AutoTextarea, INPUT_BASE, Picker, PriorityPill, ProgressBar, TagEditor } from "./ui";

const NEXT_STATUS: Record<Status, Status> = { todo: "doing", doing: "done", done: "todo" };

function titleInput(value: string, onChange: (v: string) => void, placeholder: string) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-[15px] font-semibold leading-snug ${INPUT_BASE}`}
    />
  );
}

/* ── Monochrome checkbox ───────────────────────────────────── */

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="checkbox"
      aria-checked={checked}
      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        checked
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
          : "border-neutral-300 bg-transparent dark:border-neutral-600 hover:border-neutral-500 dark:hover:border-neutral-400"
      }`}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2">
          <path d="m5 12 5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function daysLeft(deadline: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/* ── Task card ─────────────────────────────────────────── */

export function TaskCardView({
  card,
  patch,
}: {
  card: TaskCard;
  patch: (p: Partial<TaskCard>) => void;
}) {
  const progress = taskProgress(card);
  const hasList = card.checklist.length > 0;
  const dl = daysLeft(card.deadline);
  const overdue = dl !== null && dl < 0 && card.status !== "done";

  const setChecklist = (items: ChecklistItem[]) => patch({ checklist: items });

  return (
    <div className="space-y-2.5">
      {/* Title + status */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => patch({ status: NEXT_STATUS[card.status] })}
          title={`Статус: ${STATUS_META[card.status].label} — нажмите, чтобы изменить`}
          className="mt-0.5 text-neutral-900 dark:text-white"
        >
          <StatusGlyph status={card.status} size={18} />
        </button>
        {titleInput(card.title, (v) => patch({ title: v }), "Название задачи")}
      </div>

      {/* Status label + priority */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {STATUS_META[card.status].label}
        </span>
        <Picker<Priority>
          value={card.priority}
          onChange={(v) => patch({ priority: v })}
          options={PRIORITY_ORDER.map((p) => ({
            value: p,
            label: `${PRIORITY_META[p].short} · ${PRIORITY_META[p].label}`,
            hint: <PriorityPill p={p} className="mr-1" />,
          }))}
        />
      </div>

      {/* Progress */}
      <ProgressBar value={progress} editable={!hasList} onChange={(v) => patch({ progress: v })} />

      {/* Checklist */}
      <div className="space-y-1">
        {card.checklist.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Checkbox
              checked={item.done}
              onChange={() =>
                setChecklist(card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
              }
            />
            <input
              value={item.text}
              onChange={(e) =>
                setChecklist(card.checklist.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))
              }
              placeholder="Пункт"
              className={`flex-1 text-[13px] ${INPUT_BASE} ${
                item.done ? "text-neutral-400 line-through dark:text-neutral-600" : ""
              }`}
            />
            <button
              type="button"
              onClick={() => setChecklist(card.checklist.filter((i) => i.id !== item.id))}
              className="text-neutral-300 hover:text-neutral-700 dark:text-neutral-600 dark:hover:text-neutral-300"
              aria-label="Удалить пункт"
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setChecklist([...card.checklist, { id: newId(), text: "", done: false }])}
          className="flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
        >
          <PlusIcon size={12} /> Пункт чек-листа
        </button>
      </div>

      {/* Deadline */}
      <div
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 [color-scheme:light] dark:[color-scheme:dark] ${
          overdue
            ? "border-neutral-900 dark:border-white"
            : "border-neutral-200 dark:border-neutral-800"
        }`}
      >
        <CalendarIcon size={14} className="text-neutral-400 dark:text-neutral-500" />
        <input
          type="date"
          value={card.deadline}
          onChange={(e) => patch({ deadline: e.target.value })}
          className={`flex-1 text-[12px] ${INPUT_BASE}`}
        />
        {dl !== null && (
          <span
            className={`text-[11px] font-medium tabular-nums ${
              overdue ? "text-neutral-900 dark:text-white" : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            {overdue ? `просрочено ${Math.abs(dl)} дн.` : dl === 0 ? "сегодня" : `${dl} дн.`}
          </span>
        )}
      </div>

      {/* Note */}
      <AutoTextarea
        value={card.note}
        onChange={(v) => patch({ note: v })}
        placeholder="Короткая заметка…"
        className="w-full text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300"
      />

      {/* Tags */}
      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />

      {/* Source link back to the chat task this card was transferred from */}
      {card.source && (
        <Link
          href={`/connect?group=${card.source.groupId}&channel=${card.source.channelId}&task=${card.source.taskId}`}
          className="flex items-center gap-1.5 border-t border-neutral-100 pt-2 text-[11px]
            text-neutral-400 transition-colors hover:text-neutral-900 dark:border-neutral-800 dark:hover:text-white"
          title="Открыть исходную задачу в чате"
        >
          <LinkIcon size={12} />
          <span className="truncate">
            Из чата · #{card.source.number}
            {card.source.channelName ? ` · ${card.source.channelName}` : ""}
          </span>
          <ExternalIcon size={11} className="ml-auto flex-shrink-0" />
        </Link>
      )}
    </div>
  );
}

/* ── Note card ─────────────────────────────────────────── */

export function NoteCardView({
  card,
  patch,
}: {
  card: NoteCard;
  patch: (p: Partial<NoteCard>) => void;
}) {
  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Заголовок заметки")}
      <AutoTextarea
        value={card.body}
        onChange={(v) => patch({ body: v })}
        placeholder="Текст рабочей заметки…"
        minRows={4}
        className="w-full text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200"
      />
      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
    </div>
  );
}

/* ── Image card ───────────────────────────────────────── */

export function ImageCardView({
  card,
  patch,
  onOpen,
}: {
  card: ImageCard;
  patch: (p: Partial<ImageCard>) => void;
  onOpen?: () => void;
}) {
  const onFile = async (file?: File) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    patch({ src });
  };

  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Название изображения")}

      {card.src ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpen}
            title="Открыть в полном размере"
            className="group relative block w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.src}
              alt={card.title || card.caption || "Изображение"}
              className="w-full cursor-zoom-in object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              draggable={false}
            />
            <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <ExpandIcon size={15} />
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              <ExpandIcon size={13} /> Открыть
            </button>
            <button
              type="button"
              onClick={() => downloadImage(card.src, card.title || card.caption || "изображение")}
              className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              <DownloadIcon size={13} /> Скачать
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white">
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <ImageIcon size={13} /> Заменить
            </label>
            <OpenInArtButton
              src={card.src}
              caption={card.caption}
              patch={patch as (p: Partial<AnyCard>) => void}
            />
            <button
              type="button"
              onClick={() => patch({ src: "" })}
              className="ml-auto text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              Убрать
            </button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-[12px] text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-200">
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <ImageIcon size={20} />
          Нажмите, чтобы загрузить изображение
          <span className="text-[11px] text-neutral-300 dark:text-neutral-600">или перетащите файл на холст</span>
        </label>
      )}

      <input
        value={card.caption}
        onChange={(e) => patch({ caption: e.target.value })}
        placeholder="Подпись…"
        className={`w-full text-[12px] text-neutral-500 dark:text-neutral-400 ${INPUT_BASE}`}
      />

      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
    </div>
  );
}

/* ── Link card ─────────────────────────────────────────── */

function isInternal(url: string) {
  return url.startsWith("/");
}

export function LinkCardView({
  card,
  patch,
}: {
  card: LinkCard;
  patch: (p: Partial<LinkCard>) => void;
}) {
  const preset = RELATED_PROJECTS.find((p) => p.label === card.project);
  const url = card.url || preset?.href || "";
  const canOpen = url.length > 0;

  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Название ссылки")}

      <Picker<string>
        value={card.project || "custom"}
        label="Проект"
        onChange={(v) => {
          if (v === "custom") {
            patch({ project: "" });
          } else {
            const p = RELATED_PROJECTS.find((r) => r.label === v);
            patch({ project: v, url: p?.href ?? card.url });
          }
        }}
        options={[
          ...RELATED_PROJECTS.map((p) => ({ value: p.label, label: p.label })),
          { value: "custom", label: "Другая ссылка" },
        ]}
      />

      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5">
        <input
          value={card.url}
          onChange={(e) => patch({ url: e.target.value, project: isInternal(e.target.value) ? card.project : "" })}
          placeholder="https:// или /раздел"
          className={`w-full text-[12px] ${INPUT_BASE}`}
        />
      </div>

      {canOpen &&
        (isInternal(url) ? (
          <Link
            href={url}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px]
              font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 transition-colors"
          >
            <ExternalIcon size={13} /> Перейти
          </Link>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px]
              font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 transition-colors"
          >
            <ExternalIcon size={13} /> Открыть
          </a>
        ))}

      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
    </div>
  );
}

/* ── Document card (PDF / text) ───────────────────────── */

export function DocumentCardView({
  card,
  patch,
  onOpen,
}: {
  card: DocumentCard;
  patch: (p: Partial<DocumentCard>) => void;
  onOpen?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const pdfUrl = useObjectUrl(card.docKind === "pdf" ? card.src : null);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const fields = await fileToDocumentFields(file);
      if (!fields) {
        setError("Неподдерживаемый формат. Выберите PDF, Word (.docx) или текстовый файл (.txt, .md…).");
        return;
      }
      // Give the card a title from the file name on first load.
      patch(card.title ? fields : { ...fields, title: baseName(fields.fileName) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл.");
    }
  };

  const uploadInput = (
    <input
      ref={fileRef}
      type="file"
      accept={DOCUMENT_ACCEPT}
      className="hidden"
      onChange={(e) => {
        onFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  const openBtn = (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px]
        font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
    >
      <ExpandIcon size={13} /> {card.docKind === "pdf" ? "Редактировать" : "Открыть"}
    </button>
  );

  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Название документа")}

      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
        <DocumentIcon size={13} />
        <span className="truncate">{card.fileName || (card.docKind === "pdf" ? "PDF" : "текстовый документ")}</span>
        {card.docKind === "pdf" && (card.annotations?.length ?? 0) > 0 && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {card.annotations!.length} правок
          </span>
        )}
        <span className="ml-auto rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {card.docKind === "pdf" ? "PDF" : "Текст"}
        </span>
      </div>

      {card.docKind === "pdf" ? (
        card.src ? (
          <div className="space-y-2">
            {pdfUrl ? (
              <object
                data={pdfUrl}
                type="application/pdf"
                className="h-40 w-full rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40"
              >
                <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-neutral-400">
                  Предпросмотр недоступен — откройте документ.
                </div>
              </object>
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950/40">
                Загрузка…
              </div>
            )}
            <div className="flex items-center gap-2">
              {openBtn}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
              >
                <UploadIcon size={13} /> Заменить
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed
              border-neutral-300 px-3 py-6 text-center text-[12px] text-neutral-400 transition-colors hover:border-neutral-500
              hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-200"
          >
            <UploadIcon size={20} />
            Загрузить PDF
          </button>
        )
      ) : (
        <div className="space-y-2">
          <AutoTextarea
            value={card.text}
            onChange={(v) => patch({ text: v })}
            placeholder="Текст документа… или загрузите файл ниже"
            minRows={4}
            className="w-full font-mono text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-200"
          />
          <div className="flex flex-wrap items-center gap-2">
            {openBtn}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              <UploadIcon size={13} /> Загрузить файл
            </button>
            {card.text && (
              <button
                type="button"
                onClick={() => downloadTextDocument(card.fileName || `${card.title || "документ"}.txt`, card.text)}
                className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
              >
                <DownloadIcon size={13} /> Скачать
              </button>
            )}
          </div>
        </div>
      )}

      <input
        value={card.caption}
        onChange={(e) => patch({ caption: e.target.value })}
        placeholder="Заметка к документу…"
        className={`w-full text-[12px] text-neutral-500 dark:text-neutral-400 ${INPUT_BASE}`}
      />

      {error && <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{error}</p>}

      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
      {uploadInput}
    </div>
  );
}

/* ── Table card (spreadsheet) ─────────────────────────── */

export function TableCardView({
  card,
  patch,
  onOpen,
  scale = 1,
}: {
  card: TableCard;
  patch: (p: Partial<TableCard>) => void;
  onOpen?: () => void;
  /** Current canvas zoom, so inline column dividers track the cursor 1:1. */
  scale?: number;
}) {
  const cells = card.cells;
  const cols = colCount(cells);
  const setCells = (next: string[][]) => patch({ cells: next });
  const headerRow = card.hasHeader ? cells[0] : null;
  const bodyRows = card.hasHeader ? cells.slice(1) : cells;

  // A table shows explicit column widths / row heights only once the user has
  // sized it (in the full editor or by dragging a divider here). Until then it
  // keeps its original auto-fit layout, so a fresh or many-column table isn't
  // forced into horizontal scrolling.
  const sized = !!card.colWidths || !!card.rowHeights;
  const widths = normalizeSizes(card.colWidths, cols, DEFAULT_COL_WIDTH);
  const heights = normalizeSizes(card.rowHeights, cells.length, DEFAULT_ROW_HEIGHT);
  const tableWidth = widths.reduce((s, w) => s + w, 0);

  const setColW = (ci: number, w: number) =>
    patch({ colWidths: setSize(card.colWidths, cols, ci, w, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, MAX_COL_WIDTH) });
  const addRow = () =>
    patch({ cells: insertRow(cells), rowHeights: insertSize(card.rowHeights, cells.length, DEFAULT_ROW_HEIGHT) });
  const addCol = () =>
    patch({ cells: insertCol(cells), colWidths: insertSize(card.colWidths, cols, DEFAULT_COL_WIDTH) });

  const cellInput = (value: string, ri: number, ci: number, header: boolean) => (
    <input
      value={value}
      onChange={(e) => setCells(setCell(cells, ri, ci, e.target.value))}
      placeholder={header ? "Заголовок" : ""}
      className={`h-full w-full ${sized ? "" : "min-w-[76px]"} bg-transparent px-2 py-1.5 outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600 ${
        header
          ? "font-semibold text-neutral-700 dark:text-neutral-100"
          : "text-neutral-700 dark:text-neutral-200"
      }`}
    />
  );

  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Название таблицы")}

      {/* Unified, styled grid: one framed table with a shaded header row, thin
          column dividers and zebra-striped body rows (matches the workspace's
          neutral palette). Once sized, columns/rows follow the stored sizes and
          the header dividers can be dragged to resize further. */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table
          className={`border-collapse text-[12px] ${sized ? "" : "w-full"}`}
          style={sized ? { tableLayout: "fixed", width: tableWidth } : undefined}
        >
          {sized && (
            <colgroup>
              {widths.map((w, ci) => (
                <col key={ci} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          {headerRow && (
            <thead>
              <tr className="bg-neutral-100/80 dark:bg-neutral-800/60">
                {headerRow.map((cell, ci) => (
                  <th
                    key={ci}
                    style={sized ? { height: heights[0] } : undefined}
                    className="relative border-b border-neutral-200 p-0 text-left first:rounded-tl-xl last:rounded-tr-xl dark:border-neutral-700 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-neutral-200 dark:[&:not(:first-child)]:border-neutral-700"
                  >
                    {cellInput(cell, 0, ci, true)}
                    {sized && (
                      <GridResizeHandle
                        axis="x"
                        size={widths[ci]}
                        min={MIN_COL_WIDTH}
                        max={MAX_COL_WIDTH}
                        scale={scale}
                        onResize={(w) => setColW(ci, w)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {bodyRows.map((row, bi) => {
              const ri = card.hasHeader ? bi + 1 : bi;
              return (
                <tr
                  key={ri}
                  style={sized ? { height: heights[ri] } : undefined}
                  className="even:bg-neutral-50/60 hover:bg-neutral-100/70 dark:even:bg-neutral-800/30 dark:hover:bg-neutral-800/50"
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="relative border-t border-neutral-100 p-0 align-top first:border-l-0 dark:border-neutral-800/70 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-neutral-100 dark:[&:not(:first-child)]:border-neutral-800/70"
                    >
                      {cellInput(cell, ri, ci, false)}
                      {sized && !headerRow && bi === 0 && (
                        <GridResizeHandle
                          axis="x"
                          size={widths[ci]}
                          min={MIN_COL_WIDTH}
                          max={MAX_COL_WIDTH}
                          scale={scale}
                          onResize={(w) => setColW(ci, w)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-neutral-400 dark:text-neutral-500">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 transition-colors hover:text-neutral-900 dark:hover:text-white"
        >
          <PlusIcon size={12} /> Строка
        </button>
        <button
          type="button"
          onClick={addCol}
          className="inline-flex items-center gap-1 transition-colors hover:text-neutral-900 dark:hover:text-white"
        >
          <PlusIcon size={12} /> Столбец
        </button>
        <button
          type="button"
          onClick={() => patch({ hasHeader: !card.hasHeader })}
          className="inline-flex items-center gap-1 transition-colors hover:text-neutral-900 dark:hover:text-white"
        >
          Заголовок: {card.hasHeader ? "вкл" : "выкл"}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1.5 transition-colors hover:text-neutral-900 dark:hover:text-white"
        >
          <ExpandIcon size={13} /> Открыть
        </button>
      </div>

      <span className="text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
        {cells.length} × {cols}
      </span>

      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
    </div>
  );
}

/* ── Drawing card (FIX-DRAW) ──────────────────────────── */

export function DrawingCardView({
  card,
  patch,
  onOpen,
}: {
  card: DrawingCard;
  patch: (p: Partial<DrawingCard>) => void;
  onOpen?: () => void;
}) {
  return (
    <div className="space-y-2.5">
      {titleInput(card.title, (v) => patch({ title: v }), "Название рисунка")}

      {card.src ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpen}
            title="Открыть в редакторе"
            className="group relative block w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.src}
              alt={card.title || card.caption || "Рисунок"}
              className="w-full cursor-pointer object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              draggable={false}
            />
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              ✏️ Редактировать
            </button>
            <button
              type="button"
              onClick={() => downloadImage(card.src, card.title || card.caption || "рисунок")}
              className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              <DownloadIcon size={13} /> Скачать
            </button>
            <OpenInArtButton
              src={card.src}
              caption={card.caption}
              patch={patch as (p: Partial<AnyCard>) => void}
            />
            <button
              type="button"
              onClick={() => patch({ src: "" })}
              className="ml-auto text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            >
              Очистить
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-[12px] text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-200"
        >
          <span className="text-base" aria-hidden>✏️</span>
          Нажмите, чтобы создать рисунок
          <span className="text-[11px] text-neutral-300 dark:text-neutral-600">карандаш, ластик, фигуры</span>
        </button>
      )}

      <input
        value={card.caption}
        onChange={(e) => patch({ caption: e.target.value })}
        placeholder="Подпись…"
        className={`w-full text-[12px] text-neutral-500 dark:text-neutral-400 ${INPUT_BASE}`}
      />

      <TagEditor tags={card.tags} onChange={(t) => patch({ tags: t })} />
    </div>
  );
}

/* ── Перенос старой карточки в TZartstation ──────────────────────────── */

/**
 * Кнопка «Открыть в TZartstation» на карточках «Изображение» и «Рисунок».
 *
 * Обе хранят готовый PNG и больше ничего: содержимое в них не правится — только
 * заменяется целиком. Перенос кладёт ту же картинку подложкой сцены, поверх
 * которой можно рисовать, подписывать и выделять, ничего не потеряв. Файл при
 * этом не трогается: он остаётся в хранилище, сцена только ссылается на него.
 *
 * Кнопка не показывается, пока картинка ещё лежит в карточке строкой `data:` —
 * такие байты в сцену не переносятся (см. lib/tzart), и перенос дал бы пустое
 * полотно. Ждать почти не приходится: вложения уезжают в хранилище сразу после
 * открытия среды.
 */
function OpenInArtButton({
  src,
  caption,
  patch,
}: {
  src: string;
  caption: string;
  patch: (p: Partial<AnyCard>) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!src.startsWith("/uploads/")) return null;

  const convert = async () => {
    setBusy(true);
    /* Размер берём у самой картинки: полотно по её размеру означает, что снимок
       экрана не окажется обрезанным и не повиснет в углу пустого листа. */
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 960, h: img.naturalHeight || 600 });
      img.onerror = () => resolve({ w: 960, h: 600 });
      img.src = src;
    });
    patch({ type: "art", scene: sceneFromImage(src, size.w, size.h), caption, src: "" } as Partial<AnyCard>);
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void convert()}
      title="Перенести картинку в редактор: слои, кисть, фигуры, надписи"
      className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-900 disabled:opacity-40 dark:hover:text-white"
    >
      🎨 В TZartstation
    </button>
  );
}

/* ── Dispatch ─────────────────────────────────────────── */

export function CardBody({
  card,
  patch,
  onOpen,
  scale = 1,
}: {
  card: AnyCard;
  patch: (p: Partial<AnyCard>) => void;
  onOpen?: () => void;
  /** Current canvas zoom, forwarded to size-aware bodies (the table grid). */
  scale?: number;
}) {
  switch (card.type) {
    case "task":
      return <TaskCardView card={card} patch={patch as (p: Partial<TaskCard>) => void} />;
    case "note":
      return <NoteCardView card={card} patch={patch as (p: Partial<NoteCard>) => void} />;
    case "image":
      return <ImageCardView card={card} patch={patch as (p: Partial<ImageCard>) => void} onOpen={onOpen} />;
    case "drawing":
      return <DrawingCardView card={card} patch={patch as (p: Partial<DrawingCard>) => void} onOpen={onOpen} />;
    case "link":
      return <LinkCardView card={card} patch={patch as (p: Partial<LinkCard>) => void} />;
    case "document":
      return (
        <DocumentCardView
          card={card}
          patch={patch as (p: Partial<DocumentCard>) => void}
          onOpen={onOpen}
        />
      );
    case "table":
      return (
        <TableCardView
          card={card}
          patch={patch as (p: Partial<TableCard>) => void}
          onOpen={onOpen}
          scale={scale}
        />
      );
    /* TZartstation: редактор изображений. Карточка показывает сцену и открывает
       редактор — панели слоёв и инструментов в узел шириной в триста точек не
       помещаются. Прежние «Рисунок» и «Изображение» продолжают открываться, их
       можно перенести сюда кнопкой на самой карточке. */
    case "art":
      return (
        <div className="flex flex-col gap-1.5 p-2">
          <TZartstation scene={card.scene} onOpen={onOpen} />
          <input
            value={card.caption ?? ""}
            onChange={(e) => (patch as (p: Partial<ArtCard>) => void)({ caption: e.target.value.slice(0, 200) })}
            placeholder="Подпись"
            className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs
              dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      );
  }
}
