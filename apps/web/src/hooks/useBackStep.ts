"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { parseStack, recordVisit, stepBack } from "@/lib/backStack";

/**
 * BACK-STEP: след посещений и кнопка «назад», которая делает шаг назад.
 *
 * След хранится в `sessionStorage` — то есть отдельно для каждой вкладки и
 * забывается при её закрытии. Это ровно то поведение, которое нужно: «назад»
 * относится к текущему сеансу просмотра, а не к вечной истории аккаунта.
 *
 * Событие `tz-nav-stack` нужно потому, что hook живёт сразу в нескольких
 * компонентах: записывает один (трекер), а читают кнопки. Без оповещения кнопка
 * узнала бы о новом шаге только при своей следующей перерисовке.
 */

const STORAGE_KEY = "tz-nav-stack";
const STACK_EVENT = "tz-nav-stack";

function readStack(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStack(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    /* приватный режим без хранилища — работаем без следа */
    return [];
  }
}

function writeStack(stack: string[]): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
  } catch {
    /* нет хранилища — «назад» просто останется переходом по умолчанию */
  }
  window.dispatchEvent(new CustomEvent(STACK_EVENT));
}

/**
 * Трекер: запоминает, где человек уже был. Монтируется один раз на приложение.
 *
 * Путь берём без параметров запроса: разделы мессенджера различаются ими
 * (`?section=dm`), и считать каждую смену раздела отдельным шагом означало бы
 * заставлять нажимать «назад» десять раз.
 */
export function useNavStackTracker(): void {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const next = recordVisit(readStack(), pathname);
    writeStack(next);
  }, [pathname]);
}

export interface BackStep {
  /** Обработчик нажатия: шаг назад либо переход в место по умолчанию. */
  onBack: () => void;
  /** Есть ли куда возвращаться. Кнопка не прячется — меняется только смысл. */
  hasHistory: boolean;
  /** Куда вернёт нажатие. Пусто — вернёт в место по умолчанию. */
  target: string | null;
}

/**
 * Кнопка «назад» на странице.
 *
 * `fallback` — то самое место, куда кнопка вела раньше всегда. Оно остаётся, но
 * только как запасной путь: страницу могли открыть по прямой ссылке, и тогда
 * возвращаться некуда.
 */
export function useBackStep(fallback: string): BackStep {
  const router = useRouter();
  const pathname = usePathname();
  const [stack, setStack] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setStack(readStack());
    sync();
    window.addEventListener(STACK_EVENT, sync);
    return () => window.removeEventListener(STACK_EVENT, sync);
  }, []);

  const onBack = useCallback(() => {
    /* FIX-BACKLOOP: шаг делаем по СВОЕМУ следу, а не историей браузера.
       Раньше здесь стоял router.back(): решение о том, есть ли куда идти,
       принималось по следу, а сам шаг делала история — два разных списка,
       которые расходятся на каждой смене запроса в адресе. История отступала на
       запись с тем же путём, человек оставался на месте, и кнопка выглядела
       зациклившейся.

       Плата за переход по адресу — не восстанавливается позиция прокрутки.
       Это меньшая беда, чем кнопка, из которой нельзя выйти. */
    const { target, stack: next } = stepBack(readStack(), pathname ?? "");
    if (target) {
      /* След пишем ДО перехода: трекер увидит уже верную вершину и не примет
         наш шаг за переход вперёд. */
      writeStack(next);
      router.push(target);
      return;
    }
    router.push(fallback);
  }, [router, fallback, pathname]);

  /* «Есть куда возвращаться» считается тем же правилом, что и сам шаг: иначе
     кнопка обещала бы возврат туда, куда шага на самом деле нет. */
  const step = stepBack(stack, pathname ?? "");
  return { onBack, hasHistory: step.target !== null, target: step.target };
}
