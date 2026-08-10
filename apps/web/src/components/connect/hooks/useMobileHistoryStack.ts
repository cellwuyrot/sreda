"use client";

import { useEffect, useRef } from "react";

/* MOBILE-UI: системная «назад» (кнопка/жест Android, стрелка браузера) должна
   вести по уровням мобильного мессенджера — чат → каналы → список сообществ —
   а не закрывать приложение с любого экрана. Для этого стек экранов
   отражается в history:

     • углубление (groups → channels → chat) пушит по записи на уровень;
     • подъём делается ТОЛЬКО через history.back() — хук ловит popstate и
       переключает вид. Кнопки «назад» в шапках и свайп вызывают goBack().

   В Android-оболочке это же заставляет системную кнопку «назад» работать
   правильно: WebView двигается по записям pushState (canGoBack/goBack). */

/* MOBILE-DRAWER: экранов два — список сообществ и чат группы; панель каналов
   теперь слой (useHistoryLayer), а не уровень стека. Записи старых сессий с
   tzView:"channels" безопасно откатываются в "groups" через fallback в onPop. */
export type MobileStackView = "groups" | "chat";

const DEPTH: Record<MobileStackView, number> = { groups: 0, chat: 1 };
const BY_DEPTH: MobileStackView[] = ["groups", "chat"];

interface TzHistoryState {
  tzView?: MobileStackView;
  [key: string]: unknown;
}

export function useMobileHistoryStack(
  view: MobileStackView,
  setView: (v: MobileStackView) => void,
  /** Активен только в мобильной вёрстке. */
  enabled: boolean,
) {
  const prevRef = useRef(view);
  const fromPopRef = useRef(false);
  /* FIX-CI (react-hooks/refs): «latest ref» обновляется в эффекте, а не при
     рендере — правило запрещает запись в ref.current в теле хука. Обработчик
     popstate читает ref в момент события, поэтому порядок эффектов не важен. */
  const setViewRef = useRef(setView);
  useEffect(() => {
    setViewRef.current = setView;
  }, [setView]);

  /* Системная/программная «назад»: переключаем вид по состоянию записи. */
  useEffect(() => {
    if (!enabled) return;
    const onPop = (e: PopStateEvent) => {
      const state = (e.state ?? null) as TzHistoryState | null;
      const target: MobileStackView =
        state?.tzView && DEPTH[state.tzView] !== undefined ? state.tzView : "groups";
      fromPopRef.current = true;
      setViewRef.current(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  /* Углубление вида → записи в history (по одной на уровень). */
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!enabled || view === prev) return;
    if (fromPopRef.current) {
      fromPopRef.current = false;
      return;
    }
    if (DEPTH[view] > DEPTH[prev]) {
      for (let d = DEPTH[prev] + 1; d <= DEPTH[view]; d++) {
        window.history.pushState(
          { ...((window.history.state ?? {}) as TzHistoryState), tzView: BY_DEPTH[d] },
          "",
        );
      }
    } else {
      /* Подъём мимо goBack() (страховка): выравниваем историю без событий. */
      const steps = DEPTH[prev] - DEPTH[view];
      fromPopRef.current = true;
      window.history.go(-steps);
    }
  }, [view, enabled]);
}

/* MOBILE-UI: слой поверх стека (шторка участников, открытая DM-беседа,
   развёрнутая голосовая панель). Пока слой открыт, системная «назад»
   закрывает его, а не нижележащий экран. */
export function useHistoryLayer(open: boolean, onClose: () => void, tag: string, enabled = true) {
  const closingRef = useRef(false);
  /* FIX-CI (react-hooks/refs): см. комментарий в useMobileHistoryStack. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled || !open) return;
    window.history.pushState(
      { ...((window.history.state ?? {}) as Record<string, unknown>), tzLayer: tag },
      "",
    );
    const onPop = () => {
      closingRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (closingRef.current) {
        /* Слой закрыт самой «назад» — запись уже снята. */
        closingRef.current = false;
        return;
      }
      /* Слой закрыли тапом/крестиком — снимаем свою запись из истории. */
      const state = (window.history.state ?? null) as { tzLayer?: string } | null;
      if (state?.tzLayer === tag) window.history.back();
    };
  }, [open, tag, enabled]);
}
