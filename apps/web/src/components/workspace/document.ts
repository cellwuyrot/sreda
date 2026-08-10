// Browser-side helpers for turning an uploaded document (PDF or plain text)
// into data that can live in localStorage alongside the rest of the board
// state, plus small utilities for classifying and exporting documents.

import type { DocKind, DocumentCard } from "./types";

/** Rough cap (in bytes) for a single document so the board still fits in
 *  localStorage. PDFs above this are refused with a hint to the user. */
export const MAX_DOC_BYTES = 4 * 1024 * 1024; // 4 MB

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".log", ".json"];

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * File-picker `accept` string covering every document the workspace can open:
 * PDFs, Word documents and the editable plain-text family. Shared between the
 * card, the reader and the canvas so they never drift apart.
 */
export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.log,.json,text/*,application/pdf," + DOCX_MIME;

function hasExtension(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** True when the file looks like a PDF (by MIME type or extension). */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || hasExtension(file.name, [".pdf"]);
}

/** True when the file is a Word document (`.docx`). */
export function isDocxFile(file: File): boolean {
  return file.type === DOCX_MIME || hasExtension(file.name, [".docx"]);
}

/** True when the file looks like editable plain text. */
export function isTextFile(file: File): boolean {
  return file.type.startsWith("text/") || hasExtension(file.name, TEXT_EXTENSIONS);
}

/**
 * Classify a dropped/selected file, or null when it is not a document. Word
 * documents are classified as "text" because we open them in the editable text
 * view after extracting their contents.
 */
export function docKindFromFile(file: File): DocKind | null {
  if (isPdfFile(file)) return "pdf";
  if (isDocxFile(file) || isTextFile(file)) return "text";
  return null;
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Strip the extension from a file name for use as a human-friendly title. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "");
}

/**
 * Read a document file and produce the card fields describing it. Returns null
 * when the file is not a supported document type. Throws when a PDF exceeds the
 * storage cap so the caller can surface a clear message.
 */
export async function fileToDocumentFields(
  file: File,
): Promise<Pick<DocumentCard, "docKind" | "fileName" | "text" | "src"> | null> {
  const kind = docKindFromFile(file);
  if (!kind) return null;
  if (kind === "text") {
    // Word documents are ZIP archives of XML; extract their readable text and
    // open it as an editable plain-text document (renamed to .txt to reflect
    // that the stored content is now plain text).
    if (isDocxFile(file)) {
      if (file.size > MAX_DOC_BYTES) {
        throw new Error(
          `Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Максимум ${(
            MAX_DOC_BYTES /
            1024 /
            1024
          ).toFixed(0)} МБ.`,
        );
      }
      const { docxToText } = await import("./office");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await docxToText(bytes);
      return { docKind: "text", fileName: `${baseName(file.name)}.txt`, text, src: "" };
    }
    const text = await readFileAsText(file);
    return { docKind: "text", fileName: file.name, text, src: "" };
  }
  if (file.size > MAX_DOC_BYTES) {
    throw new Error(
      `PDF слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Максимум ${(
        MAX_DOC_BYTES /
        1024 /
        1024
      ).toFixed(0)} МБ.`,
    );
  }
  const src = await readFileAsDataUrl(file);
  return { docKind: "pdf", fileName: file.name, src, text: "" };
}

/**
 * Convert a stored base64 `data:` URL into a Blob. Embedding a PDF in an
 * `<object>` from a `data:` URL is unreliable and blocked by our CSP, so we
 * render it from a same-origin `blob:` URL instead.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const raw = match[3];
  try {
    if (isBase64) {
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(raw)], { type: mime });
  } catch {
    return null;
  }
}

/** Trigger a browser download of a text document. */
export function downloadTextDocument(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "документ.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
