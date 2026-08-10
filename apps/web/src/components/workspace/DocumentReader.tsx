"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentCard } from "./types";
import { downloadTextDocument, fileToDocumentFields, DOCUMENT_ACCEPT } from "./document";
import { useObjectUrl } from "./useObjectUrl";
import { CloseIcon, DownloadIcon, UploadIcon } from "./icons";
import { INPUT_BASE } from "./ui";
import InfoTooltip from "@/components/ui/InfoTooltip";
import PdfEditor from "./PdfEditor";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Full-screen reader / editor for a document node. Text documents open a large
 * editable area (read + edit); PDFs open an embedded viewer (read) with
 * download / open-in-new-tab and the ability to replace the file.
 */
export default function DocumentReader({
  card,
  patch,
  onClose,
}: {
  card: DocumentCard;
  patch: (p: Partial<DocumentCard>) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const pdfUrl = useObjectUrl(card.docKind === "pdf" ? card.src : null);

  const displayName = card.fileName || card.title || "Документ";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const fields = await fileToDocumentFields(file);
      if (!fields) {
        setError("Неподдерживаемый формат. Выберите PDF, Word (.docx) или текстовый файл.");
        return;
      }
      patch(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл.");
    }
  };

  const lines = card.text ? card.text.split("\n").length : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Документ: ${displayName}`}
    >
      <div
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border
          border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <span
            className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider
              text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            {card.docKind === "pdf" ? "PDF" : "Текст"}
          </span>
          <input
            value={card.fileName}
            onChange={(e) => patch({ fileName: e.target.value })}
            placeholder={card.docKind === "pdf" ? "документ.pdf" : "документ.txt"}
            className={`min-w-0 flex-1 text-[15px] font-semibold ${INPUT_BASE}`}
          />

          <div className="flex items-center gap-1.5">
            {card.docKind === "text" && (
              <button
                type="button"
                onClick={() => downloadTextDocument(card.fileName || "документ.txt", card.text)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5
                  text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400
                  dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
              >
                <DownloadIcon size={14} /> Скачать
              </button>
            )}
            {/* PDF open/download actions live inside the PDF editor toolbar. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Заменить содержимое файлом"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5
                text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400
                dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
            >
              <UploadIcon size={14} /> {card.src || card.text ? "Заменить" : "Загрузить"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400
                transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <CloseIcon size={16} />
            </button>
          </div>
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
        </div>

        {error && (
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-300">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden bg-neutral-50 dark:bg-neutral-950/40">
          {card.docKind === "pdf" ? (
            !card.src ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-400">
                Файл не загружен. Нажмите «Загрузить».
              </div>
            ) : (
              <ErrorBoundary fallback="Не удалось отобразить PDF в редакторе.">
                <PdfEditor card={card} patch={patch} pdfUrl={pdfUrl} />
              </ErrorBoundary>
            )
          ) : (
            <textarea
              value={card.text}
              onChange={(e) => patch({ text: e.target.value })}
              placeholder="Пустой документ. Начните печатать…"
              className={`h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed
                text-neutral-800 dark:text-neutral-100 ${INPUT_BASE}`}
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        {card.docKind === "text" && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
            <span>
              Текстовый документ{" "}
              <InfoTooltip text="Текст правится прямо здесь, в этом же окне: отдельной кнопки «Сохранить» нет — всё, что вы набрали, остаётся в карточке." />
            </span>
            <span className="tabular-nums">
              {card.text.length} символов · {lines} строк
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
