"use client";

import { useEffect, useMemo } from "react";
import { dataUrlToBlob } from "./document";

/**
 * Turn a stored base64 `data:` URL into a short-lived same-origin `blob:` URL
 * suitable for embedding a PDF in an `<object>` (and for opening/downloading).
 * The object URL is revoked automatically when the source changes or the
 * component unmounts.
 */
export function useObjectUrl(dataUrl: string | undefined | null): string | null {
  const url = useMemo(() => {
    if (!dataUrl) return null;
    const blob = dataUrlToBlob(dataUrl);
    return blob ? URL.createObjectURL(blob) : dataUrl;
  }, [dataUrl]);

  useEffect(() => {
    if (!url || !url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}
