"use client";

/**
 * Оконный рендер ленты сообщений: в DOM живёт не вся история, а полоса вокруг
 * видимой области. Остальное заменяют две распорки — сверху и снизу.
 *
 * Зачем. В ленте уже стоит `content-visibility: auto` (см. globals.css): браузер
 * пропускает раскладку и отрисовку строк за пределами экрана. Это снимает
 * стоимость показа, но не стоимость существования: узлы остаются в дереве, React
 * держит их в своём, и после десятка догруженных страниц счёт идёт на десятки
 * тысяч элементов. Память и обход дерева при каждом обновлении растут вместе с
 * историей — прокрутка тяжелеет именно там, где листают дольше всего.
 *
 * Границы окна хранятся не индексами, а смещениями от КОНЦА ленты: сколько
 * сообщений отрисовано и сколько скрыто снизу. Это важно — старые страницы
 * приходят в начало массива, и все индексы разом сдвигаются. От смещений с конца
 * подстановка старых сообщений не меняет ничего: отрисовано ровно то же самое.
 *
 * Верхний край двигается «с якорем». Добавить или убрать строки НАД видимой
 * областью значит сдвинуть всё, что под ними: браузер сохраняет scrollTop, а
 * содержимое уезжает. Поэтому перед правкой запоминается расстояние до низа, а
 * после отрисовки прокрутка выставляется по нему заново — тот же приём, что и
 * при догрузке страниц с сервера.
 *
 * Нижний край правится свободно: всё, что ниже видимой области, на положение
 * прочитанного не влияет — меняется только длина ползунка. У самого низа хвост
 * всегда отрисован целиком, иначе новое сообщение приехало бы в распорку.
 *
 * Высота распорок — оценка: число скрытых строк, умноженное на среднюю высоту
 * отрисованных. Точной она быть не может и не должна: от неё зависит лишь длина
 * ползунка, а позиция чтения держится якорем.
 *
 * Окно включается только на длинной истории (см. WINDOW_MIN): в переписке на
 * полсотни сообщений не меняется ни поведение, ни разметка.
 */

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Меньше этого числа сообщений окно не включается — экономить нечего. */
const WINDOW_MIN = 200;

/** Шаг: на столько строк за раз растёт или сжимается окно. */
const STEP = 50;

/** Сколько строк отрисовано при первом включении окна. */
const INITIAL_SIZE = STEP * 2;

/** Запас за краями видимой области, в экранах. */
const OVERSCAN_SCREENS = 1.5;

/** Ближе этого расстояния до низа хвост отрисован целиком. */
const BOTTOM_STICKY_PX = 1200;

/** Средняя высота строки до первых замеров. */
const FALLBACK_ROW = 64;

interface WindowState {
  /** Сколько сообщений отрисовано. */
  size: number;
  /** Сколько сообщений скрыто снизу (0 — виден хвост). */
  hideBelow: number;
}

export interface MessageWindow {
  /** Индекс первого отрисованного сообщения. */
  start: number;
  /** Индекс за последним отрисованным (полуинтервал). */
  end: number;
  /** Высота распорки сверху, px. */
  padTop: number;
  /** Высота распорки снизу, px. */
  padBottom: number;
  /** Сколько сообщений скрыто сверху: пока они есть, догружать с сервера рано. */
  hiddenAbove: number;
  /** Пересчитать окно — из обработчика прокрутки (он уже троттлён по кадру). */
  sync: () => void;
  /** Показать конкретный индекс: переход к сообщению, первое непрочитанное. */
  reveal: (index: number) => void;
  /** Раскрыть хвост целиком — перед прокруткой в конец (см. tailWindow). */
  revealTail: () => void;
  /** Сброс при смене канала или беседы. */
  reset: () => void;
}

