// Browser-side PDF helpers for the document editor.
//
// Rendering is done with pdf.js (`pdfjs-dist`); exporting an edited copy is done
// with `pdf-lib`. Both libraries are imported *dynamically* inside async
// functions so they never run during server-side rendering and are only pulled
// into the client bundle the first time a PDF is actually opened.
//
// The heavy lifting the app cares about:
//   • loadPdf()             — parse a stored data URL into a pdf.js document.
//   • exportAnnotatedPdf()  — bake the card's text annotations onto each page
//                             and hand the user a downloadable PDF.
//
// Annotations are intentionally *not* written back into the original bytes:
// they live on the card (see PdfAnnotation) so they stay editable. Export
// rasterizes each page together with its annotations, which keeps Cyrillic text
// rendering exactly as the browser draws it (pdf-lib's built-in fonts are
// Latin-only and would otherwise choke on Cyrillic).

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAnnotation } from "./types";

/** Vertical distance between wrapped lines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

let workerConfigured = false;

async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    // The worker script is copied to /public at build time (see next.config).
    // Serving it same-origin keeps it within our CSP (`worker-src 'self'`).
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
    workerConfigured = true;
  }
  return pdfjs;
}

/**
 * Build the parameters for `getDocument`. Besides the raw bytes we point pdf.js
 * at the standard-font and CMap data copied to /public (see next.config): many
 * real-world PDFs lean on the base-14 fonts or non-Latin encodings and render
 * blank without them. Both directories are served same-origin to stay within
 * our CSP.
 */
function docParams(data: Uint8Array) {
  return {
    data,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  };
}

/** Decode a base64 (or URL-encoded) `data:` URL into raw bytes. */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array | null {
  const match = /^data:[^;,]*(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const isBase64 = Boolean(match[1]);
  const raw = match[2];
  try {
    if (isBase64) {
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** Parse a stored PDF data URL into a pdf.js document proxy. */
export async function loadPdf(dataUrl: string): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const data = dataUrlToUint8Array(dataUrl);
  if (!data) throw new Error("Не удалось прочитать PDF.");
  return pdfjs.getDocument(docParams(data)).promise;
}

/**
 * One run of the PDF's own text layer, expressed in unscaled PDF points with a
 * top-left origin (the same coordinate space as {@link PdfAnnotation}). Used to
 * turn a text-based PDF into editable text: each run becomes an editable box at
 * its original position, and only the runs the user actually changes are
 * covered and repainted on export.
 */
export interface ExtractedTextRun {
  /** Left edge of the run, points from the page's left. */
  x: number;
  /** Top edge of the run, points from the page's top. */
  y: number;
  /** Run advance width, points. */
  width: number;
  /** Font size, points. */
  size: number;
  /** The run's text. */
  text: string;
}

/**
 * Extract the selectable text of a single page as positioned runs. pdf.js gives
 * each item a transform in text space; composing it with the (scale-1, y-down)
 * viewport transform yields device points measured from the top-left, matching
 * how annotations are stored and drawn. Whitespace-only items are dropped.
 * Returns an empty array for pages without a text layer (e.g. scans).
 */
export async function extractPageText(
  doc: PDFDocumentProxy,
  pageIndex: number,
): Promise<ExtractedTextRun[]> {
  const pdfjs = await getPdfjs();
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: ExtractedTextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue; // skip marked-content markers
    const text = item.str;
    if (!text || !text.trim()) continue;
    // tx maps the run's text space into top-left device space (points here).
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (!(size > 0)) continue;
    runs.push({
      x: tx[4],
      y: tx[5] - size, // tx[5] is the baseline; subtract ascent≈size for the top
      width: item.width,
      size: Math.round(size),
      text,
    });
  }
  return runs;
}


/** Split annotation text into lines and paint them on a 2D canvas context. */
function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: PdfAnnotation,
  scale: number,
): void {
  const fontPx = ann.size * scale;
  // When the annotation replaces a run of the PDF's own text, first cover the
  // original glyphs with a white rectangle so the old and new text don't stack.
  // The box is padded a little around the run's advance width and font size.
  if (ann.origin !== undefined) {
    const pad = ann.size * 0.18 * scale;
    const boxW = (ann.boxW ?? ann.size * ann.text.length * 0.6) * scale;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      ann.x * scale - pad,
      ann.y * scale - pad,
      boxW + pad * 2,
      fontPx * LINE_HEIGHT + pad,
    );
  }
  ctx.font = `${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111111";
  const lines = ann.text.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, ann.x * scale, ann.y * scale + i * fontPx * LINE_HEIGHT);
  });
}

/**
 * Render every page of `src` at `scale`, paint the given annotations on top and
 * assemble the result into a fresh PDF, which is then downloaded. Pages keep
 * their original point dimensions so the output prints at the correct size.
 */
export async function exportAnnotatedPdf(
  src: string,
  annotations: PdfAnnotation[],
  fileName: string,
  scale = 2,
): Promise<void> {
  const pdfjs = await getPdfjs();
  const { PDFDocument } = await import("pdf-lib");
  const data = dataUrlToUint8Array(src);
  if (!data) throw new Error("Не удалось прочитать PDF.");

  const doc = await pdfjs.getDocument(docParams(data)).promise;
  const out = await PDFDocument.create();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    await page.render({ canvasContext: ctx, viewport }).promise;

    for (const ann of annotations.filter((a) => a.page === p - 1)) {
      paintAnnotation(ctx, ann, scale);
    }

    const jpgBytes = dataUrlToUint8Array(canvas.toDataURL("image/jpeg", 0.92));
    if (!jpgBytes) continue;
    const img = await out.embedJpg(jpgBytes);
    const unscaled = page.getViewport({ scale: 1 });
    const outPage = out.addPage([unscaled.width, unscaled.height]);
    outPage.drawImage(img, { x: 0, y: 0, width: unscaled.width, height: unscaled.height });
  }

  const bytes = await out.save();
  downloadPdfBytes(bytes, fileName);
}

/** Trigger a browser download of raw PDF bytes with a safe file name. */
export function downloadPdfBytes(bytes: Uint8Array, fileName: string): void {
  const base = (fileName || "документ").replace(/[\\/:*?"<>|]+/g, "").trim() || "документ";
  const name = base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  // Copy into a fresh, ArrayBuffer-backed view so it satisfies BlobPart.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const blob = new Blob([buf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
