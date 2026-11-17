"use client";
import { useEffect, useState } from "react";
import { getDesktopApi } from "@/lib/desktop";

/** Native and DOM activity: false until the native query has settled. */
export function useElectronWindowActivity(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const api = getDesktopApi();
    let live = true;
    let nativeActive = !api?.getWindowActive && !api?.getWindowHidden;
    let domFocus = document.hasFocus();
    let revision = 0;
    const update = () => { if (live) setActive(nativeActive && domFocus && document.visibilityState === "visible"); };
    const onFocus = () => { domFocus = true; update(); };
    const onBlur = () => { domFocus = false; update(); };
    const useActiveApi = !!api?.getWindowActive;
    const unsubscribe = useActiveApi
      ? api?.onWindowActiveChange?.((value) => { revision++; nativeActive = value; update(); })
      : api?.onWindowHiddenChange?.((hidden) => { revision++; nativeActive = !hidden; update(); });
    const snapshot = revision;
    const readNative = useActiveApi ? api?.getWindowActive?.() : api?.getWindowHidden?.().then((hidden) => !hidden);
    readNative?.then((value) => { if (live && revision === snapshot) { nativeActive = value; update(); } }).catch(() => { nativeActive = false; update(); });
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    update();
    return () => { live = false; unsubscribe?.(); document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, []);
  return active;
}
