"use client";

import { useEffect, useRef, useState } from "react";

/** Session-scoped, per-user draft. Never store passwords, tokens or E2EE keys. */
export function useSessionDraft<T>({ storageKey, value, dirty, onRestore }: {
  storageKey: string | null; value: T; dirty: boolean; onRestore: (value: T) => void;
}) {
  const restore = useRef(onRestore);
  useEffect(() => { restore.current = onRestore; }, [onRestore]);
  const [stored, setStored] = useState(false);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) restore.current(JSON.parse(raw) as T);
    } catch { /* Storage may be blocked; leave the in-memory form intact. */ }
    setReadyKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || readyKey !== storageKey) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
      setStored(dirty);
    } catch { setStored(false); /* Quota/blocked storage must not break editing. */ }
  }, [storageKey, readyKey, value, dirty]);
  return stored;
}

export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