/**
 * FIX-SCROLLEND: окно, в котором хвост ленты отрисован целиком.
 *
 * Нужна кнопке «вниз». Когда человек ушёл вверх по длинной истории, последние
 * сообщения из дерева убраны и заменены нижней распоркой — её высота лишь
 * ОЦЕНКА (число скрытых строк на среднюю высоту). Прокрутка «в конец» в таком
 * состоянии приезжает в конец распорки, а не к последнему сообщению: как только
 * хвост отрисуется, оценка сменится настоящей высотой, и низ уедет.
 *
 * Поэтому перед прокруткой хвост раскрывается, и только потом лента доводится
 * до низа — по реальной высоте.
 *
 * Отдельной чистой функцией, потому что это и есть правило, которое чинит баг:
 * его надо проверять, а не полагаться на то, что оно случайно верное.
 */
export function tailWindow(state: WindowState, total: number): WindowState {
  if (total <= WINDOW_MIN) return state;
  /* Размер окна не уменьшаем: убрать строки сверху значило бы сдвинуть всё, что
     под ними, ровно в тот момент, когда мы наводимся на низ. */
  const size = Math.max(state.size, INITIAL_SIZE);
  if (state.hideBelow === 0 && size === state.size) return state;
  return { size, hideBelow: 0 };
}

/**
 * FIX-DM-COPY: есть ли в ленте живое выделение.
 *
 * Выделение — состояние браузера, привязанное к КОНКРЕТНЫМ узлам. Если в этот
 * момент перестроить окно, узлы с началом выделения уйдут из дерева — именно
 * так ломалось копирование в личных сообщениях: человек раскрывал длинное
 * сообщение (высота строки разом менялась в разы), ведёл мышью — а лента в это
 * время пересчитывала окно. Пока выделяют — окно не трогаем: человек важнее
 * экономии узлов на пару секунд.
 */
function hasLiveSelectionInside(el: HTMLElement): boolean {
	if (typeof window === "undefined") return false;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	const node = sel.anchorNode;
	return !!node && el.contains(node);
}

