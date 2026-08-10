"use client";

/**
 * useFileDropPaste — drag&drop файлов + вставка из буфера обмена (Ctrl+V)
 * для любого места, где можно вставлять: чат группы, личный чат, комментарии
 * задач и т.д.
 *
 * Хук не навязывает транспорт загрузки: он просто отдаёт File[] в onFiles.
 * В чате группы передайте существующий handleComposerFiles, в ЛС — его
 * аналог. Вставка скриншотов из буфера (image/png без имени) поддерживается:
 * файл получает читаемое имя paste-<время>.<расширение>.
 *
 * Использование (см. PATCHES.md):
 *   const { isDragOver, dropProps, handlePaste } = useFileDropPaste({
 *     onFiles: handleComposerFiles,
 *   });
 *   <div {...dropProps} className="relative ...">
 *     {isDragOver && <div className="tz-dropzone">Отпустите файлы, чтобы прикрепить</div>}
 *     ...
 *     <textarea onPaste={(e) => handlePaste(e, handleTextPaste)} ... />
 *   </div>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
  };
  return map[mime] ?? (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
}

/** Дать безымянным вставленным файлам (скриншотам) читаемое имя. */
function normalizeFileName(file: File): File {
  const generic = !file.name || file.name === "image.png" || file.name === "blob";
  if (!generic) return file;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    return new File([file], `paste-${stamp}.${extFromMime(file.type)}`, { type: file.type });
  } catch {
    return file; // старые браузеры без конструктора File
  }
}

/** Достать файлы из DataTransfer (drop). */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && file.size > 0) files.push(normalizeFileName(file));
    }
  } else {
    for (const file of Array.from(dt.files || [])) {
      if (file.size > 0) files.push(normalizeFileName(file));
    }
  }
  return files;
}

/** Достать файлы из события вставки (Ctrl+V): скриншоты, скопированные файлы. */
export function filesFromClipboard(
  e: ReactClipboardEvent<HTMLElement> | ClipboardEvent,
): File[] {
  const data = "clipboardData" in e ? e.clipboardData : null;
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && file.size > 0) files.push(normalizeFileName(file));
  }
  return files;
}

export function useFileDropPaste(options: {
  onFiles: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { onFiles, disabled } = options;
  const [isDragOver, setIsDragOver] = useState(false);
  // Счётчик глубины: dragenter/dragleave стреляют на каждом дочернем элементе,
  // без счётчика оверлей мерцает.
  const depth = useRef(0);

  // FIX-DND: если перетаскивание завершилось вне зоны сброса (Esc, отпускание
  // за пределами окна, перенос выделенного текста/области), события dragleave
  // может не быть — оверлей «Отпустите файлы…» зависал. Сбрасываем его по
  // глобальным dragend/drop и по первому обычному движению мыши (mousemove не
  // приходит, пока идёт настоящий drag, поэтому это безопасный признак того,
  // что перетаскивание уже закончилось).
  useEffect(() => {
    if (!isDragOver) return;
    const reset = () => {
      depth.current = 0;
      setIsDragOver(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("mousemove", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("mousemove", reset);
    };
  }, [isDragOver]);

  const hasFiles = (e: ReactDragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes("Files");

  const onDragEnter = useCallback(
    (e: ReactDragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setIsDragOver(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (e: ReactDragEvent) => {
      if (disabled || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragOver(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (disabled) return;
      e.preventDefault();
      depth.current = 0;
      setIsDragOver(false);
      const files = filesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) void onFiles(files);
    },
    [disabled, onFiles],
  );

  /**
   * Обработчик вставки. Если в буфере файлы/скриншоты — загружаем их;
   * иначе передаём событие текстовому обработчику (onNoFiles), например
   * существующему handleTextPaste.
   */
  const handlePaste = useCallback(
    <T extends HTMLElement>(
      e: ReactClipboardEvent<T>,
      onNoFiles?: (e: ReactClipboardEvent<T>) => void,
    ) => {
      if (disabled) return;
      const files = filesFromClipboard(e);
      if (files.length > 0) {
        e.preventDefault();
        void onFiles(files);
        return;
      }
      onNoFiles?.(e);
    },
    [disabled, onFiles],
  );

  return {
    isDragOver,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    handlePaste,
  };
}
