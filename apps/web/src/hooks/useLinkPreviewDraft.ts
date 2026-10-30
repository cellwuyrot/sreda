"use client";
import { useEffect, useState } from "react";
import { firstLink } from "@/lib/linkPreviewPolicy";
/** Separate key leaves legacy text drafts intact. Only the current URL is suppressed. */
export function useLinkPreviewDraft(
  text: string,
  key: string | null,
  disabled = false,
) {
  const url = disabled ? null : firstLink(text),
    identity = `${key || ""}:${url || ""}`;
  const [choice, setChoice] = useState<{ identity: string; hidden: boolean }>({
    identity: "",
    hidden: false,
  });
  useEffect(() => {
    if (disabled || !key || !url) {
      setChoice({ identity, hidden: false });
      return;
    }
    let hidden = false;
    try {
      const saved = JSON.parse(
        localStorage.getItem(key + ":preview") || "null",
      );
      hidden = saved?.url === url && saved.hidden === true;
    } catch {
      /* storage unavailable */
    }
    setChoice({ identity, hidden });
  }, [key, url, disabled, identity]);
  const suppressed = choice.identity === identity && choice.hidden;
  function setSuppressed(hidden: boolean) {
    setChoice({ identity, hidden });
    if (!key || disabled) return;
    try {
      if (hidden && url)
        localStorage.setItem(
          key + ":preview",
          JSON.stringify({ url, hidden: true }),
        );
      else localStorage.removeItem(key + ":preview");
    } catch {
      /* no persistence available */
    }
  }
  function clear() {
    if (key)
      try {
        localStorage.removeItem(key + ":preview");
      } catch {
        /* no storage */
      }
    setChoice({ identity, hidden: false });
  }
  return { url, suppressed, setSuppressed, clear };
}