export function useMessageWindow(
  count: number,
  scrollRef: RefObject<HTMLElement | null>,
): MessageWindow {
  const [state, setState] = useState<WindowState>({ size: INITIAL_SIZE, hideBelow: 0 });
  /* Средняя высота строки — состояние, а не ref: от неё зависят высоты распорок,
     то есть результат отрисовки. Значение, от которого зависит разметка, во время
     рендера должно быть читаемым — у ref это запрещено (react-hooks/refs), и
     справедливо: изменение ref не вызывает перерисовку, распорки бы «застыли». */
  const [avgRow, setAvgRow] = useState(FALLBACK_ROW);

  /** Расстояние до низа, записанное перед сдвигом верхнего края. */
  const anchorRef = useRef<number | null>(null);

  const enabled = count > WINDOW_MIN;

  const end = enabled ? Math.max(0, count - state.hideBelow) : count;
  const start = enabled ? Math.max(0, end - state.size) : 0;
  const padTop = enabled ? Math.round(start * avgRow) : 0;
  const padBottom = enabled ? Math.round((count - end) * avgRow) : 0;

  /* Вызывается из обработчика прокрутки, поэтому пересоздание колбэка при
     изменении окна безвредно: никто на него не подписывается, его зовут по месту. */
  const sync = useCallback(() => {
    const el = scrollRef.current;
    const total = count;
    if (!el || total <= WINDOW_MIN) return;

    // FIX-DM-COPY: пока держат выделение, строки из дерева не убираем.
    if (hasLiveSelectionInside(el)) return;

    const curEnd = Math.max(0, total - state.hideBelow);
    const curStart = Math.max(0, curEnd - state.size);
    const rendered = curEnd - curStart;
    if (rendered <= 0) return;

    /* Замер средней высоты: из общей высоты вычитаем распорки и делим на число
       отрисованных строк. Оценка грубая, но других данных о скрытых строках нет.
       Обновляем только при заметном расхождении — иначе каждая прокрутка
       вызывала бы перерисовку из-за дробных долей пикселя. */
    const curPadTop = Math.round(curStart * avgRow);
    const curPadBottom = Math.round((total - curEnd) * avgRow);
    const contentHeight = el.scrollHeight - curPadTop - curPadBottom;
    let avg = avgRow;
    if (contentHeight > 0) {
      const measured = contentHeight / rendered;
      if (Number.isFinite(measured) && measured > 8) {
        avg = measured;
        if (Math.abs(measured - avgRow) / avgRow > 0.02) setAvgRow(measured);
      }
    }

    const viewport = el.clientHeight || 1;
    const overscan = viewport * OVERSCAN_SCREENS;
    /* Положение видимой области внутри отрисованного куска: выше него распорка. */
    const topInside = el.scrollTop - curPadTop;
    const bottomInside = topInside + viewport;
    const renderedHeight = el.scrollHeight - curPadTop - curPadBottom;
    const distanceToBottom = el.scrollHeight - el.scrollTop - viewport;

    let size = state.size;
    let hideBelow = state.hideBelow;

    /* Высота одного шага. Убирать строки можно только тогда, когда весь
       убираемый кусок УЖЕ вне зоны запаса: иначе после сжатия край снова
       окажется близко, окно тут же вырастет обратно — и так каждый кадр.
       Гистерезис должен быть больше шага, иначе окно начнёт дребезжать. */
    const stepPx = STEP * avg;

    // ── Верхний край ────────────────────────────────────────────────────────
    if (topInside < overscan && curStart > 0) {
      size = Math.min(total - hideBelow, size + STEP);
    } else if (topInside > overscan + stepPx && size > INITIAL_SIZE) {
      // Ушли вниз — верхние строки больше не нужны, отпускаем их.
      size = Math.max(INITIAL_SIZE, size - STEP);
    }

    // ── Нижний край ─────────────────────────────────────────────────────────
    if (distanceToBottom < BOTTOM_STICKY_PX) {
      hideBelow = 0;
    } else if (bottomInside > renderedHeight - overscan && hideBelow > 0) {
      hideBelow = Math.max(0, hideBelow - STEP);
    } else if (bottomInside < renderedHeight - overscan - stepPx && rendered > INITIAL_SIZE) {
      hideBelow = Math.min(total - INITIAL_SIZE, hideBelow + STEP);
    }

    if (size === state.size && hideBelow === state.hideBelow) return;

    /* Сдвиг верхнего края меняет положение всего, что ниже, — запоминаем
       расстояние до низа. Нижний край на положение не влияет, якорь не нужен. */
    const topEdgeMoved = size !== state.size;
    if (topEdgeMoved) anchorRef.current = el.scrollHeight - el.scrollTop;
    setState({ size, hideBelow });
  }, [scrollRef, count, state, avgRow]);

  const reveal = useCallback((index: number) => {
    const total = count;
    if (index < 0 || index >= total || total <= WINDOW_MIN) return;
    const curEnd = Math.max(0, total - state.hideBelow);
    const curStart = Math.max(0, curEnd - state.size);
    if (index >= curStart && index < curEnd) return;

    const el = scrollRef.current;
    let { size, hideBelow } = state;
    if (index >= curEnd) {
      // Цель ниже окна — приоткрываем хвост.
      hideBelow = Math.max(0, total - index - STEP);
    } else {
      // Цель выше окна — растягиваем окно до неё. Якорь: верхний край поедет.
      if (el) anchorRef.current = el.scrollHeight - el.scrollTop;
      size = Math.min(total, total - hideBelow - index + STEP);
    }
    setState({ size, hideBelow });
  }, [scrollRef, count, state]);

  /* Якорь здесь НЕ ставится намеренно: он держит расстояние до низа, а нам
     нужно ровно обратное — оказаться у низа по его новому, настоящему
     положению. Прокруткой займётся вызывающий, сразу после отрисовки. */
  const revealTail = useCallback(() => {
    setState((prev) => tailWindow(prev, count));
  }, [count]);

  const reset = useCallback(() => {
    anchorRef.current = null;
    setAvgRow(FALLBACK_ROW);
    setState({ size: INITIAL_SIZE, hideBelow: 0 });
  }, []);

  /* Возврат позиции после сдвига верхнего края — именно useLayoutEffect: обычный
     эффект выполняется после кадра, и рывок успевает попасть на экран. */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || anchor === null) return;
    anchorRef.current = null;
    el.scrollTop = el.scrollHeight - anchor;
  }, [state, scrollRef]);

  return { start, end, padTop, padBottom, hiddenAbove: start, sync, reveal, revealTail, reset };
}
